# Client Publish Flow (Create + Update)

How Scriptura sends a published blog to a client's own API (DivineTalk today), and how a **republish updates the client's existing post** instead of creating a duplicate.

Read this before changing anything in delivery, the Config page, the DivineTalk integration, or how the featured image (`blog_picture`) is generated (§13), or how internal blog links are written (§14, §15).

> **Status (2026-09-15)**
> - Scriptura side: built, deployed to production, and configured.
> - DivineTalk (Laravel) side: `blog-info/save` and `blog-info/update` are **both live** (update confirmed live 2026-09-22). A republish of a blog with a captured id now updates instead of duplicating.
> - Featured images (2026-09-15, deployed): 1920×1080, blur fill, never cropped; default style `illustration` with a hopeful-mood prompt (§13). Images generated earlier stay cropped until regenerated.
> - Internal blog links (2026-09-17, deployed to production): always `https://divinetalk.in/blog/<slug>`, never relative (§14).
> - Internal link slugs (2026-09-22, deployed to production): the model's invented slugs are now repaired against the real ones, and links in lists/FAQs/tables/CTAs are checked at all (§15). Backfill run on production: 6 blogs fixed, **awaiting republish**.
> - FAQ blocks (2026-09-22, deployed to production): render open as `<h3>` question + answer, no longer a `<details>` accordion (§16).
> - Git: the code is **not committed yet**.

---

## 1. The problem this solves

Before this change, every publish (including **Republish** in the editor) made the same `POST` to `blog-info/save`. No identifier for the existing post was sent, so DivineTalk created a **new blog every time**. Edits to content or the picture never reached the live post.

Production evidence: blog `110` was delivered 4 times in 2 minutes on 2026-09-09 (delivery logs 25–28). Each delivery returned HTTP 201, so DivineTalk now has 4 copies of that blog.

The fix:
1. Save the client's post id from the create response.
2. On a later publish of the same blog, call the client's **update** endpoint with that id.

---

## 2. End-to-end flow

```
Editor "Publish"/"Republish"            Scheduled publish (cron, every minute)
  POST /api/v1/blogs/:id/publish          services/scheduledPublisher.js
  controllers/blogs.controller.js         publishScheduledBlogs()
          │ (awaited, result shown           │ (fire-and-forget)
          │  in editor notice)               │
          └──────────────┬───────────────────┘
                         ▼
     clientDeliveryService.deliverIfConfigured(blog, { trigger })
       for each ENABLED publishing_integration:
                         ▼
     attemptDelivery(blog, integration, { idempotencyKey, attemptNumber, traceId })
                         ▼
     resolveDeliveryTarget(blog, integration)
       ├─ update_endpoint_url empty                          → CREATE
       ├─ no earlier log for this blog+integration with
       │  status='delivered' AND external_post_id NOT NULL   → CREATE
       └─ otherwise                                          → UPDATE (uses the latest such log's external_post_id)
                         ▼
     sendPayload(blog, integration, targetUrl, { extraFields })
       - buildPayload() applies the admin's field mappings
       - UPDATE adds { [update_id_field || 'id']: external_post_id }
       - JSON or multipart (featured image fetched and attached as a real file)
       - axios.post, 15s timeout, no redirects
       - on 2xx: externalPostId = response.data at response_id_path
                         ▼
     publishing_delivery_logs row
       delivery_mode       = 'create' | 'update'
       status              = 'delivered' | 'failed'
       external_post_id    = id from response, else the id we just updated
       response_summary    = sanitized body, first 2000 chars
```

**Retry** (Config page → Delivery Logs → Retry, `POST /api/v1/config/delivery-logs/:logId/retry`):
- It calls the same `attemptDelivery`, so create vs update is **decided again on every retry**.
- If a later publish already captured an id, the retry updates that post instead of creating a duplicate.
- It reuses the original idempotency key and is capped at `MAX_MANUAL_RETRIES = 5`.

### Rules that matter
| Situation | What happens |
|---|---|
| Blog edited, saved, **not** republished | Nothing is sent. Autosave only writes to Scriptura's DB (`PATCH /blogs/:id`). |
| First publish of a blog | CREATE → `endpoint_url`; client's id captured through `response_id_path` |
| Republish of a blog with a captured id | UPDATE → `update_endpoint_url` with `id` |
| Republish of a blog published **before** this change (no captured id) | CREATE → another duplicate. See §6 to backfill. |
| `response_id_path` empty | An id is never captured, so every publish is CREATE (the old behavior). |
| `update_endpoint_url` empty | Every publish is CREATE (the old behavior). |
| Update call fails (e.g. endpoint not live) | Log is `failed` and no duplicate is created. The last successful create log still holds the id, so the next republish or retry tries UPDATE again. |
| Delivery fails for any reason | The Scriptura publish itself is never blocked or reversed; delivery is best-effort. |
| Test Connection (Config page) | Always uses `test_endpoint_url` or `endpoint_url` (create). It never writes a log and never uses update. |

---

## 3. Code map

### Backend
| File | Role |
|---|---|
| `backend/src/services/delivery/clientDeliveryService.js` | `deliverIfConfigured`, `resolveDeliveryTarget`, `attemptDelivery`, `sendPayload` (`extraFields`), `retryDelivery`, `testConnection` |
| `backend/src/services/delivery/payloadMapper.js` | `BLOG_FIELD_ALLOWLIST` (the only valid `scriptura_field` values), `buildPayload`, `setAtPath` |
| `backend/src/services/delivery/credentialCrypto.js` | AES-256-GCM for stored credentials (`CONFIG_ENCRYPTION_KEY`) |
| `backend/src/controllers/blogs.controller.js` → `publish` | Manual publish/republish; returns `{ data, delivery }` |
| `backend/src/services/scheduledPublisher.js` | Scheduled publish; calls `deliverIfConfigured` without waiting for it |
| `backend/src/controllers/publishingIntegration.controller.js` | `/config` CRUD; `serializeIntegration` exposes `update_endpoint_url` and `update_id_field` |
| `backend/src/validators/publishingIntegration.validators.js` | Zod: `update_endpoint_url` (optional URL), `update_id_field` (optional path) |
| `backend/src/models/publishingIntegration.js` | + `update_endpoint_url`, `update_id_field` |
| `backend/src/models/publishingDeliveryLog.js` | + `delivery_mode` |
| `backend/src/migrations/20260914120000-add-update-endpoint-to-publishing-integrations.js` | Adds the 2 integration columns |
| `backend/src/migrations/20260914120100-add-delivery-mode-to-publishing-delivery-logs.js` | Adds `delivery_mode` ENUM('create','update'), default `'create'` (backfills old rows correctly) |

### Frontend
| File | Role |
|---|---|
| `frontend/src/pages/ConfigIntegrationDetailPage.js` | "Update endpoint URL" and "Update ID field" inputs; `create`/`update` badge on each delivery log |
| `frontend/src/pages/EditorPage.js` → `handlePublish` | Notice: `Client API: created on N, updated on N, failed for N` |
| `frontend/src/lib/api.js` → `blogsApi.publish` | Returns `{ ...blog, delivery }` (delivery rows include `delivery_mode`) |

### API routes (`/api/v1/config`, all `requireAuth`)
`GET /available-fields` · `GET|POST /integrations` · `GET|PATCH /integrations/:id` · `PUT /integrations/:id/field-mappings` · `POST /integrations/:id/test-connection` · `GET /integrations/:id/delivery-logs` · `POST /delivery-logs/:logId/retry`

---

## 4. DivineTalk contract

### Create: `POST https://admin.divinetalk.live/api/blog-info/save`
- Format: `multipart/form-data`. `blog_picture` must be a real uploaded image; it is compressed to fit `max_file_kb = 2048`.
- Auth: none.
- Field mappings (6):

| Client field | Scriptura source | Notes |
|---|---|---|
| `blog_title` | `blog.title` | required |
| `blog_content` | `blog.content` | rendered HTML, required |
| `blog_picture` | `images.featured_image` | file, required |
| `blog_status` | `publishing.status_code` | `1` = published |
| `start_date` | `publishing.start_date` | `YYYY-MM-DD` of publish date |
| `end_date` | `publishing.end_date` | publish date + 15 years |

- Response (HTTP 201), as seen in production logs:
  ```json
  {"success":true,"status_code":201,"error":null,"errors":[],
   "data":{"blog_picture":"blogs/September2026/xxx.jpg","blog_title":"...","blog_content":"...", ... }}
  ```
- **Post id path: `data.id`.**
  - Not directly confirmed: logs keep only the first 2000 characters, and `blog_content` pushes `id` past that cut.
  - Laravel normally appends `id` at the end of a created model.
  - The id is extracted from the **full** response, so the cut doesn't matter for extraction.
  - To confirm, check that `external_post_id` gets filled after the next publish (§7).

### Update: `https://admin.divinetalk.live/api/blog-info/update` (live since 2026-09-22)
Validation rules from the Laravel team:
```php
'id'           => 'required|integer|exists:blogs,id',
'blog_picture' => 'nullable|image|mimes:jpeg,png,jpg,gif',
'blog_title'   => 'required|string|max:255',
'blog_content' => 'required|string',
'blog_status'  => 'required|in:0,1',
'start_date'   => 'required|date',
'end_date'     => 'required|date|after_or_equal:start_date',
```
- Method is **assumed POST** (multipart file upload). Confirm with the Laravel team when it goes live.
- Scriptura sends the same 6 mapped fields plus `id`. The picture is always sent, so picture changes also update.

---

## 5. Current production configuration (Config → DivineTalk, integration id `1`)
Set through the UI on 2026-09-14 and checked after a page reload:

| Setting | Value |
|---|---|
| Enabled | yes |
| Endpoint URL | `https://admin.divinetalk.live/api/blog-info/save` |
| Update endpoint URL | `https://admin.divinetalk.live/api/blog-info/update` |
| Update ID field | *(empty → `id`)* |
| Request format | Multipart form-data |
| Max file size | 2048 KB |
| Authentication | None |
| Post ID path | `data.id` |
| Post URL path | *(empty)* |

**Update went live 2026-09-22.** Any delivery log still sitting at `failed` from before that date can be retried now — press **Retry** on it. The §7 acceptance test has not been run against the live update endpoint yet.

---

## 6. Legacy blogs (published before 2026-09-14)

These have no `external_post_id`, so republishing them creates another copy. To bring one into the update flow:
1. Get the blog's **real DivineTalk id** from the Laravel team (the copy to keep). Ask them to delete the extra copies, e.g. the 3 extra copies of blog 110.
2. On the server, set that id on the blog's latest **successful** delivery log:
   ```sql
   SELECT id, blog_id, status, created_at FROM publishing_delivery_logs
   WHERE blog_id = <scriptura blog id> AND status = 'delivered' ORDER BY id DESC LIMIT 1;

   UPDATE publishing_delivery_logs SET external_post_id = '<DivineTalk id>' WHERE id = <log id from above>;
   ```
   For blog 110 that log is `28`.
3. The next republish of that blog goes to UPDATE.

---

## 7. Verifying on production

Open MySQL on the server. Docker needs `sudo` there. Use the interactive shell, because pasting SQL inside `-e "..."` breaks on quotes.
```bash
cd ~/shivam-scriptura
sudo docker exec -it scriptura-mysql mysql -uscriptura -p scriptura   # DB_PASSWORD from the server .env
```
```sql
-- Latest deliveries: mode, result, captured id
SELECT id, blog_id, status, delivery_mode, http_status, external_post_id, LEFT(error,120) AS err, created_at
FROM publishing_delivery_logs ORDER BY id DESC LIMIT 10;

-- Response body (first 600 chars)
SELECT id, LEFT(JSON_UNQUOTE(JSON_EXTRACT(response_summary,'$.body')),600) AS body
FROM publishing_delivery_logs ORDER BY id DESC LIMIT 3;
```

Acceptance test once Laravel's update is live:
1. Publish a new blog, then check the log: `create` / `delivered` / `external_post_id` = a number.
2. Edit the same blog and click Republish. The editor notice should say `updated on 1`.
3. Check the log: `update` / `delivered`. The live DivineTalk post shows the new content and picture, and no new post exists.

---

## 8. Deploying changes

Image names and tags are fixed. The server's compose file pulls exactly these:
- `divinetalk/scriptura-backend:latest` (from `backend/`)
- `divinetalk/scriptura-frontend:latest` (from `frontend/`; no build args needed, the API base is resolved at runtime)

```bash
# local
docker tag divinetalk/scriptura-backend:latest  divinetalk/scriptura-backend:pre-<change>    # local rollback point, not pushed
docker tag divinetalk/scriptura-frontend:latest divinetalk/scriptura-frontend:pre-<change>
docker build -t divinetalk/scriptura-backend:latest  ./backend
docker build -t divinetalk/scriptura-frontend:latest ./frontend
docker push divinetalk/scriptura-backend:latest
docker push divinetalk/scriptura-frontend:latest

# server (~/shivam-scriptura has only docker-compose.yml + .env; compose file version 3.3, docker-compose 1.x, sudo required)
sudo docker-compose pull api web
sudo docker-compose up -d --force-recreate api web      # also recreates scriptura-mysql; data is safe in the named volume
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
sudo docker logs --tail 40 scriptura-api                # look for "migrated" lines + "listening on port 5000"
```
- To leave MySQL untouched, recreate only what changed: `sudo -n docker-compose pull api web && sudo -n docker-compose up -d --no-deps --force-recreate api web` (or just `api` / just `web`). Used for both 2026-09-15 deploys.
- The health route is `/health` on the API container (`localhost:5000/health`), not `/api/v1/health` — the public `https://dev-list.divinetalk.live/api/v1/health` returns 404 and that is expected.
- Verify the public frontend picked up the new bundle: `curl -s https://dev-list.divinetalk.live/scriptura/ | grep -o 'main\.[a-f0-9]*\.js'` must match `ls /usr/share/nginx/html/static/js/` inside the new image.
- The server's `curl` is old and has no `--retry-all-errors`; wait for the API with a `for` loop around `curl -s localhost:5000/health` instead.
- Migrations run automatically on container start (`backend/docker-entrypoint.sh`).
- A new env var must be added to the **server's** `docker-compose.yml` `api.environment` block, not only to the repo's compose files. Otherwise the container never sees it.

---

## 9. Local development & testing notes
- Schema changes go through migration files plus `npm run migrate`. Never use `sequelize.sync()` against the dev DB.
- **Don't run `npm test` blindly.** `backend/.env`'s `NODE_ENV=development` overrides the test env, so Jest can hit the real local MySQL.
- The backend has no ESLint config, so use `node --check <file>`. For the frontend, `npx eslint src/pages/...` works.
- How the update flow was smoke-tested (2026-09-14; reuse this pattern):
  - Stub `axios.post` in-process so nothing leaves the machine.
  - Create a **disabled** temporary integration (`endpoint_url`/`update_endpoint_url` on `https://example.com/...`, `response_id_path: 'data.id'`) plus one mapping.
  - Seed a `failed` log and call `retryDelivery` twice.
  - Expected: 1st call CREATE → `external_post_id '777'`; 2nd call UPDATE → body contains `id: "777"`.
  - Delete the temporary rows and compare row counts before and after.
- `assertSafeUrl` blocks private/localhost targets, so a local mock server can't stand in for the client endpoint. Stub axios instead.

---

## 10. Known gaps / open items
- [x] **Laravel `blog-info/update` is live** (2026-09-22, confirmed by the user).
- [ ] The §7 acceptance test has **not** been run against the live update endpoint. Do this on the first republish: check the log shows `update` / `delivered` and that no new post appeared on DivineTalk.
- [x] `data.id` confirmed on 2026-09-14: blog 116 was published → log 30 `create` / `delivered` / HTTP 201 / `external_post_id = 862`.
- [ ] Legacy blogs have no id (§6). Blog 110 has 4 copies on DivineTalk.
- [ ] Code is uncommitted (branch `feature/keyword-first-autopilot`).
- [ ] If the create response is lost (timeout after DivineTalk saved the post), no id is captured, and the next republish creates a duplicate. An upsert keyed on a Scriptura-sent id was discussed as the more robust alternative, but not chosen.
- [ ] `response_summary` stores only 2000 chars, so the `id` at the end of a long response isn't visible in logs.
- [ ] The runtime image lacks `sequelize-cli`, so `npx` downloads it at every container start. Suspected cause: `--omit=dev` in the uncommitted Dockerfile change. Migrations fail if the container has no internet.
- [ ] The server's `docker-compose.yml` doesn't forward `CONFIG_ENCRYPTION_KEY`. That's harmless while DivineTalk auth is `None`, but required before saving any credential.
- [ ] Production runs with `NODE_ENV=development`. The user considers this OK for now.
- [x] **Five blogs had a URL-shaped `blog_picture` (96, 99, 106, 107, 108).** Delivery failed for them with "Publishing API requires blog_picture, but no value was available". Fixed on production 2026-09-14 with the SQL below: 5 rows updated, 0 slash-prefixed paths remain. The files were first confirmed to exist under `/app/uploads/<path without the prefix>`. Keep the SQL for any future occurrence.
  ```sql
  UPDATE blogs SET blog_picture = SUBSTRING(blog_picture, LENGTH('/scriptura/uploads/') + 1)
  WHERE id IN (96,99,106,107,108) AND blog_picture LIKE '/scriptura/uploads/%';
  ```
- [ ] 52 blogs have no `blog_picture` at all (15 of them published). DivineTalk requires `blog_picture`, so publishing or republishing any of these fails delivery until a picture is added.
- [ ] **Featured images generated before 2026-09-15 are still cropped** (e.g. blog 115). The cut part is not in the stored file, so only "Regenerate image" + Republish fixes the live DivineTalk post (§13).
- [ ] Blogs whose stored `image_style` is `photo` keep generating photos on regenerate (now with the hopeful-mood rules). Change the blog's style to `illustration` first if an illustration is wanted. No bulk DB change was made.
- [ ] A logo in a right-hand corner (`top_right` / `bottom_right`) can sit over a blur-fill side strip. Not yet checked with the real logo.
- [ ] Blogs **43, 77, 86, 108, 109, 124** were repaired in the database on 2026-09-22 but **not republished**, so DivineTalk still serves their old links (§15). Update is live now, so republishing them no longer creates duplicates.
- [x] Neither slug from the original 2026-09-22 report appeared in **any** backfill scan, including after the bare-URL and legacy-row fixes (final run: 130 scanned — 109 with blocks, 0 legacy, 21 empty; 0 affected). The slug is not in Scriptura's database in any form. Most likely the SEO team corrected those links by hand on DivineTalk, and/or the DivineTalk post is a stale copy from before `update` went live. Not a Scriptura defect.
- [ ] **21 blogs have no content at all** (neither `content_blocks` nor `blog_content`). Unrelated to the link work; worth a look.
- [ ] Two residual dead-link sources, both out of scope so far: a **bare URL** matching no blog is repaired-or-left, never stripped (confirm whether DivineTalk auto-links plain URLs — if it does, it should be stripped), and **external links are not verified at all**.
- [ ] Six stripped targets were slugs for articles that do not exist as **published** blogs. Three of them read like real articles (`an-introduction-to-jyotisha-vedic-astrology`, `sun-transit-in-leo-2026-how-will-it-affect-your-sign`, `janmashtami-2026-4-or-5-september-full-date-muhurat-significance-explained`) — if they exist as drafts, publishing them and regenerating would restore the links.
- [ ] Internal-link fix of 2026-09-17 (§14) is deployed but uncommitted. Posts already on DivineTalk keep their relative links until republished. Already delivered DivineTalk posts keep relative links until republished.
- [ ] Image changes of 2026-09-15 are uncommitted (branch `feature/keyword-first-autopilot`).
- [ ] Test health: backend `npm test` has 8 failing GSC tests and 19 near-empty (~40 byte) suites; frontend `src/pages/__tests__/wizard.test.js` fails to run because Jest cannot parse the ESM `react-markdown` import. None caused by the 2026-09-15 image changes.

---

## 12. `blog_picture` must be a storage-relative path
`blogs.blog_picture` must always hold a **storage-relative path** such as `blogs/September2026/<40 chars>.png`. It must never hold a public URL.
- `blogService.publicUrlFor` delegates to `LocalDriver.toPublicUrl`.
- For an unsafe or URL-shaped value (e.g. `/scriptura/uploads/blogs/...`), `toPublicUrl` returns `''`.
- `payloadMapper`'s `images.featured_image` then resolves to nothing, and the required `blog_picture` counts as missing, so delivery fails. The editor's cover image also breaks.

Every writer must use `relativePath`. The media API returns both `relativePath` and `publicUrl`.
- `services/generation.js` → `generatedImages[0].relativePath` ✔
- `frontend/src/pages/EditorPage.js` → `handleRegenerateImage`: **was writing `publicUrl`; fixed 2026-09-14 to `relativePath`.**

---

## 13. Featured image generation (what DivineTalk receives as `blog_picture`)
DivineTalk shows `blog_picture` as-is on the live post, so whatever `services/imageGeneration.js` stores is exactly what readers see. All three generators go through `generateBlogImage`: article generation (`services/generation.js`), editor "Regenerate image" (`blogs.controller.js`), and `/media/generate-image`.

**Size — never cropped (2026-09-15).**
- Target size is the org setting `content.image_defaults` (Settings → Blog Image Defaults). Production: **1920×1080**, the same size DivineTalk's content team uses for hand-made images.
- gpt-image-1 only offers 1024×1024, 1536×1024 and 1024×1536 (no 16:9). `providerCanvasForTarget` requests the closest aspect — **1536×1024** for 1920×1080.
- `resizeToConfiguredDefault` fits the whole image inside the target and fills the leftover side strips (~150 px each at 1920×1080) with a mirrored, blurred copy of the image's own edges. No crop, no stretch, no darkening.
- Why not a crop: the old square request + `cover` crop removed ~44% of the height (blog 115: head and tilak cut). A real test showed gpt-image-1 ignores "leave margin above the head" prompts, so even a small centred or bottom-biased crop still cut hair, hands or objects.
- sharp gotcha: only the **last** `resize` in one pipeline applies. The blur-fill background is built in separate pipelines on purpose.

**Style and mood (2026-09-15).**
- Default style is `illustration` (`DEFAULT_IMAGE_STYLE` in backend and frontend constants) — wizard, Automated Blog page, validators, controller fallbacks and autopilot (`autopilot.image_style` setting, falls back to `illustration` for a missing/unknown value).
- `BASE_DIRECTIVES` (appended to every prompt, not admin-overridable) adds: serene, hopeful, calm mood; any person looks peaceful or gently smiling, never sad/worried/distressed; prefer symbols (planets, night sky, diyas, lotus, yantras, temple silhouettes) over portraits.
- Why: `photo` + "dignity / respected publication" wording produced solemn, sad-looking realistic faces, especially for topics like Sade Sati.

**Delivery size.** A stored 1920×1080 PNG is now ~3.5–4.7 MB. With `max_file_kb = 2048` the multipart delivery re-encodes it as JPEG; a local run of the same `compressToFit` steps on four such images gave 154–287 KB at quality 80 with the full 1920×1080 kept.

**Verifying a change here.** Regenerate the image on one blog and open the stored file: it must be exactly 1920×1080 with nothing cut at any edge. Then Republish and check the live DivineTalk post.

---

## 14. Internal blog links must be absolute on `divinetalk.in`
Generated articles link to other published blogs. Those links must be `https://divinetalk.in/blog/<slug>`, because only `divinetalk.in` serves blog pages.

**RCA (2026-09-17).**
- `ai/prompts.js` told the model to use the `/blog/<slug>` path, and `verifyAndStripInvalidLinks` kept that relative href as-is.
- A root-relative href takes the host of the page that shows it. In Scriptura it became `https://dev-list.divinetalk.live/blog/...`, and in the DivineTalk admin it became `admin.divinetalk.live/blog/...`. Neither host serves blogs, so the link was dead.

**Fix (one rule, applied at every layer).** `backend/src/services/publicLinks.js` → `toPublicBlogHref`: a `/blog/...` href, or a `/blog/...` href on any `*.divinetalk.live` host, becomes `https://divinetalk.in/blog/...`. All other hrefs are left unchanged. The base URL comes from `SITE_IDENTITY.production_urls[0]`.
| Where | Effect |
|---|---|
| `ai/prompts.js` (`articlePrompt`) | The model is given full `https://divinetalk.in/blog/<slug>` URLs. |
| `generation.js` → `verifyAndStripInvalidLinks` | Valid internal links in the new `content_blocks` are rewritten to absolute URLs, in case the model still writes a relative one. |
| `sanitize.js` → `a` transform | `blog_content` is rendered with absolute links on every save. |
| `delivery/payloadMapper.js` → `blog.content` | Delivery rewrites again, so blogs saved **before** the fix also send absolute links without being re-saved. |
| `frontend/src/lib/sanitizeInline.js` | The editor preview shows the same absolute link for old blocks. This mirrors the backend rule, so keep both in sync. |

Notes:
- Absolute links get `target="_blank" rel="noopener noreferrer"` from the existing sanitizer rule, the same as the CTA button. That was left unchanged on purpose, because the block fixtures pin it.
- Posts already on DivineTalk keep their old relative links until they are republished. Republish goes through UPDATE only when an id was captured and `blog-info/update` is live (§2, §6). Otherwise it creates a duplicate.
- Verified locally: the rewrite cases, `blocksToHtml` output for all 8 block fixtures is unchanged, and the frontend parity + constants tests pass (72 tests).
- Images pushed 2026-09-17: backend `sha256:c6127961…`, frontend `sha256:43cd6241…` (bundle `main.3280635d.js`). Local rollback tags `pre-public-blog-links`. No new env var, so the server compose file needs no change.

---

## 15. Internal link slugs must be the real slug, not one rebuilt from the title

§14 made internal links absolute. They still 404 when the **slug itself** is wrong.

**RCA (2026-09-22).** The prompt hands the model the exact URL of every target, but the model
frequently rebuilds the slug from the target's *title* instead of copying the URL — and writes the
title the way a person says it out loud, with a joining word where the title had a comma. Two live
examples on divinetalk.in, both an inserted `and`:

| Written by the model | The real slug |
|---|---|
| `…-shradh-muhurat-and-puja-vidhi` | `…-shradh-muhurat-puja-vidhi` |
| `…-tithi-calendar-and-shradh-timings` | `…-tithi-calendar-shradh-timings` |

`slugifyTitle` never adds `and` — it only drops the comma — so the destination existed the whole
time under a slightly different address.

The safety net that should have caught this, `generation.js` → `verifyAndStripInvalidLinks`, failed
twice over:
- it scanned only `block.data.html`, so links in `list.items`, `key_takeaway.items`,
  `faq_accordion` answers, table cells and `cta_button.url` were never checked at all;
- it could only **strip** an unresolved link, never repair it, so a link to a real article was
  thrown away as plain text instead of being pointed at the right slug.

**Fix.** `backend/src/services/internalLinks.js` → `repairInternalLinks(blocks)`, called from
`generation.js` right after the model returns. For every `/blog/<slug>` href anywhere in the blocks:

| Case | Result |
|---|---|
| slug is a published blog | kept, made absolute (§14) |
| slug matches exactly one published blog once joining words (`and`, `the`, `of`, …) are ignored | href rewritten to the real slug |
| slug has a decisive token overlap (≥0.8 Jaccard, ≥0.1 clear of the runner-up) with one published blog | href rewritten to the real slug |
| anything else | `<a>` stripped, its text kept |

- Traversal is a recursive walk over every string in `block.data`, **not** a per-block-type field
  list — that list is exactly what went stale before. A new block type is covered automatically.
- A bare href field (`url`/`href`/`src`, i.e. `cta_button`, `embed`) is repaired if possible and
  otherwise left as written: blanking it would make `blocksToHtml` drop the whole block.
- Ambiguity is never guessed at. Two published blogs sharing a key → strip.
- The prompt (`ai/prompts.js`) now also says to copy each URL character for character, names the
  inserted-`and` failure, and forbids `/blog/` links to anything not in `internal_link_targets`.

**Already-generated blogs** keep their broken links until repaired and republished:
```bash
node scripts/repair-internal-links.js                 # dry run, all blogs
node scripts/repair-internal-links.js --ids 110,116   # dry run, specific blogs
node scripts/repair-internal-links.js --apply         # write
```
Saving re-renders `blog_content` through the model's `beforeSave` hook. The client's live post only
changes on the next **Republish**, which goes through UPDATE only when an id was captured and
`blog-info/update` is live (§2, §6).

**Tests.** `backend/tests/unit/internalLinks.test.js` — 14 cases, including both production
failures above and one per previously unscanned field.

### Not every link is an `<a>` tag (2026-09-22)

The first version of the repair matched only `<a href="…">`. The model does not always write one. It
also writes the URL bare in a sentence, and in markdown inside a plain-text field:

```
<a href="https://divinetalk.in/blog/…-and-puja-vidhi">vidhi</a>   caught
Read more: https://divinetalk.in/blog/…-and-puja-vidhi            MISSED
See /blog/…-and-puja-vidhi                                        MISSED
[Sarva Pitru](https://divinetalk.in/blog/…-and-puja-vidhi)        MISSED
```

**This is why the production backfill reported zero occurrences of a slug that was demonstrably
404ing on the live site** (see "What the backfill found" below) — it was looking only for link tags.

`BARE_BLOG_URL_RE` now covers the other three forms, in collection and in repair. Notes:

- An unplaceable bare URL is **never removed**, under either policy. It is prose the reader sees, and
  cutting it would take half a sentence with it. Only the slug is ever rewritten.
- The pattern matches our own hosts (`divinetalk.in`, `*.divinetalk.live`) and root-relative paths
  only. Another site's `/blog/` URL is not ours to "correct", and a lookbehind stops the relative
  branch from matching the tail of `example.com/blog/…`.
- A lookbehind also keeps this pass off attribute values, so an href fixed by the `<a>` pass is never
  rewritten twice.

**The backfill must be re-run** — the cases it could not see before are now visible to it.

### Every write path, not just generation (2026-09-22)

Generation was covered, but `content_blocks` can arrive after generation through
`blogService.updateBlog` — which is where **both** the editor's autosave (`PATCH /blogs/:id`) and the
Blog Ops agent's `blog.update_block` land. An agent rewriting a paragraph invents a slug exactly the
way the article model does, so that path could reintroduce the bug.

`updateBlog` now verifies links itself, with a policy argument, because the two callers want
different things from an unplaceable link:

| Caller | `linkPolicy` | Unplaceable link |
|---|---|---|
| Editor autosave (`PATCH /blogs/:id`) | `'repair'` (default) | **left as written** |
| Blog Ops agent (`actionExecutors.js` → `executeUpdateBlock`) | `'strict'` | stripped, text kept |
| Generation (`generation.js`) | — always strict | stripped, text kept |

Near-miss repair happens under both policies; only stripping differs. Autosave fires mid-keystroke,
so a half-typed link must not vanish under the writer's cursor — and a link to an article they are
about to publish is not an error. Machine-written content gets no such benefit of the doubt.

- Best-effort: a failure verifying links never blocks a save.
- Costs nothing on a normal save — with no `/blog/` href in the blocks, zero queries run.
- The repair mutates the blocks in place, so the value an agent executor reports as the applied
  change is the repaired one, not what the agent proposed.

### What the backfill found (production, 2026-09-22)

128 blogs scanned, **6 affected: 2 links repaired, 6 stripped.**

| Blog | Result |
|---|---|
| 108, 109 | repaired → `ganesh-chaturthi-2026-date-and-shubh-muhurat-sthapana-puja-timings-and-visarjan-guide` |
| 43, 77, 86, 124 | 6 links stripped: the target slug matches no published blog |

Two things worth noting:

1. **The repair ran in the opposite direction** to the reported cases: the model *dropped* an `and`
   the real slug has (`…puja-timings-visarjan-guide` → `…puja-timings-and-visarjan-guide`). The
   joining-word rule is symmetric, so both directions resolve to the same key.
2. **Neither originally reported slug turned up**, in any of the 128 blogs. So the two dead links on
   divinetalk.in are not reproduced by anything currently in Scriptura's `content_blocks`. Unexplained;
   the likeliest reasons are that the linking article was re-saved since delivery, or that the
   DivineTalk post is a copy whose Scriptura source has moved on. Worth confirming before assuming
   those two are fixed.

Three of the stripped targets read like real articles rather than inventions. If they exist as drafts,
they were stripped correctly (linking to a draft is a 404) but publishing them would be the better fix.

The database is repaired; **the client's live posts are not** until each blog is republished, which
per §2 and §10 currently creates a duplicate rather than updating.

## 16. FAQ blocks render open, not as an accordion

`faq_accordion` blocks were rendered as `<details>`/`<summary>`. On the live post every answer sat
collapsed behind a disclosure triangle, so the section looked empty and read as a widget bolted onto
the article rather than part of it.

They now render as plain question-then-answer prose. Same classes, same nesting, two tags changed:

```html
<section class="scriptura-faq">
  <div class="scriptura-faq-item">                     <!-- was <details> -->
    <h3 class="scriptura-faq-question">Kab hai?</h3>   <!-- was <summary> -->
    <div class="scriptura-faq-answer">17 September ko.</div>
  </div>
</section>
```

| File | Change |
|---|---|
| `backend/src/services/blocksToHtml.js` → `faq_accordion` | `details`→`div`, `summary`→`h3` |
| `frontend/src/components/BlockRenderer.js` → `FaqBlock` | the same, mirrored (the parity rule in that file's header) |
| `shared/block-fixtures.json` | regenerated: `node scripts/generate-block-fixtures.js` |
| `frontend/src/index.css` | open styles added; the `details`/`summary` rules **kept** — see below |
| `frontend/src/components/editor/settings/FaqSettings.js` | panel note no longer says "accordion" |

- The block type is still named `faq_accordion`. Renaming it would break every stored block, the
  constants, the validators and the prompt; only the markup changed.
- The old `details`/`summary` CSS is deliberately left in place: blogs saved before this deploy still
  hold the old markup in `blog_content` until they are re-saved, and dropping the rules would leave
  those unstyled in the editor preview. Remove them once no blog renders `<details>` any more.
- An `<h3>` question is also a real heading for crawlers, where a `<summary>` had to be expanded
  first. It does not reach `blogs.outline` — `outlineFromBlocks` reads only `heading` blocks.
- The canvas editor was already plain question/answer fields, so it needed no change.
- Verified: frontend parity suite 13 tests, 61 frontend tests total.

## 11. Change log
| Date | Change |
|---|---|
| 2026-08-17 | Client Publish-API integration built: Config page, field mappings, delivery logs, retry, test connection. |
| 2026-08-24 | `request_format` (multipart) and `max_file_kb` added for DivineTalk's Laravel `image` rule. |
| 2026-09-14 | Republish duplicate bug diagnosed (blog 110 ×4). Update flow added: `update_endpoint_url`, `update_id_field`, `delivery_mode`, `resolveDeliveryTarget`. Deployed to production. Config set: Post ID path `data.id`, update URL `blog-info/update`. |
| 2026-09-14 | Editor "Regenerate image" saved `publicUrl` into `blog_picture`, which broke delivery (blog 106, log 29). Fixed to `relativePath`. The 5 affected production rows were fixed with SQL (§10). The frontend image was redeployed (web only, `--no-deps`). |
| 2026-09-15 | Featured images were cropped (heads/tilak cut on the live DivineTalk post, blog 115). Root cause: square 1024×1024 request + `cover` crop to the configured 1920×1080 (~44% of height lost). Fixed: provider canvas closest to the target aspect (1536×1024) + blur fill, never a crop (§13). Backend deployed (api only, `--no-deps`), digest `sha256:da174566…`, rollback tag `pre-image-blurfill`. |
| 2026-09-15 | Generated images looked realistic and sad. Default style changed `photo` → `illustration` everywhere (`DEFAULT_IMAGE_STYLE`); autopilot now reads `autopilot.image_style` instead of a hardcoded value; locked base prompt now demands a serene/hopeful mood and symbols over portraits; blur-fill strips mirror-extended, not darkened (§13). Backend + frontend deployed (api + web, `--no-deps`), digests backend `sha256:a6201d51…` / frontend `sha256:39cbeca3…`, rollback tags `pre-image-style`. |
| 2026-09-17 | Internal blog links opened on `dev-list.divinetalk.live` (dead) because the model wrote relative `/blog/<slug>` hrefs. They are now always absolute `https://divinetalk.in/blog/<slug>`: prompt, generation, `blog_content` render, delivery payload and editor preview (§14). Deployed (api + web, `--no-deps`; health 200, public bundle `main.3280635d.js`), digests backend `sha256:c6127961…` / frontend `sha256:43cd6241…`, rollback tags `pre-public-blog-links`. |
| 2026-09-22 | Internal links still 404'd because the model rebuilt the slug from the target's title, inserting `and` where the title had a comma. Slugs are now repaired against the real ones, and links in lists, FAQs, tables and CTA urls are checked at all — the old check only ever read `data.html` and could only strip (§15). Backfill script added, **not yet run**. |
| 2026-09-22 | FAQ blocks rendered as a collapsed `<details>` accordion, which looked wrong on the live post. Now open `<h3>` question + answer, mirrored in the frontend renderer and the shared fixtures (§16). |
| 2026-09-22 | Both of the above deployed (api + web, `--no-deps`; health 200/200, public bundle `main.5fdcd7ba.js`, FAQ chunk `158.d7ccb636.chunk.js`), digests backend `sha256:a7552326…` / frontend `sha256:c83c15ea…`, rollback tags `pre-faq-open`. |
| 2026-09-22 | Internal-link backfill run on production (`--apply`): 128 blogs scanned, 6 affected — 2 links repaired, 6 stripped. Blogs 43, 77, 86, 108, 109, 124 await republish. Neither originally reported slug appeared (§15). |
| 2026-09-22 | Link verification extended from generation to `blogService.updateBlog`, closing the agent-edit and manual-save paths. `linkPolicy`: `'strict'` for agent edits (repair + strip), `'repair'` for editor autosave (repair only, never strips mid-keystroke) (§15). Backend deployed (api only, `--no-deps`; health 200), digest `sha256:c1588bdb…`, rollback tag `pre-link-policy`. |
| 2026-09-22 | Links written as bare URLs or markdown — not `<a>` tags — were slipping through the repair entirely, which is why the reported 404 survived and the backfill found nothing. `BARE_BLOG_URL_RE` added; bare urls are repaired but never stripped (§15). Backend deployed (api only), digest `sha256:9ad64434…`, rollback tag `pre-bare-urls`. **Backfill needs re-running.** |
| 2026-09-22 | Backfill script was silently skipping blogs with no `content_blocks` while still counting them as scanned. Those rows are now repaired on `blog_content` directly (`repairInternalLinksInHtml`), and every run reports the with-blocks / legacy / empty breakdown. Deployed, digest `sha256:c34ac269…`, rollback tag `pre-legacy-scan`. Production has 0 legacy rows, so this changed nothing there — but the count is no longer a lie. |
| 2026-09-22 | Laravel `blog-info/update` confirmed live. §4, §5 and §10 updated. |
