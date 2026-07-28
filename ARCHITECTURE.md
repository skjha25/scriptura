# Architecture

Why Scriptura is built the way it is. This is the document to read before changing
anything structural — most of what looks odd here is a deliberate trade-off with a
reason, and the reasons are recorded so they can be revisited on purpose rather
than discovered by accident.

---

## 1. Scope: single organisation, deliberately

**There is no tenancy model.** No `organizations` table, no `organization_id`
column, no tenant-scoping middleware, no per-org isolation logic. Authorisation
answers exactly two questions: *is this a signed-in Divinetalk team member*, and
*are they an admin or an editor*.

This was an explicit instruction, and it is load-bearing in a way worth stating:
retro-fitting multi-tenancy is mostly a data-model problem, and the data model here
is one shared `blogs` table that other Divinetalk systems already read. If tenancy
is ever needed, the honest path is a new table with a tenant key and a migration —
not a column bolted onto this one.

`tests/unit/migration-parity.test.js` asserts that neither table has an
`organization_id`. If someone adds tenancy later, that assertion should be
*deleted as part of that work*, not quietly amended — it exists to make the
decision visible.

---

## 2. The database: one table, extended

### 2.1 What already existed

Divinetalk's production `blogs` table is live, has rows up to at least id 813, and
is read by systems that are not this application. Fifteen columns are therefore
**contractual** — `id`, `blog_title`, `topic`, `seo_keywords`, `blog_picture`,
`blog_content`, `blog_status`, `published_by`, `publish_date`, `total_views`,
`start_date`, `end_date`, `created_at`, `updated_at`, `deleted_at`. Their names and
types must not change.

41 new columns were added for the AI, editor and SEO features. Total: 56.

### 2.2 `blog_status` semantics

`blog_status` is a `TINYINT` on the existing table. **`1` = published is confirmed
from live data** (row 813 is a published post with `blog_status = 1`). The other
values are our own additions, chosen so that every existing row keeps its current
meaning and `0` is a safe default for a newly inserted draft:

| Value | Meaning | Source |
|---|---|---|
| 0 | draft | ours (safe default) |
| 1 | published | **confirmed from live data** |
| 2 | scheduled | ours |
| 3 | archived | ours |

Defined once in `backend/src/constants/index.js`; nothing else hard-codes them.

### 2.3 Why a standalone table in this build

Per the project decision, the Sequelize migration **creates a standalone `blogs`
table** containing the existing columns plus the new ones, rather than altering
production. Development runs against that. Production adoption is a separate,
reviewable, idempotent, reversible path — see §8.

### 2.4 The denormalisation trade-off (the big one)

Brand voice, image configuration, generation configuration and SEO settings all
live **on the blog row**, not in `brand_voices` / `blog_images` /
`generation_jobs` tables. This was specified, and the reasoning holds up:

**What it buys**
- One blog is one row. No joins anywhere in the read path.
- The wizard's entire submission is auditable in place (`generation_config` is a
  full snapshot), which makes "why did this article come out like this?" answerable
  from a single `SELECT`.
- The whole feature set ships without touching the relational shape other systems
  depend on.

**What it costs**
- **A brand voice cannot be reused across blogs without copying it.** This is the
  real cost. Defining "our voice" once and applying it to fifty articles means
  fifty copies, and editing it means fifty updates.
- Multiple images per blog live in a JSON array (`extra_images`), so they cannot be
  queried, sorted or joined — only read whole.
- Generation history is not retained. `generation_config` holds the *latest* run;
  a previous run's settings are overwritten.

**When to normalise, and how**

Split when *any* of these becomes true:
1. The team wants to define brand voices centrally and apply them by reference.
2. Anyone asks "which articles used voice X?" — that query is impossible today.
3. Generation history or per-run audit is required.
4. Images need independent lifecycle (reuse across articles, bulk re-processing).

The migration path is additive and low-risk:

```
brand_voices      (id, name, tone, pov, traits JSON, source_type, source_ref, …)
blogs.brand_voice_id  → FK, nullable

blog_images       (id, blog_id, url, alt_text, has_logo_overlay, logo_position, position)
generation_runs   (id, blog_id, config JSON, status, error, started_at, finished_at)
```

Back-fill by `INSERT … SELECT DISTINCT` from the existing columns, keep the old
columns for one release as the read fallback, then drop them. Nothing about the
current design blocks it — that is the point of writing it down now.

### 2.5 Indexes

`slug` (unique), `blog_status`, `publish_date`, plus a composite
`(blog_status, publish_date)` for the list view's default "published, newest
first" ordering, and `generation_status` for the dashboard's in-flight poll.

---

## 3. Content: `content_blocks` is the source of truth

This is the single most important invariant in the codebase.

```
content_blocks (JSON)  ──derived──▶  blog_content (HTML)
   editable                            read-only, for external consumers
```

- **`content_blocks`** is an ordered `[{id, type, data}]` array. The editor mutates
  it. It is what the app renders.
- **`blog_content`** is rendered HTML. The existing Divinetalk site and crawlers
  read it, which is why it still exists and still holds HTML.

### 3.1 How drift is prevented

A **model hook** (`beforeSave` in `backend/src/models/blog.js`) regenerates
`blog_content`, `word_count` and `seo_score` from `content_blocks` on every save
where the blocks changed.

It lives in a hook rather than a service because *a hook cannot be forgotten*.
Every write path — controller, generation worker, a future admin script, a
Sequelize `update()` with `individualHooks` — goes through it. A consequence worth
knowing: **`blog_content` is effectively read-only through the API.** Writing it
directly has no effect, because the hook overwrites it from the blocks on the same
save. There is an integration test asserting exactly that.

`seo_score` is set to `null` when the block list is empty, rather than scoring an
empty article. A configured-but-ungenerated draft scoring ~26 would drag the
dashboard's average down and misrepresent published quality.

### 3.2 Two renderers, one guarantee

There are necessarily two renderers — one in Node (to write `blog_content`) and one
in React (for the editor preview and the in-app blog page):

| | |
|---|---|
| `backend/src/services/blocksToHtml.js` | canonical; writes `blog_content` |
| `frontend/src/components/BlockRenderer.js` | the editor preview **and** the blog page |

The spec requires the preview and the real page to use the same component, and
they do — `BlockRenderer` is used by both, with no second frontend implementation.

Cross-language parity is enforced mechanically. `shared/block-fixtures.json` is
**generated from the backend renderer** (`node
backend/scripts/generate-block-fixtures.js`) and asserted by both suites:

- `backend/tests/unit/blocksToHtml.test.js` — exact string match
- `frontend/src/components/__tests__/blockRenderer.parity.test.js` — DOM match

The frontend comparison normalises both sides through an `innerHTML` round-trip
rather than comparing raw strings, because the backend writes `<img … />` while
`innerHTML` reads back `<img …>` — a cosmetic difference in HTML5 void-element
serialisation that means nothing. Attribute order, classes and text are still
compared exactly.

**This test has already earned its place**: it caught two real divergences during
the build — the frontend sanitiser unwrapping `<script>` content into visible text
(where the backend correctly discards it), and an FAQ answer container
disappearing when empty.

If you change markup in one renderer, change it in the other and regenerate the
fixtures. A failure here is the drift alarm; do not silence it.

---

## 4. Security

### 4.1 Stored XSS is the main threat

Article text is written by an LLM from a prompt containing user-supplied
topic/keyword strings and, when web grounding is on, **scraped third-party page
content**. All three are untrusted, and any could induce the model to emit
`<script>`, an `onerror=` attribute, or a `javascript:` URL.

So content is sanitised **on the way in**, before persisting — not only on render.
A stored payload is dangerous to every consumer of the table, including the ones
that are not this application.

- `backend/src/services/sanitize.js` — narrow allow-list, exactly the tags the
  renderer emits plus inline formatting. `data:` URLs are permitted nowhere (an
  inline SVG is a common script-smuggling vector). Class names are filtered to a
  known list. `<script>`/`<style>` have their *content* dropped, not just their
  tags.
- `blocksToHtml` runs the assembled document through the sanitiser once more, so a
  future renderer that forgets to escape cannot introduce a hole.
- `frontend/src/lib/sanitizeInline.js` is a second layer, defending content that
  predates the backend sanitiser or was written directly by another system.

URL validation uses an explicit **code-point scan** rather than a regex, so no raw
control bytes end up in the source (they make files unreadable to git and ESLint)
and so `java\0script:`-style scheme splitting is caught.

### 4.2 Mass assignment

Zod schemas strip unknown keys, and the write schemas simply **do not declare**
server-owned columns — `id`, `total_views`, `seo_score`, `word_count`,
`generation_status`, `generation_error`, `serp_rank_*`, `created_at`, `deleted_at`.
A client that posts them has them silently dropped rather than overwriting a
measured value with a claimed one. Asserted by an integration test.

`POST /blogs` additionally forces `blog_status: draft` even if the client asks for
published, because publishing must go through the publish endpoint and its review
gate.

### 4.3 Auth

- Two JWT secrets, two token types. A refresh token cannot be used as an access
  token: different secrets *and* an explicit `type` claim. Either alone would do;
  both together mean a mistake in one place is not exploitable. Config refuses to
  boot if the two secrets are equal.
- **Refresh tokens embed `token_version`.** Logout increments the column, which
  invalidates every outstanding refresh token with no server-side denylist. Access
  tokens are *not* version-checked per request — that would be a database read on
  every request. The consequence is bounded and understood: an access token stays
  valid for up to its TTL (15 min) after logout.
- Refresh rotates both tokens, so a captured refresh token is useful only until its
  next legitimate use.
- The user is loaded from the database on every authenticated request. That costs
  one indexed primary-key read and buys **immediate** account deactivation instead
  of deactivation-at-token-expiry.
- Login returns an identical response for a wrong password and an unknown email,
  and burns a comparable amount of bcrypt time on the missing-account path, so the
  endpoint is not an account-enumeration oracle by response *or* by timing.

### 4.4 SSRF

Brand-voice analysis fetches a **user-supplied URL**. The guard blocks non-HTTP(S)
schemes, loopback, link-local (169.254/*), RFC1918 ranges, `localhost`, `*.local`
and cloud metadata hostnames, and re-checks after redirects with a redirect cap and
a response-size cap.

### 4.5 Path traversal

Uploads resolve through `resolveSafePath`, which rejects `..`, absolute paths,
Windows drive letters (`C:\` and `C:foo` — drive-relative without a separator),
UNC paths, NUL bytes, control characters, percent signs (so nothing survives a
later decode), and Windows' silently-stripped trailing dots and spaces.

### 4.6 Token storage, and its known weakness

Tokens live in `localStorage`, so a refresh does not sign the user out. The
trade-off is real and stated rather than hidden: **an XSS would expose them.** An
httpOnly refresh cookie would be stronger, and the backend's CORS is already
configured with `credentials: true` so the move is contained. For an internal,
non-public tool with a sanitised content pipeline this is an acceptable position —
but it is the first thing to change if Scriptura ever becomes externally reachable.

---

## 5. The dual-dialect test strategy

**Runtime is MySQL. The test suite runs on in-memory SQLite.**

This was a deliberate decision made because no MySQL or Docker was available on the
build machine, and it has a genuine benefit: `npm test` is green on a fresh clone
with no database server installed. It also has genuine limits, and pretending
otherwise would be worse than the limitation itself.

### 5.1 What makes it safe

The same model definitions drive both. Everything the app relies on — JSON columns,
`LONGTEXT`, `TINYINT`, soft deletes, unique indexes — is expressed with portable
Sequelize DataTypes that both dialects implement.

`tests/unit/migration-parity.test.js` **executes the real migration files** against
SQLite and diffs the resulting schema against the models. That is what makes it
legitimate to build test schemas with `sync()` — the migration is exercised, and a
column added to a model but not to a migration fails the build.

### 5.2 What it does NOT verify

Be honest about this list:

- **MySQL-specific DDL behaviour.** Column widths, charset/collation, `ENGINE`,
  and MySQL's own constraint enforcement are declared but not executed.
- **Collation-dependent behaviour.** MySQL's default collation is
  case-insensitive; SQLite's `LIKE` is case-insensitive for ASCII only.
- **JSON path operators.** MySQL has `->>`; SQLite does not. The app never uses
  them — JSON columns are read and written whole — but nothing enforces that
  beyond convention.
- **Concurrency.** SQLite is single-writer. Race conditions that need real
  concurrent transactions are not covered.
- **`utf8mb4` storage.** Unicode round-trips are tested, but through SQLite's
  UTF-8, not MySQL's.

### 5.3 A real bug this trade-off caused

Worth recording, because it is exactly the failure mode to watch for. The blog
search originally escaped LIKE metacharacters with a backslash. That works on MySQL
(backslash is the default escape character) and **silently fails on SQLite**, which
has no default escape character and needs an explicit `ESCAPE` clause that
Sequelize's operator API does not expose.

The fix was to **strip** `%` and `_` rather than escape them, so behaviour is
identical on both dialects and predictable: searching `100%` searches for `100`.
The characters are not searchable, which for blog titles costs nothing. See
`buildSearchPattern` in `backend/src/services/blogService.js`.

### 5.4 The recommendation

Run the suite against real MySQL in CI before any production deploy:

```bash
# Point at a scratch MySQL database, then:
cd backend && npm run migrate && npm run seed
```

The integration tests are dialect-agnostic; only `src/config/index.js` chooses the
dialect, and it does so from `NODE_ENV`.

---

## 6. Generation pipeline

`draft → queued → generating → generated | failed`

### 6.1 In-process, not a queue

Generation runs **in the same process** — `startGeneration` returns immediately and
the work continues asynchronously. This is right for a single-instance internal
tool used by a handful of people, and it avoids operating Redis for a feature that
runs a few times a day.

It has two consequences:

1. **A process restart mid-generation leaves a row stuck in `generating`.**
   `reapStaleGenerations({ olderThanMs })` exists to recover those to `failed`, and
   is exposed as an endpoint so it can be called on boot or by a cron.
2. **It does not scale horizontally.** Two instances would both accept generations
   with no shared state, and the in-memory rate limiter would be per-instance.

The upgrade path is BullMQ + Redis, moving `generation.js`'s body into a worker.
The state machine on the row already models everything a queue would need.

### 6.2 The brand-voice gate

Spec Section 4 Step 2 requires a human to confirm the AI-derived voice before
generation. This is enforced **server-side**: if a brand voice was supplied
(`brand_voice_source_type !== 'none'`) but `brand_voice_confirmed !== true`, the
generation endpoint refuses with `422 BRAND_VOICE_NOT_CONFIRMED`. A UI-only gate
would be a suggestion; this is a rule.

### 6.3 Generation never publishes

On success the pipeline writes content and sets `generation_status = 'generated'`.
It **never** touches `blog_status`. Publishing is a separate, explicit action
behind a review step, and `assertPublishable` additionally refuses to publish a
blog with no content, a failed generation, or a run still in flight — publishing
any of those would put a broken page on the public site.

---

## 7. Other decisions worth knowing

### 7.1 Analytics aggregates in JavaScript, not SQL

Grouping by month needs `DATE_FORMAT` on MySQL and `strftime` on SQLite; bucketing
a score needs a `CASE` whose syntax differs again. Writing it twice would mean the
test suite exercises different code than production — the exact class of bug a
portable suite is meant to prevent.

So the queries stay simple and portable and the shaping happens in JS. The cost is
bounded: narrow column selection (never `blog_content`) over a table with low
thousands of rows. **Revisit past ~100k rows** or if the dashboard gets hot enough
for the full-table scan to matter — then move to dialect-specific SQL or a
materialised summary table.

### 7.2 Storage is abstracted; S3 is a deliberate stub

`StorageService` hides the driver. Database columns hold **storage-relative paths,
never URLs** (`blogs/July2026/xxx.png`), and `toPublicUrl()` resolves them at
serialisation time. That is what makes the S3 migration a `.env` change: the same
stored row works under both drivers.

The path convention matches production exactly — full English month name, no
separator before the year, **40** random alphanumerics (measured from the live
data; it is Laravel's `Str::random(40)`). `buildStoragePath()` is the single
implementation, used by the app *and* the seeders.

`S3Driver` is constructible and validates its config — so `STORAGE_DRIVER=s3`
fails **on boot** with a message naming the missing variables, rather than
mysteriously at first upload — but its I/O methods throw `501`. Its
`toPublicUrl()` *is* fully implemented, which is the asymmetry that lets existing
rows resolve to CDN URLs the moment `S3_PUBLIC_BASE_URL` is set.

### 7.3 Environment access is centralised, and enforced

Nothing under `src/` reads `process.env` except `src/config/`.
`tests/unit/config.test.js` greps the tree and fails otherwise. This started as a
comment claiming enforcement that did not exist; the test was written to make the
claim true.

Providers **degrade rather than crash**: a missing `ANTHROPIC_API_KEY` switches text
generation to the deterministic mock provider and logs a warning, so the whole app
stays clickable with no keys at all. `GET /api/v1/meta` exposes which providers are
live, and the UI surfaces a "Mock AI provider" notice so nobody mistakes canned
output for real generation.

### 7.4 SerpAPI is feature-flagged both ways

`config.serp.enabled` requires **both** the flag and a key, so a half-configured
deployment behaves like a disabled one instead of failing at call time.
`flagEnabled` and `hasKey` are exposed separately so `/health` can distinguish
"switched off" from "switched on but misconfigured". Every SERP-dependent UI
control is hidden rather than shown-and-broken, and the app is fully functional
with SERP off.

### 7.5 Chart colours are validated, not chosen by taste

The categorical palette in `frontend/tailwind.config.js` (`series-1..8`) was
validated as a set against the actual panel surface `#141221` for lightness band,
chroma floor, adjacent-pair colour-vision-deficiency separation (worst 8.4 ΔE),
normal-vision separation (worst 19.3 ΔE) and ≥3:1 contrast.

The rules that keep it valid: assign slots **in fixed order**, never cycle, never
generate a ninth hue (a ninth category folds into "Other"); `status.*` is reserved
and never doubles as a series colour; colour follows the entity, not its rank, so a
filter must not repaint the survivors. **Re-validate if `panel` changes** —
contrast results only mean something against the surface actually rendered on.
`constants.parity.test.js` pins the count, the disjointness from status colours,
and the surface.

### 7.6 `htmlparser2` is pinned to v9

`sanitize-html` pulls `htmlparser2` v12, which is **pure ESM with no CommonJS
build**. Node 24 can `require()` ESM so the app runs fine, but Jest's CommonJS
runtime cannot load it, which broke every test touching sanitisation. v9 is the
last CommonJS major and exposes the identical `Parser` API. The override is in
`backend/package.json` with the reasoning inline; remove it when the suite moves to
Jest's native ESM mode.

### 7.7 No `blogs`↔`users` association

`published_by` is a **free-text attribution string** on the existing production
table, not a foreign key. Turning it into one would change the meaning of data
other systems already read. So the two models are intentionally unrelated.

---

## 8. Adopting the schema in production

The dev migration creates a standalone table and **will fail against production**,
where `blogs` already exists. Use the adoption scripts instead.

### Runbook

1. **Back up.** Non-negotiable.
   ```bash
   mysqldump --single-transaction --routines --triggers \
     -h <host> -u <user> -p <database> blogs > blogs-backup-$(date +%F).sql
   ```
2. **Rehearse on a restored copy** of production and confirm the app works against
   it. The script has been exercised against the dev schema, never against the live
   table.
3. **Check size and pick a window.**
   ```sql
   SELECT table_rows, ROUND(data_length/1024/1024) AS data_mb
   FROM information_schema.tables
   WHERE table_schema = DATABASE() AND table_name = 'blogs';
   ```
   Every statement is an in-place `ALTER`, so reads and writes continue — but on a
   very large table use `gh-ost` or `pt-online-schema-change` instead.
4. **Apply.** Idempotent: each column and index is guarded by an
   `information_schema` check, so a second run changes nothing.
   ```bash
   mysql -h <host> -u <user> -p <database> \
     < backend/scripts/prod-adoption/001-add-ai-columns.sql
   ```
   It reports `ADDED` / `EXISTS` per column and verifies 41 new columns at the end.
5. **Point the app at it** (`DB_*` in `backend/.env`) and smoke-test: sign in, open
   an existing article, create a draft, run a generation, publish.
6. **Back-fill slugs — last, and only after step 5 passes.** This is the one step
   that writes to existing rows, which is why it is separate and opt-in.
   ```bash
   cd backend
   node scripts/prod-adoption/backfill-slugs.js --dry-run
   node scripts/prod-adoption/backfill-slugs.js --commit
   ```
   It reuses the application's own slug logic, so generated slugs match what the app
   would produce. Until it runs, existing rows have `slug = NULL`, which is harmless:
   the unique index permits many NULLs and the app addresses rows by id as well.

### Rollback

`backend/scripts/prod-adoption/002-rollback-ai-columns.sql` drops only what `001`
added. Original columns and row data are untouched, so published articles stay
published and readable — what is lost is block-level re-editing. **It discards
everything authored through Scriptura.** Back up first.

### One thing left undone

Existing rows have `blog_content` (HTML) but no `content_blocks`. Opening one in
the editor therefore shows an empty canvas. Two options, neither implemented
because neither should be chosen without the team present:

- **HTML → blocks importer** (parse existing `blog_content` into a best-effort
  block list). Lossy, and lossy in ways an author will notice.
- **Legacy read-only mode** — render `blog_content` directly and require an
  explicit "convert to blocks" action, so the loss is a decision rather than a
  surprise.

The second is the safer default and the recommendation.

---

## 9. Repository layout

```
backend/
  src/
    config/         env resolution + validation; the ONLY reader of process.env
    constants/      every enum, single source of truth
    models/         Blog (56 cols), User; the derived-content hook lives in Blog
    migrations/     portable, no raw SQL — the parity test executes them
    seeders/        realistic demo data; blog_content derived by the real renderer
    middleware/     auth, validate (Zod), rateLimit, errorHandler
    routes/v1/      one file per route group
    controllers/    thin; logic lives in services
    services/
      ai/           provider abstraction: Anthropic, OpenAI, Mock
      storage/      driver abstraction: local, S3 (stub)
      blocksToHtml  canonical renderer -> blog_content
      sanitize      the XSS boundary
      generation    the async state machine
      seoScore      transparent scoring heuristic
    validators/     Zod schemas; also the mass-assignment boundary
    docs/           OpenAPI, assembled from per-group fragments
  scripts/
    generate-block-fixtures.js
    prod-adoption/  001 add, 002 rollback, backfill-slugs
  tests/            unit + integration (SQLite)

frontend/
  src/
    components/
      BlockRenderer.js   used by BOTH the editor preview and the blog page
      ui/                primitives
      wizard/ editor/ charts/ blogs/ layout/
    context/AuthContext.js
    lib/           api client, constants mirror, sanitiser, media
    hooks/         debounce, autosave, interval
    pages/

shared/
  block-fixtures.json    generated; the cross-language renderer contract
```
