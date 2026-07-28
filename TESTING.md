# Testing

How Scriptura is tested, what the suites actually prove, and — just as important —
what they do not.

```bash
cd backend  && npm test     # 692 tests, 18 suites — no database required
cd frontend && npm test     # 163 tests, 10 suites
cd e2e      && npm test     #  16 tests,  2 specs — real browser, real stack
```

**871 tests, all passing.** Verified end to end on a clean run.

---

## Results

### Backend — ✅ 692 passing / 692, 18 suites

Verified on a clean run (`NODE_ENV=test npx jest --runInBand`), ~173s.

| Suite | Focus |
|---|---|
| `unit/config.test.js` | Env centralisation (greps `src/` for stray `process.env`), test-mode safety rails, frozen config |
| `unit/migration-parity.test.js` | **Executes the real migrations** and diffs the schema against the models |
| `unit/blocksToHtml.test.js` | Canonical renderer vs. shared fixtures; XSS; malformed-block robustness |
| `unit/sanitize` (in `blocksToHtml`) | Allow-list, `safeUrl`, control-character scheme splitting |
| `unit/authMiddleware.test.js` | Token-type separation, expiry vs. invalidity, role gating, immediate deactivation |
| `unit/seoScore.test.js` | The scoring heuristic — every criterion, weights summing to exactly 100 |
| `unit/brandVoice-parser.test.js` | Robust parsing of fenced/prose/partial model output; SSRF guard |
| `unit/generationConfig.test.js` | Generation-config validation |
| `unit/aiProviders.test.js` | Provider abstraction, retry/backoff, mock determinism |
| `unit/storage.test.js` | Path traversal (incl. Windows forms), production path convention, driver seam |
| `unit/logoComposite.test.js` | Overlay geometry for all five positions, clamping, EXIF orientation |
| `unit/serp.test.js` | Feature-flag behaviour |
| `integration/auth.test.js` | Login, refresh rotation, logout revocation, enumeration resistance |
| `integration/blogs.test.js` | CRUD, publish gating, soft delete/restore, mass assignment, search |
| `integration/generation.test.js` | Full pipeline, the brand-voice gate, failure **and retry** |
| `integration/brandVoice.test.js` | Text/URL/file analysis, SSRF blocked through the real HTTP stack |
| `integration/media.test.js` | Upload, AI generation, compositing, spoofed content-type rejection |
| `integration/analytics.test.js` | Aggregates, gap-filled series, null-vs-zero, SERP conditionality |
| `integration/serp.test.js` | 503 when disabled; app unaffected |

### Frontend — ✅ 163 passing / 163, 10 suites

Verified on a clean run (`CI=true npm test`), ~85s, **zero `act()` warnings**.

| Suite | Focus |
|---|---|
| `lib/__tests__/constants.parity.test.js` | Frontend enums match the backend's exactly; palette invariants |
| `lib/__tests__/api.envelope.test.js` | Every client wrapper unwraps its controller's real response shape |
| `components/__tests__/blockRenderer.parity.test.js` | React renderer's DOM matches the backend's HTML |
| `components/wizard/__tests__/titleScore.test.js` | The mirrored title-scoring heuristic, pinned to the backend's numbers |
| `pages/__tests__/wizard.test.js` | Step navigation, validation, the brand-voice gate, logo grid, polling, retry |
| `pages/__tests__/editor.test.js` | Keyboard drag-reorder, inline edit, undo/redo, autosave, publish guards |
| `components/editor/__tests__/blockHistory.test.js` | Undo coalescing, the 50-entry bound, redo-branch invalidation |
| `components/editor/__tests__/blockSettings.test.js` | Per-type settings panels, table/FAQ structural integrity |
| `pages/__tests__/dashboard.test.js` | KPI values, null-vs-zero, chart accessible names, SERP conditionality, table fallback |
| `pages/__tests__/blogList.test.js` | Filters→URL→API, debounced search, sorting, pagination, role-gated restore |

### End-to-end — ✅ 16 passing / 16, Playwright

```bash
cd e2e
npm install
npx playwright install chromium   # one-off, ~150 MB
npm test
```

**`full-flow.spec.js` (2 tests)** — the spec's required flow, verified green:

> login → brand voice from pasted text → generation wizard with mocked
> Claude/OpenAI → land in the block editor → publish → verify it appears in the
> blog list with the correct `blog_status`

It also asserts the two things most worth protecting: that generation does **not**
auto-publish (the article is still a draft when the editor opens), and that the
brand-voice confirm gate genuinely *blocks* before it is satisfied — checked by
attempting to advance and asserting the wizard stays put, so the test would fail if
the gate were deleted. A second test covers the refusal path: publishing a
content-less draft surfaces the 422 reason instead of failing silently.

**`responsive.spec.js` (14 tests)** — layout in a real browser. Measures
`documentScrollWidth` against the viewport across dashboard / blog list / block
editor / blog view at **375, 768 and 1440**, and asserts the nav collapses to a
keyboard-dismissable drawer below `lg`. On failure it names the offending elements,
because the entire cost of this bug class is finding which child is too wide.

This is the layer jsdom cannot cover: it has no layout engine, so `scrollWidth` is
always 0 and no media query matches. The component suites cover *conditional
rendering* at narrow widths; this covers *layout*.

Playwright starts both servers itself (API on :5055, web on :3055 — non-standard
ports so a run cannot silently pass against a stray dev server). The API boots via
`backend/scripts/e2e-server.js` under `NODE_ENV=test`, which forces in-memory SQLite
and the deterministic mock providers: **no MySQL, no API keys, no network, no spend,
and identical generated content every run.**

The responsive spec authenticates once via the API and injects the token, rather
than driving the login form 14 times — those tests are about layout, and the UI
sign-in is already covered by the critical path. Doing it the slow way pushed the
file past a ten-minute wall clock.

---

## The dual-dialect trade-off

**The backend suite runs on in-memory SQLite. The runtime targets MySQL.** This was
a deliberate decision (no MySQL or Docker on the build machine) and it buys a real
thing: `npm test` is green on a fresh clone with no database installed.

It also has limits, and the limits matter more than the convenience.

### What makes it trustworthy

`unit/migration-parity.test.js` **executes the actual migration files** against
SQLite and diffs the resulting schema against the model definitions. That is what
makes it legitimate to build test schemas with `sync()`: the migrations are
exercised, and a column added to a model but not to a migration fails the build.

Everything the app relies on — JSON columns, `LONGTEXT`, `TINYINT`, soft deletes,
unique indexes — is expressed with portable DataTypes both dialects implement, and
one set of model definitions drives both.

### What it does NOT verify

- **MySQL-specific DDL.** Column widths, charset/collation, `ENGINE` are declared
  but never executed.
- **Collation-dependent behaviour.** MySQL's default collation is
  case-insensitive; SQLite's `LIKE` is ASCII-only.
- **JSON path operators** (`->>`). Unused by design, but nothing enforces that.
- **Concurrency.** SQLite is single-writer, so races needing real concurrent
  transactions are untested. The generation in-flight check is check-then-write,
  not a distributed lock.
- **`utf8mb4` storage.** Unicode round-trips are tested through SQLite's UTF-8.

### A real bug this caused

Worth recording, because it is exactly the failure mode to watch for. Blog search
originally escaped LIKE metacharacters with a backslash — correct on MySQL, where
backslash is the default escape character, and **silently broken on SQLite**, which
has no default escape character and needs an explicit `ESCAPE` clause Sequelize's
operator API does not expose.

The test caught it. The fix was to **strip** `%` and `_` rather than escape them, so
behaviour is identical on both dialects. See `buildSearchPattern` in
`backend/src/services/blogService.js`.

### Recommendation

Run the suite against real MySQL in CI before any production deploy. The tests are
dialect-agnostic; only `src/config/index.js` selects the dialect, from `NODE_ENV`.

---

## The two parity tests

These are the highest-value tests in the repo, because they guard invariants no
single-file test can.

### Migration ↔ model

`backend/tests/unit/migration-parity.test.js` — asserts the 56 blog columns and 10
user columns match between the migration and the model, that all 15 contractual
production columns survive, that the required indexes exist, that `down` rolls back
cleanly, and that neither table has an `organization_id` (guarding the deliberate
no-multi-tenancy scope decision).

### Backend renderer ↔ frontend renderer

`frontend/src/components/__tests__/blockRenderer.parity.test.js` — asserts the React
`BlockRenderer` produces the same DOM as the backend's `blocksToHtml`, from
`shared/block-fixtures.json` (generated from the backend, which is canonical).

Comparison is via an `innerHTML` round-trip on both sides rather than raw string
equality, because the backend writes `<img … />` while `innerHTML` reads back
`<img …>` — a meaningless HTML5 void-element difference. Attribute order, classes
and text are still compared exactly.

**This test earned its place immediately.** It caught two real divergences:

1. The frontend sanitiser *unwrapped* `<script>` elements, leaving `alert(1)` as
   visible text in the article, where the backend correctly discards the content.
2. The FAQ answer container vanished when empty, where the backend always emits it.

Both were fixed in the frontend, since the backend is canonical.

Regenerate fixtures after a deliberate markup change:

```bash
node backend/scripts/generate-block-fixtures.js
```

### API client ↔ controller envelope

`frontend/src/lib/__tests__/api.envelope.test.js` — the backend uses two response
shapes (`{data: …}` for blogs and analytics, top-level for generation, brand voice,
media and SERP) and every wrapper has to unwrap the right one.

This caught a live bug: **eight wrappers unwrapped one level too deep**, so every AI
feature would have resolved to `undefined` against a real server. The failure is
silent — the promise resolves, the component renders an empty state, and it looks
like a data problem rather than a client bug — which is exactly why it needs a test
rather than care. Fixtures are transcribed from the controllers' actual
`res.json(...)` calls, and it stubs only the axios *adapter*, so the interceptors and
unwrapping all run for real.

---

## Conventions

- **`NODE_ENV=test` is a safety rail, not just a switch.** `tests/setup.js` refuses
  to run unless the dialect is SQLite and both AI providers are mocks — so a stray
  run cannot touch production MySQL or spend money at a provider.
- **No network, ever.** Providers are mocked in-process (which exercises the real
  provider abstraction), and the SSRF test asserts *no outbound request is made*.
- **`--runInBand`.** Every worker would otherwise build its own schema; serialising
  keeps the single SQLite writer uncontended and the output readable.
- **Factories over fixtures.** `tests/helpers/factories.js` produces a valid minimal
  record and merges overrides, so a test states only the field it cares about.
- Frontend tests mock `src/lib/api.js` rather than intercepting HTTP.

### One factory subtlety worth knowing

`seo_score` is **derived** — a model hook recomputes it from `content_blocks` on
save — so a value passed to `create()` is immediately overwritten. `createBlog`
therefore applies an explicit `seo_score` in a second save, where `content_blocks`
is unchanged and the hook correctly leaves it alone. Tests asserting on averages or
distribution buckets depend on this.

---

## Coverage

```bash
cd backend  && npm run test:coverage
cd frontend && npm run test:coverage
```

Migrations and seeders are excluded from backend coverage — they are verified by
tests that *execute* them, and counting their lines distorts the useful number.
