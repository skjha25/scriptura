# API reference

Base URL: `/api/v1` · Interactive: `/api-docs` · Machine-readable: `/openapi.json`

The OpenAPI document is generated from per-route-group fragments in
`backend/src/docs/paths/` and is the authoritative schema. **This file covers what
a schema cannot tell you**: the semantics you need to know before writing a client,
and the mistakes that are easy to make.

---

## Five things to know first

### 1. `blog_content` is read-only

It is HTML *derived* from `content_blocks` on every save by a model hook. Sending it
has no effect — the hook overwrites it from the blocks on the same save. Send
`content_blocks`; read `blog_content` if you need the rendered HTML.

### 2. Server-owned fields are silently dropped on write

`id`, `total_views`, `seo_score`, `word_count`, `generation_status`,
`generation_error`, `serp_rank_*`, `created_at`, `deleted_at`.

The validators do not declare them, so Zod strips them. Posting `seo_score: 100`
is not an error and does not do anything — the score is measured, not claimed.

### 3. Generation never publishes

`POST /generate/article` writes content and sets `generation_status: 'generated'`.
It never touches `blog_status`. Publishing is a separate, explicit call.

### 4. Optional features are discoverable, not guessable

Call `GET /meta` (unauthenticated) on boot. SERP endpoints return
`503 FEATURE_DISABLED` when SerpAPI is not configured, and the analytics payload
omits `serp_rank` entirely. Check `features.serp_api` rather than offering a control
that will fail.

### 5. One error envelope, everywhere

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": { "fieldErrors": { "body.blog_title": ["blog_title is required."] } }
  }
}
```

Branch on `code`, never on `message`. Field errors are keyed `part.field`
(`body.`, `query.`, `params.`) so a bad query param and a bad body field are
distinguishable — and both are reported in one response rather than one round trip
at a time.

---

## Endpoints

### Auth

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/login` | Public. Rate limited. Returns a token pair + profile. |
| `POST` | `/auth/refresh` | Public. **Rotates both tokens.** |
| `POST` | `/auth/logout` | Revokes every refresh token for the account. |
| `GET` | `/auth/me` | Hydrate the current user after a refresh. |

Access tokens last 15 minutes; refresh tokens 7 days. A `401 TOKEN_EXPIRED` means
refresh; a `401 TOKEN_INVALID` or `401 REFRESH_TOKEN_REVOKED` means sign in again.

There is **no registration endpoint** — accounts are provisioned out-of-band.

### Blogs

| Method | Path | Notes |
|---|---|---|
| `GET` | `/blogs` | Paginated. Omits `blog_content`. `X-Total-Count` header. |
| `POST` | `/blogs` | Always created as a draft, whatever status you ask for. |
| `GET` | `/blogs/linkable` | Published blogs only, for the internal-link picker. |
| `GET` | `/blogs/{id}` | Full record incl. `content_blocks` and `blog_content`. |
| `PATCH` | `/blogs/{id}` | Partial. Sending `content_blocks` regenerates derived fields. |
| `DELETE` | `/blogs/{id}` | **Soft** delete. Nothing here hard-deletes. |
| `POST` | `/blogs/{id}/publish` | Publishes or schedules. Refuses unusable content. |
| `POST` | `/blogs/{id}/restore` | **Admin only.** |
| `GET` | `/blogs/{id}/generation-status` | Poll target. |

**List filters:** `page`, `limit` (≤100), `status`, `generation_status`, `category`,
`q`, `sort`, `order`, `include_deleted` (admin only).

`status` takes a number or a label, and comma-separates for several:
`?status=published`, `?status=0,2`, `?status=draft,scheduled`.

`sort` is an allow-list — `created_at`, `updated_at`, `publish_date`, `blog_title`,
`total_views`, `seo_score`, `word_count`. Anything else is `422`, because the value
reaches `ORDER BY`.

`q` searches `blog_title`, `topic` and `seo_keywords`. **`%` and `_` are stripped,
not escaped** — they cannot be escaped portably across MySQL and SQLite, so
searching `100%` searches for `100`. A term of only wildcards is ignored rather than
matching everything.

`POST /blogs/{id}/publish` returns `422` with a specific code when the blog is not
publishable: `NO_CONTENT`, `NO_RENDERED_CONTENT`, `GENERATION_FAILED`,
`GENERATION_IN_PROGRESS`. `{"scheduled": true}` requires `publish_date`.

### Generation

| Method | Path | Notes |
|---|---|---|
| `POST` | `/generate/title` | Titles with SEO scores **and breakdowns**. |
| `POST` | `/generate/outline` | Generated outline. |
| `POST` | `/generate/article` | Async. Returns immediately; poll for the result. |
| `GET` | `/generate/status/{blogId}` | Same handler as the `/blogs` variant. |

All are rate limited more tightly than the rest of the API, because each call spends
real money at a provider.

`POST /generate/article` refuses with **`422 BRAND_VOICE_NOT_CONFIRMED`** when a
brand voice was supplied but `brand_voice_confirmed` is not `true`. This is enforced
server-side; a UI-only gate would be a suggestion.

It refuses with `409 GENERATION_IN_PROGRESS` when a run is already queued or
running for that blog.

State machine: `draft → queued → generating → generated | failed`. Poll until the
status leaves `queued`/`generating`. On `failed`, `generation_error` explains why
and the run is retryable.

### Brand voice

| Method | Path | Notes |
|---|---|---|
| `POST` | `/brand-voice/analyze` | JSON (`text` or `url`) **or** multipart file. |

Accepts `.txt` and `.docx`, ≤2 MB. The URL path is SSRF-guarded: loopback,
link-local, RFC1918 and metadata hosts are rejected, redirects are capped and
re-checked.

Returns `{tone, pov, traits[], summary, source_ref}`. **Persist
`brand_voice_confirmed: true` via `PATCH /blogs/{id}` once a human has approved it**
— generation is blocked until you do.

### Media

| Method | Path | Notes |
|---|---|---|
| `POST` | `/media/upload` | Multipart image. Content is verified, not trusted. |
| `POST` | `/media/generate-image` | AI generation. Rate limited. |
| `POST` | `/media/composite-logo` | Apply/re-apply the logo overlay. |

Responses carry both `relativePath` (**store this**) and `publicUrl` (render this).
The database holds paths, never URLs — that is what makes the S3 migration a `.env`
change.

Upload validates actual file content (magic bytes / decode), so a spoofed
`Content-Type` is rejected. EXIF is stripped — uploaded photos can carry GPS.

### SERP — feature-flagged

| Method | Path | Notes |
|---|---|---|
| `POST` | `/serp/check-rank` | Google position for a keyword. |
| `POST` | `/serp/ground-facts` | Web grounding for generation. |

Both return `503 FEATURE_DISABLED` unless `SERPAPI_ENABLED=true` **and**
`SERPAPI_KEY` is set. The rest of the app is fully functional without them.

### Analytics

| Method | Path | Notes |
|---|---|---|
| `GET` | `/analytics/overview` | Everything the dashboard renders, one request. |
| `GET` | `/analytics/in-flight` | Queued/running generations, for live progress. |

`?months=1..36` (bounded because aggregation happens in application code).

Two things clients get wrong here:

- **`null` is not `0`.** `avg_seo_score` and `avg_word_count` are `null` when
  nothing is scored, and `word_count_trend[].avg_word_count` is `null` for a month
  with no articles. Render a gap; plotting `0` asserts something false.
- **`serp_rank` is absent** unless SerpAPI is configured. Check
  `meta.serp_enabled`.

Time series are **gap-filled**: a month with no posts appears with `count: 0`, so
the x-axis does not silently compress.

### Meta / health

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/meta` | Public. Capabilities + every enum + defaults. |
| `GET` | `/health` | Public. Unversioned. For load balancers. |

---

## Status codes

| Code | Meaning here |
|---|---|
| `400` | Malformed JSON, oversized body, bad upload |
| `401` | Missing/expired/invalid token, or bad credentials |
| `403` | Wrong role, or a deactivated account |
| `404` | No such resource |
| `409` | Duplicate slug, or a generation is in progress |
| `413` | Upload too large |
| `422` | Validation failed, or a business rule refused (see `code`) |
| `429` | Rate limited — `details.retryAfterSeconds` |
| `502` | An AI or SERP provider failed or timed out |
| `503` | Feature disabled, or the database is unavailable |

---

## Worked example

```bash
API=http://localhost:5000/api/v1

# 1. Sign in
TOKEN=$(curl -s -X POST $API/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"harsh@divinetalk.com","password":"Scriptura@Dev2026"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')

# 2. Create a draft
BLOG=$(curl -s -X POST $API/blogs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"blog_title":"Shravan Month Rituals","topic":"shravan rituals","seo_keywords":"shravan rituals"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.id')

# 3. Analyse a brand voice, then CONFIRM it (generation is blocked until you do)
curl -s -X POST $API/brand-voice/analyze \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"source_type":"text","text":"We write warmly and reverently, explaining Sanskrit terms plainly."}'

curl -s -X PATCH $API/blogs/$BLOG \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"brand_voice_source_type":"text","brand_voice_tone":"Warm, reverent","brand_voice_confirmed":true}'

# 4. Generate (async), then poll
curl -s -X POST $API/generate/article \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"blog_id\":$BLOG}"

curl -s $API/blogs/$BLOG/generation-status -H "Authorization: Bearer $TOKEN"

# 5. Publish once status is "generated" and a human has reviewed it
curl -s -X POST $API/blogs/$BLOG/publish \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
```
