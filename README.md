# Scriptura

**Divinetalk's internal AI blog automation tool.** Generate, edit, manage and
publish SEO-optimised articles at scale — without WordPress or Elementor.

> *Scriptura* (सूत्र) — "thread". Suggested in place of the working name
> *ContentForge*: it fits Divinetalk's subject matter, and it reads well as an
> internal tool. Rename freely; the name appears in `package.json`, the page title,
> the sidebar and the OpenAPI `info.title`.

Built for **one organisation** (Divinetalk's own team). There is no tenancy model
and multi-tenancy is deliberately out of scope — see
[ARCHITECTURE.md §1](ARCHITECTURE.md#1-scope-single-organisation-deliberately).

---

## What it does

- **6-step generation wizard** — topic and title with live, *explained* SEO scoring;
  brand-voice analysis from pasted text, a scraped URL or an uploaded document;
  content configuration with SEO-structure toggles, internal linking and outline
  building; AI images with a visual logo-position picker; publish settings; then
  async generation with live status.
- **Visual block editor** — 10 block types, drag-and-drop reorder, inline editing,
  per-block settings, undo/redo, debounced autosave.
- **Dashboard** — publishing cadence, SEO-score distribution, word-count trends,
  status breakdown, top keywords, and (when SerpAPI is configured) ranking trends.
- **Never auto-publishes.** Generation always lands in the editor for human review.

---

## Quick start

### Option A — Docker (nothing else to install)

```bash
docker compose up --build
```

- Web app → <http://localhost:3000>
- API → <http://localhost:5000>
- API docs → <http://localhost:5000/api-docs>

MySQL is provisioned, migrations are applied, and demo data is seeded on first
boot. **API keys are optional** — without them the app runs end-to-end on
deterministic mock providers.

### Option B — Local Node

Requires Node ≥ 18 (built and tested on 24) and a reachable MySQL 8.

```bash
# 1. Backend
cd backend
cp .env.example .env          # then fill in DB_* and the JWT secrets
npm install
npm run migrate
npm run seed
npm run dev                   # → http://localhost:5000

# 2. Frontend (second terminal)
cd frontend
npm install
npm start                     # → http://localhost:3000
```

CRA proxies `/api` to `localhost:5000`, so no CORS setup is needed in development.

### Sign in

Seeded development accounts — password **`Scriptura@Dev2026`** for all three:

| Email | Role | Password |
|---|---|---|
| `shivamkumar@divinetalk.in` | admin | `123456` |
| `harsh@divinetalk.in` | admin | `Scriptura@Dev2026` |
| `ananya@divinetalk.in` | editor |
| `rohit@divinetalk.in` | editor |

The seeder refuses to run when `NODE_ENV=production`.

---

## Configuration

Everything is environment-driven. Copy `backend/.env.example` → `backend/.env`;
it is ordered so only the top block needs filling in.

**Required for real use**

| Variable | Notes |
|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Must differ from each other. ≥32 chars in production, where boot fails without them. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | MySQL 8. |
| `CORS_ORIGIN` | The web app's origin. Comma-separate for several. |

**Optional**

| Variable | Behaviour when absent |
|---|---|
| `ANTHROPIC_API_KEY` | Text generation falls back to the mock provider and logs a warning. The app stays fully usable. |
| `OPENAI_API_KEY` | Image generation falls back to a locally generated placeholder. |
| `SERPAPI_ENABLED` / `SERPAPI_KEY` | Web grounding and rank checking stay off; every SERP-dependent control is hidden rather than shown-and-broken. Both are required — a flag with no key behaves as disabled. |
| `LOGO_PATH` | Falls back to the bundled placeholder at `backend/src/assets/logo.png`. **Swap in the real Divinetalk logo here.** |
| `STORAGE_DRIVER` | `local` (default) or `s3`. S3 is stubbed: it fails fast on boot with the variables it needs. |

Boot prints every degradation explicitly, so a mock provider is never mistaken for
a real one. `GET /api/v1/meta` exposes the same information to the UI, which shows
a "Mock AI provider" notice.

---

## Commands

### Backend (`cd backend`)

| Command | What it does |
|---|---|
| `npm run dev` | Start with reload |
| `npm start` | Start |
| `npm run migrate` | Apply migrations |
| `npm run migrate:undo` | Roll back the last migration |
| `npm run seed` | Seed demo data |
| `npm run db:reset` | Drop, migrate, seed |
| `npm test` | Full suite (in-memory SQLite; no DB needed) |
| `npm run test:coverage` | With coverage |
| `npm run lint` | ESLint |

### Frontend (`cd frontend`)

| Command | What it does |
|---|---|
| `npm start` | Dev server on :3000 |
| `npm run build` | Production bundle |
| `npm test` | Full suite |
| `npm run test:watch` | Watch mode |

### End-to-end (`cd e2e`)

```bash
npm install
npx playwright install chromium   # one-off, ~150 MB
npm test
```

Drives the real stack: sign in → brand voice from pasted text → run the wizard with
mocked providers → land in the block editor → publish → verify it appears in the
list with the correct `blog_status`.

---

## Testing

`npm test` in `backend/` needs **no database** — the suite runs on in-memory
SQLite while the runtime targets MySQL. That is a deliberate trade-off with real
limits; [TESTING.md](TESTING.md) has the coverage summary and
[ARCHITECTURE.md §5](ARCHITECTURE.md#5-the-dual-dialect-test-strategy) explains
exactly what it does and does not verify, including a bug the split actually caused.

Two tests are load-bearing and worth knowing about:

- **`backend/tests/unit/migration-parity.test.js`** executes the real migration
  files and diffs the schema against the models. A column added to one but not the
  other fails the build.
- **`frontend/src/components/__tests__/blockRenderer.parity.test.js`** asserts the
  React renderer produces the same DOM as the backend's HTML renderer, from shared
  fixtures. It caught two real divergences during the build.

---

## API

- **Swagger UI** — <http://localhost:5000/api-docs> (non-production)
- **Raw spec** — <http://localhost:5000/openapi.json> (all environments)
- **Reference** — [API.md](API.md)

Versioned under `/api/v1`. Every error uses one envelope:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": { "fieldErrors": {} } } }
```

Two behaviours worth knowing before writing a client:

- **`blog_content` is read-only.** It is derived from `content_blocks` on every
  save; writing it directly has no effect.
- **Server-owned fields are ignored on write** — `seo_score`, `word_count`,
  `total_views`, `generation_status`, `serp_rank_*`. Posting them is silently
  dropped rather than trusted.

---

## Deploying

1. Set `NODE_ENV=production`. Config then *requires* real JWT secrets and DB
   credentials and refuses to boot without them.
2. Set `TRUST_PROXY` if behind nginx/ALB — otherwise rate limiting keys every
   request to the proxy's address. It is off by default so a directly-exposed
   deployment cannot be spoofed via `X-Forwarded-For`.
3. Lock `CORS_ORIGIN` to the real web origin.
4. Run migrations: `npm run migrate`. Swagger UI is automatically disabled in
   production; `/openapi.json` remains.
5. **Adopting the existing production `blogs` table is a separate, documented
   procedure** — do *not* run the dev migration against it. Follow the runbook in
   [ARCHITECTURE.md §8](ARCHITECTURE.md#8-adopting-the-schema-in-production), which
   uses the idempotent, reversible scripts in
   `backend/scripts/prod-adoption/`.

---

## Known limitations

Stated plainly rather than discovered later:

- **Generation runs in-process, not on a queue.** Right for a single-instance
  internal tool; it does not scale horizontally, and a restart mid-generation needs
  `reapStaleGenerations` to recover the row. Upgrade path: BullMQ + Redis.
- **Rate limiting is in-memory**, so it is per-instance. Multiple instances need a
  shared store.
- **Tokens live in `localStorage`** — an XSS would expose them. An httpOnly refresh
  cookie is the hardening step, and CORS is already configured for it.
- **Existing production rows have no `content_blocks`**, so they open to an empty
  editor canvas. Two migration options are written up in ARCHITECTURE.md §8; neither
  is implemented because the choice is lossy and should be made with the team.
- **Brand voices cannot be reused across blogs** without copying — the deliberate
  cost of the single-table design. Normalisation path in ARCHITECTURE.md §2.4.
- **Analytics aggregates in application code**, not SQL. Fine to low thousands of
  rows; revisit past ~100k.
- **S3 storage is a stub.** The seam is complete and `toPublicUrl` works, but the
  I/O methods throw. Adding `@aws-sdk/client-s3` and implementing four methods is
  the whole job.

---

## Documentation

| File | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Design decisions, trade-offs, the production runbook |
| [API.md](API.md) | Endpoint reference |
| [TESTING.md](TESTING.md) | Coverage and results |
