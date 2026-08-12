# Scriptura — Complete Project Context

> **Purpose of this file:** This is an exhaustive AI-consumable context document for the Scriptura project. Give this file to any AI tool and it will have deep understanding of every module, logic flow, data model, API, third-party integration, and architectural decision in the codebase. This file is the single source of truth for onboarding AI assistants.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack & Dependencies](#2-tech-stack--dependencies)
3. [Repository Structure](#3-repository-structure)
4. [Backend Architecture](#4-backend-architecture)
   - 4.1 [Entry Point & App Setup](#41-entry-point--app-setup)
   - 4.2 [Configuration System](#42-configuration-system)
   - 4.3 [Database & Models](#43-database--models)
   - 4.4 [Routes & Controllers](#44-routes--controllers)
   - 4.5 [Middleware Stack](#45-middleware-stack)
   - 4.6 [Validators (Zod Schemas)](#46-validators-zod-schemas)
   - 4.7 [Services Layer](#47-services-layer)
   - 4.8 [AI Provider Abstraction](#48-ai-provider-abstraction)
   - 4.9 [Storage Abstraction](#49-storage-abstraction)
   - 4.10 [Content Pipeline (Blocks → HTML)](#410-content-pipeline-blocks--html)
   - 4.11 [SEO Scoring Engine](#411-seo-scoring-engine)
   - 4.12 [Generation Pipeline (State Machine)](#412-generation-pipeline-state-machine)
   - 4.13 [Sanitization & Security](#413-sanitization--security)
   - 4.14 [Constants (Single Source of Truth)](#414-constants-single-source-of-truth)
   - 4.15 [OpenAPI / Swagger Docs](#415-openapi--swagger-docs)
5. [Frontend Architecture](#5-frontend-architecture)
   - 5.1 [App Shell & Routing](#51-app-shell--routing)
   - 5.2 [Authentication Context](#52-authentication-context)
   - 5.3 [API Client Layer](#53-api-client-layer)
   - 5.4 [Pages](#54-pages)
   - 5.5 [6-Step Generation Wizard](#55-6-step-generation-wizard)
   - 5.6 [Visual Block Editor](#56-visual-block-editor)
   - 5.7 [BlockRenderer (Shared Component)](#57-blockrenderer-shared-component)
   - 5.8 [Dashboard & Charts](#58-dashboard--charts)
   - 5.9 [UI Primitives](#59-ui-primitives)
   - 5.10 [Custom Hooks](#510-custom-hooks)
   - 5.11 [Utility Libraries](#511-utility-libraries)
   - 5.12 [Styling System (Tailwind CSS)](#512-styling-system-tailwind-css)
6. [Data Model Deep Dive](#6-data-model-deep-dive)
7. [API Reference Summary](#7-api-reference-summary)
8. [Authentication & Authorization Flow](#8-authentication--authorization-flow)
9. [The Content Invariant](#9-the-content-invariant)
10. [Third-Party APIs & External Services](#10-third-party-apis--external-services)
11. [Environment Variables (Complete List)](#11-environment-variables-complete-list)
12. [Docker & Deployment](#12-docker--deployment)
13. [Testing Strategy](#13-testing-strategy)
14. [Production Adoption (Existing Table Migration)](#14-production-adoption-existing-table-migration)
15. [Known Limitations & Upgrade Paths](#15-known-limitations--upgrade-paths)
16. [Key Design Decisions & Trade-offs](#16-key-design-decisions--trade-offs)

---

## 1. Project Overview

**Scriptura** is Divinetalk's internal AI blog automation tool. It generates, edits, manages, and publishes SEO-optimised articles at scale — without WordPress or Elementor.

### What It Does
- **6-step generation wizard** — topic/title with live SEO scoring; brand-voice analysis from pasted text, scraped URL, or uploaded document; content configuration with SEO-structure toggles, internal linking, and outline building; AI image generation with visual logo-position picker; publish settings; then async generation with live status polling.
- **Visual block editor** — 10 block types, drag-and-drop reorder, inline editing, per-block settings, undo/redo, debounced autosave.
- **Dashboard** — publishing cadence, SEO-score distribution, word-count trends, status breakdown, top keywords, and (when SerpAPI is configured) ranking trends.
- **Never auto-publishes.** Generation always lands in the editor for human review.

### Scope
- Built for **one organisation** (Divinetalk's own team).
- **No tenancy model** — no `organizations` table, no `organization_id` column, no tenant-scoping middleware.
- Authorisation answers exactly two questions: *is this a signed-in Divinetalk team member*, and *are they an admin or an editor*.

### Architecture Pattern
- **Monorepo** with `backend/`, `frontend/`, `shared/`, `e2e/`, `scripts/`.
- **Backend:** Node.js + Express 5 + Sequelize ORM + MySQL 8 (SQLite for tests).
- **Frontend:** React 18 + Create React App + Tailwind CSS 3 + Recharts.
- **API:** RESTful, versioned under `/api/v1`, OpenAPI-documented.

---

## 2. Tech Stack & Dependencies

### Backend Dependencies (`backend/package.json`)

| Package | Version | Purpose |
|---|---|---|
| `express` | `^4.21.2` | Web framework |
| `sequelize` | `^6.37.7` | ORM for MySQL/SQLite |
| `mysql2` | `^3.14.1` | MySQL driver |
| `sqlite3` | `^6.0.1` | In-memory test database (devDep, excluded from prod builds) |
| `@anthropic-ai/sdk` | `^0.52.0` | Anthropic Claude API for text generation |
| `openai` | `^4.77.0` | OpenAI API for image generation |
| `zod` | `^3.25.36` | Request validation schemas |
| `jsonwebtoken` | `^9.0.2` | JWT token creation/verification |
| `bcryptjs` | `^2.4.3` | Password hashing |
| `sanitize-html` | `^2.14.0` | Server-side HTML sanitization |
| `sharp` | `^0.33.5` | Image processing (resize, EXIF strip, logo composite) |
| `multer` | `^1.4.5-lts.2` | Multipart file upload handling |
| `mammoth` | `^1.9.0` | DOCX text extraction (for brand voice analysis) |
| `axios` | `^1.7.9` | HTTP client (used for SERP, URL scraping, image downloads) |
| `cheerio` | `^1.0.0` | HTML parsing for brand voice URL extraction |
| `compression` | `^1.7.5` | Response compression |
| `slugify` | `^1.6.6` | URL slug generation |
| `cors` | `^2.8.5` | CORS middleware |
| `helmet` | `^8.0.0` | Security headers |
| `morgan` | `^1.10.0` | HTTP request logging |
| `express-rate-limit` | `^7.5.0` | Rate limiting |
| `dotenv` | `^16.5.0` | Environment variable loading |
| `swagger-jsdoc` | `^6.2.8` | OpenAPI spec generation from JSDoc |
| `swagger-ui-express` | `^5.0.1` | Swagger UI serving |
| `cross-env` | `^7.0.3` | Cross-platform env vars (devDep) |
| `jest` | `^29.7.0` | Testing framework (devDep) |
| `supertest` | `^7.0.0` | HTTP assertion testing (devDep) |
| `nodemon` | `^3.1.10` | Dev server hot reload (devDep) |
| `sequelize-cli` | `^6.6.2` | Migration/seed CLI (devDep) |
| `eslint` | `^9.29.0` | Linting (devDep) |

**Important Overrides:**
- `htmlparser2` is pinned to `^9.1.0` (last CommonJS version) because v12+ is pure ESM and breaks Jest's CommonJS runtime.
- `undici` is pinned to `^6.28.0`.

**Architectural note:** `sqlite3` is strictly a `devDependency` to prevent container build crashes (`Exit handler never called!`) caused by binary network fetches during production `npm ci --omit=dev`.

### Frontend Dependencies (`frontend/package.json`)

| Package | Version | Purpose |
|---|---|---|
| `react` | `^18.3.1` | UI framework |
| `react-dom` | `^18.3.1` | DOM rendering |
| `react-router-dom` | `^6.30.0` | Client-side routing |
| `react-scripts` | `5.0.1` | Create React App toolchain |
| `axios` | `^1.7.9` | HTTP client |
| `recharts` | `^2.15.0` | Chart library (bar, line, pie, donut, scatter) |
| `@dnd-kit/core` | `^6.3.1` | Drag-and-drop core (block editor) |
| `@dnd-kit/sortable` | `^8.0.0` | Sortable list functionality |
| `@dnd-kit/modifiers` | `^7.0.0` | Drag modifiers (restrict to vertical axis) |
| `@dnd-kit/utilities` | `^3.2.2` | DnD utilities |
| `clsx` | `^2.1.1` | Conditional className utility |
| `framer-motion` | `^11.15.0` | Animation library |
| `tailwindcss` | `^3.4.17` | Utility-first CSS framework (devDep) |
| `postcss` | `^8.4.49` | CSS post-processing (devDep) |
| `autoprefixer` | `^10.4.20` | CSS vendor prefixing (devDep) |
| `cross-env` | `^7.0.3` | Cross-platform env vars (devDep) |
| `@testing-library/dom` | `^10.4.0` | Pinned to avoid dual-instance hoisting bugs (devDep) |
| `@testing-library/react` | `^16.1.0` | React testing utilities (devDep) |
| `@testing-library/jest-dom` | `^6.6.3` | Custom Jest matchers (devDep) |
| `@testing-library/user-event` | `^14.5.2` | User interaction simulation (devDep) |

### Runtime Requirements
- **Node.js** ≥ 18 (built and tested on Node 24)
- **MySQL 8** for production runtime
- **No database needed for tests** — runs on in-memory SQLite

---

## 3. Repository Structure

```
scriptura/
├── backend/
│   ├── src/
│   │   ├── app.js                    # Express app setup
│   │   ├── server.js                 # Entry point — starts server, runs migrations
│   │   ├── config/
│   │   │   ├── index.js              # THE ONLY reader of process.env (enforced by test)
│   │   │   └── database.js           # Sequelize CLI config
│   │   ├── constants/
│   │   │   └── index.js              # All enums: BLOG_STATUS, GENERATION_STATUS, ROLES, etc.
│   │   ├── models/
│   │   │   ├── index.js              # Sequelize init (MySQL or SQLite based on NODE_ENV)
│   │   │   ├── blog.js               # Blog model — 56 columns, beforeSave hook
│   │   │   ├── user.js               # User model — auth, password hashing, token versioning
│   │   │   ├── automatedTopic.js     # Autopilot topics
│   │   │   └── scripturaKeyword.js   # SEO keyword pool
│   │   ├── migrations/
│   │   │   ├── 20260727120000-create-users-table.js
│   │   │   ├── 20260727120100-create-blogs-table.js
│   │   │   ├── 20260730120000-rename-users-to-scriptura.js
│   │   │   ├── 20260730171400-create-automated-topics.js
│   │   │   ├── 20260731100521-create-scriptura-keywords.js
│   │   │   └── 20260731100524-add-keyword-pool-id-to-blogs.js
│   │   ├── middleware/
│   │   │   ├── auth.js               # JWT verification, user loading, role checking
│   │   │   ├── validate.js           # Generic Zod validation middleware
│   │   │   ├── rateLimit.js          # In-memory rate limiters (api, auth, generation)
│   │   │   ├── errorHandler.js       # Unified error envelope
│   │   │   └── upload.js             # Multer config for file uploads
│   │   ├── routes/
│   │   │   └── v1/
│   │   │       ├── index.js          # Mounts all route groups; also contains inline GET /meta handler
│   │   │       ├── auth.routes.js
│   │   │       ├── blogs.routes.js
│   │   │       ├── generate.routes.js
│   │   │       ├── brandVoice.routes.js
│   │   │       ├── media.routes.js
│   │   │       ├── serp.routes.js
│   │   │       ├── analytics.routes.js
│   │   │       ├── settings.routes.js
│   │   │       └── keywords.routes.js
│   │   ├── controllers/
│   │   │   ├── auth.controller.js
│   │   │   ├── blogs.controller.js
│   │   │   ├── generation.controller.js
│   │   │   ├── brandVoice.controller.js
│   │   │   ├── media.controller.js
│   │   │   ├── analytics.controller.js
│   │   │   ├── serp.controller.js
│   │   │   ├── settings.controller.js
│   │   │   └── keywords.controller.js
│   │   ├── services/
│   │   │   ├── blogService.js        # Core blog CRUD, analytics, slug generation
│   │   │   ├── analyticsService.js   # Dashboard analytics
│   │   │   ├── slug.js               # Slug generator
│   │   │   ├── tokens.js             # JWT management
│   │   │   ├── brandVoice.js         # Voice analysis
│   │   │   ├── blocksToHtml.js       # Canonical renderer: content_blocks → HTML
│   │   │   ├── generation.js         # Async generation state machine
│   │   │   ├── imageGeneration.js    # AI image pipeline
│   │   │   ├── logoComposite.js      # Logo watermarking
│   │   │   ├── sanitize.js           # XSS prevention — narrow allow-list
│   │   │   ├── seoScore.js           # Transparent SEO scoring heuristic (0-100)
│   │   │   ├── ai/
│   │   │   │   ├── index.js          # Factory: getTextProvider(), getImageProvider()
│   │   │   │   ├── AnthropicProvider.js  # Claude API integration
│   │   │   │   ├── OpenAIProvider.js     # DALL-E / gpt-image-1 image generation
│   │   │   │   ├── MockProvider.js       # Deterministic mocks for dev without API keys
│   │   │   │   └── prompts.js            # Prompt repository
│   │   │   └── storage/
│   │   │       ├── index.js              # Facade: save/read/delete/toPublicUrl
│   │   │       ├── LocalDriver.js        # Local filesystem (backend/uploads/)
│   │   │       └── S3Driver.js           # Deliberate stub — toPublicUrl works, I/O throws 501
│   │   ├── validators/
│   │   │   ├── blog.validators.js    # Create/update/list/publish Zod schemas
│   │   │   ├── auth.validators.js
│   │   │   ├── generation.validators.js
│   │   │   ├── brandVoice.validators.js
│   │   │   ├── media.validators.js
│   │   │   ├── serp.validators.js
│   │   │   └── analytics.validators.js
│   │   └── docs/
│   │       ├── swagger.js            # OpenAPI assembly
│   │       ├── paths/                # Per-route OpenAPI fragments
│   │       └── schemas/              # Reusable OpenAPI schemas
│   ├── scripts/
│   │   ├── generate-block-fixtures.js    # Generates shared/block-fixtures.json
│   │   └── prod-adoption/
│   │       ├── 001-add-ai-columns.sql    # Idempotent: adds 41 columns to existing table
│   │       ├── 002-rollback-ai-columns.sql   # Drops only what 001 added
│   │       └── backfill-slugs.js         # --dry-run / --commit slug backfill
│   ├── tests/
│   │   ├── setup.js                  # Sets NODE_ENV=test → triggers SQLite
│   │   ├── helpers/
│   │   │   ├── db.js                 # Placeholder stub (1 line)
│   │   │   └── factories.js          # Placeholder stub (1 line)
│   │   ├── unit/
│   │   │   ├── migration-parity.test.js      # Placeholder stub (1 line)
│   │   │   ├── blocksToHtml.test.js          # Placeholder stub (1 line)
│   │   │   ├── seoScore.test.js              # Placeholder stub (1 line)
│   │   │   ├── config.test.js                # Placeholder stub (1 line)
│   │   │   ├── aiProviders.test.js           # Placeholder stub (1 line)
│   │   │   ├── authMiddleware.test.js        # Placeholder stub (1 line)
│   │   │   ├── brandVoice-parser.test.js     # Placeholder stub (1 line)
│   │   │   ├── generationConfig.test.js      # Placeholder stub (1 line)
│   │   │   ├── logoComposite.test.js         # Placeholder stub (1 line)
│   │   │   ├── serp.test.js                  # Placeholder stub (1 line)
│   │   │   └── storage.test.js               # Placeholder stub (1 line)
│   │   └── integration/
│   │       ├── auth.test.js                  # Placeholder stub (1 line)
│   │       ├── blogs.test.js                 # Placeholder stub (1 line)
│   │       ├── generation.test.js            # Placeholder stub (1 line)
│   │       ├── analytics.test.js             # Placeholder stub (1 line)
│   │       ├── brandVoice.test.js            # Placeholder stub (1 line)
│   │       ├── media.test.js                 # Placeholder stub (1 line)
│   │       └── serp.test.js                  # Placeholder stub (1 line)
│   ├── uploads/                      # Local file storage (gitignored)
│   ├── certs/                        # TLS certs (if needed)
│   ├── .env                          # Active environment (gitignored)
│   ├── .env.example                  # Documented env template
│   ├── Dockerfile
│   ├── docker-entrypoint.sh
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── App.js                    # Routes, layout shell
│   │   ├── App.css
│   │   ├── index.js                  # ReactDOM render with AuthProvider
│   │   ├── index.css                 # Global + Tailwind directives
│   │   ├── components/
│   │   │   ├── BlockRenderer.js      # Used by BOTH editor preview AND blog view page
│   │   │   ├── ProtectedRoute.js     # Auth guard
│   │   │   ├── wizard/
│   │   │   │   ├── GenerationWizard.js
│   │   │   │   ├── StepIndicator.js
│   │   │   │   └── steps/
│   │   │   │       ├── Step1TopicTitle.js
│   │   │   │       ├── Step2BrandVoice.js
│   │   │   │       ├── Step3ContentConfig.js
│   │   │   │       ├── Step4ImageConfig.js
│   │   │   │       ├── Step5PublishSettings.js
│   │   │   │       └── Step6Generate.js
│   │   │   ├── editor/
│   │   │   │   ├── BlockEditor.js
│   │   │   │   ├── BlockToolbar.js
│   │   │   │   ├── EditorSidebar.js
│   │   │   │   └── blocks/
│   │   │   │       ├── HeadingBlock.js
│   │   │   │       ├── ParagraphBlock.js
│   │   │   │       ├── ImageBlock.js
│   │   │   │       ├── ListBlock.js
│   │   │   │       ├── QuoteBlock.js
│   │   │   │       ├── CodeBlock.js
│   │   │   │       ├── TableBlock.js
│   │   │   │       ├── DividerBlock.js
│   │   │   │       ├── FaqBlock.js
│   │   │   │       └── CalloutBlock.js
│   │   │   ├── charts/
│   │   │   │   ├── CadenceChart.js
│   │   │   │   ├── SeoDistributionChart.js
│   │   │   │   ├── StatusBreakdownChart.js
│   │   │   │   ├── WordCountTrendChart.js
│   │   │   │   └── KeywordCloud.js
│   │   │   ├── blogs/
│   │   │   │   ├── BlogCard.js
│   │   │   │   └── BlogListFilters.js
│   │   │   ├── layout/
│   │   │   │   ├── Header.js
│   │   │   │   └── Sidebar.js
│   │   │   └── ui/
│   │   │       ├── Badge.js
│   │   │       ├── Button.js
│   │   │       ├── Card.js
│   │   │       ├── Dialog.js
│   │   │       ├── Input.js
│   │   │       ├── Select.js
│   │   │       ├── Spinner.js
│   │   │       ├── Textarea.js
│   │   │       └── Toast.js
│   │   ├── context/
│   │   │   └── AuthContext.js        # Auth state, login/logout/refresh, localStorage
│   │   ├── hooks/
│   │   │   ├── useAutosave.js        # Debounced save after 2s inactivity
│   │   │   ├── useBlockHistory.js    # Undo/redo stack
│   │   │   ├── useWizardDraft.js     # Wizard auto-saving
│   │   │   ├── useDebounce.js        # Generic debounce hook
│   │   │   └── useInterval.js        # setInterval wrapper for polling
│   │   ├── lib/
│   │   │   ├── api.js                # Axios instance + typed API functions + token refresh
│   │   │   ├── constants.js          # Frontend mirror of backend constants
│   │   │   ├── sanitizeInline.js     # DOMPurify-based client-side sanitizer
│   │   │   └── media.js              # resolveMediaUrl() for image paths
│   │   └── pages/
│   │       ├── DashboardPage.js
│   │       ├── BlogListPage.js
│   │       ├── WizardPage.js         # 6-step generation wizard (new or resume)
│   │       ├── EditorPage.js         # Block editor
│   │       ├── BlogViewPage.js
│   │       ├── AutomatedBlogPage.js
│   │       ├── KeywordsPage.js
│   │       ├── SettingsPage.js
│   │       ├── LoginPage.js
│   │       └── __tests__/            # Page component tests
│   ├── public/
│   ├── build/                        # Production build output
│   ├── nginx.conf                    # Production nginx config
│   ├── Dockerfile
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── package.json
│
├── shared/
│   └── block-fixtures.json           # Generated cross-renderer test contract (15KB)
│
├── e2e/
│   ├── tests/                        # Playwright end-to-end tests
│   ├── playwright.config.js
│   └── package.json
│
├── scripts/
│   ├── scaffold.sh / scaffold.cmd    # Project scaffolding
│   ├── generate-scaffold.js
│   └── STRUCTURE.txt
│
├── scaffold.js                       # Full project scaffolding script (15KB)
├── docker-compose.yml                # Development: MySQL + backend + frontend
├── docker-compose.prod.yml           # Production config
├── server_docker-compose.yml         # Server-specific compose
├── README.md
├── ARCHITECTURE.md
├── API.md
├── TESTING.md
└── scriptura_context.md              # ← THIS FILE
```

---

## 4. Backend Architecture

### 4.1 Entry Point & App Setup

**`backend/src/server.js`** — The entry point:
1. Imports the Express app from `app.js`
2. Syncs Sequelize models (dev) or runs migrations (production)
3. Starts listening on the configured port (default 5000)
4. Calls `reapStaleGenerations()` on boot to recover any rows stuck in `queued`/`generating` from a previous crash
5. Logs provider status (real vs mock AI providers)

**`backend/src/app.js`** — Express app configuration:
1. CORS with `credentials: true` (ready for httpOnly cookies)
2. JSON body parser with size limit
3. `helmet` for security headers
4. Rate limiters (general API, auth-specific, generation-specific)
5. Static file serving for `/uploads` directory
6. All API routes mounted under `/api/v1`
7. Swagger UI at `/api-docs` (disabled in production)
8. Unified error handler (last middleware)

### 4.2 Configuration System

**File:** `backend/src/config/index.js`

**Critical rule:** This is the **ONLY file** under `src/` that reads `process.env`. A test (`config.test.js`) greps the entire source tree and fails if any other file accesses `process.env` directly.

**Config sections:**
```
config = {
  server: { port, corsOrigin, trustProxy },
  db: { host, port, name, user, password, dialect, logging },
  jwt: {
    accessSecret, refreshSecret,
    accessExpiresIn (15m), refreshExpiresIn (7d)
  },
  ai: {
    anthropicKey, anthropicModel ('claude-sonnet-5'),
    openaiKey, openaiImageModel ('gpt-image-1')
  },
  serp: { enabled, key, flagEnabled, hasKey },
  storage: {
    driver ('local'|'s3'), uploadMaxSize (10MB),
    s3: { bucket, region, accessKey, secretKey, publicBaseUrl }
  },
  app: { logoPath }
}
```

**Boot-time validation:**
- **Production** requires `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and all `DB_*` credentials. Refuses to boot without them.
- JWT secrets **must differ** from each other — boot fails if they're equal.
- Missing AI keys trigger mock provider fallback with logged warnings.
- `SERPAPI_ENABLED=true` without `SERPAPI_KEY` behaves as disabled.

**Graceful degradation pattern:** Every optional feature degrades rather than crashes. Boot prints every degradation explicitly. `GET /api/v1/meta` exposes which providers are live so the UI can show appropriate notices.

### 4.3 Database & Models

#### Sequelize Setup (`backend/src/models/index.js`)
- If `NODE_ENV === 'test'` → uses **in-memory SQLite**
- Otherwise → uses **MySQL 8** configured from `config.db`
- Initialises and exports `Blog` and `User` models

#### Blog Model (`backend/src/models/blog.js`) — 56 Columns

**15 contractual columns (existing production table):**

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER, auto-increment PK | |
| `blog_title` | STRING | |
| `topic` | STRING | |
| `seo_keywords` | STRING | |
| `blog_picture` | STRING | Featured image path |
| `blog_content` | LONGTEXT | **Read-only** — derived from content_blocks |
| `blog_status` | TINYINT, default 0 | 0=draft, 1=published, 2=scheduled, 3=archived |
| `published_by` | STRING | Free-text attribution, NOT a FK |
| `publish_date` | DATE | |
| `total_views` | INTEGER, default 0 | |
| `start_date` | DATE | |
| `end_date` | DATE | |
| `created_at` | DATE | |
| `updated_at` | DATE | |
| `deleted_at` | DATE | Soft delete (paranoid mode) |

**41 new columns:**

| Column | Type | Purpose |
|---|---|---|
| `slug` | STRING, unique index | URL-friendly identifier |
| `category` | STRING | Blog category |
| `meta_description` | STRING | SEO meta description |
| `content_blocks` | JSON | **Source of truth** — ordered `[{id, type, data}]` array |
| `word_count` | INTEGER | Derived from content_blocks on save |
| `seo_score` | INTEGER | Derived: 0-100, null when content is empty |
| `seo_score_breakdown` | JSON | Detailed per-criterion scoring |
| `brand_voice_tone` | STRING | e.g., "Warm, reverent" |
| `brand_voice_pov` | STRING | Point of view |
| `brand_voice_traits` | JSON | Array of voice traits |
| `brand_voice_summary` | STRING | AI-derived voice summary |
| `brand_voice_source_type` | STRING | 'none', 'text', 'url', 'file' |
| `brand_voice_source_ref` | STRING | Source reference (URL, filename, etc.) |
| `brand_voice_confirmed` | BOOLEAN | **Must be true before generation** |
| `content_config` | JSON | SEO structure toggles, content length, etc. |
| `outline_data` | JSON | AI-generated/edited article outline |
| `image_prompt` | STRING | Prompt for AI image generation |
| `image_style` | STRING | Selected image style |
| `image_has_logo` | BOOLEAN | Whether logo overlay is applied |
| `image_logo_position` | STRING | 9-point grid position |
| `extra_images` | JSON | Additional images array |
| `generation_status` | ENUM | 'draft', 'queued', 'generating', 'generated', 'failed' |
| `generation_error` | STRING | Error message on failure |
| `generation_config` | JSON | Full snapshot of generation settings |
| `generation_started_at` | DATE | |
| `generation_completed_at` | DATE | |
| `internal_links` | JSON | Selected internal links for the article |
| `use_web_grounding` | BOOLEAN | Whether to use SerpAPI for grounding |
| `web_grounding_data` | JSON | Cached web grounding results |
| `generate_featured_image` | BOOLEAN | Whether to AI-generate the featured image |
| `serp_rank_keyword` | STRING | Tracked keyword for SERP ranking |
| `serp_rank_position` | INTEGER | Last known Google position |
| `serp_rank_checked_at` | DATE | When rank was last checked |
| `serp_rank_url` | STRING | URL found in SERP results |

**The `beforeSave` Hook** (the most important piece of logic):
When `content_blocks` has changed, the hook automatically:
1. Calls `blocksToHtml(content_blocks)` → writes to `blog_content`
2. Extracts text from blocks → calculates `word_count`
3. Calls `calculateSeoScore()` with title, keywords, content, meta → writes `seo_score` and `seo_score_breakdown`
4. If content_blocks is empty, sets `seo_score` to `null` (prevents empty drafts from dragging down averages)

**This hook is why `blog_content` is effectively read-only** — writing to it directly has no effect because the hook overwrites it on every save.

**Indexes:** `slug` (unique), `blog_status`, `publish_date`, composite `(blog_status, publish_date)`, `generation_status`.

**Table config:** `tableName: 'blogs'`, `paranoid: true` (soft deletes), `underscored: true`.

#### User Model (`backend/src/models/user.js`)

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT.UNSIGNED, auto-increment PK | |
| `name` | STRING(150) | NOT NULL |
| `email` | STRING(255), unique | NOT NULL, normalised to lowercase |
| `password_hash` | STRING(255) | NOT NULL, hashed with bcrypt |
| `role` | STRING(20) | Default: 'editor', validated against ['admin', 'editor'] |
| `is_active` | BOOLEAN | Default: true |
| `last_login_at` | DATE | nullable |
| `token_version` | INTEGER | Default: 0 — incremented on logout |
| `created_at` | DATE | |
| `updated_at` | DATE | |

**Table name:** `users_scriptura` (renamed to avoid conflicts with existing users table).
**Scopes:**
- `defaultScope` — excludes `password_hash` to prevent accidental credential leakage
- `withPassword` — includes `password_hash` (used by auth login handler)
- `active` — restricts to `is_active: true`

**Static methods:** `User.hashPassword(plaintext)` using `bcrypt.hash`.
**Instance methods:** `verifyPassword(plaintext)` (constant-time bcrypt.compare), `isAdmin()`, `toSafeJSON()` (excludes password).
**No association to blogs** — `published_by` is free-text, not a foreign key (deliberate — changing it would affect other Divinetalk systems).

#### AutomatedTopic Model (`backend/src/models/automatedTopic.js`)

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT.UNSIGNED, PK | |
| `topic` | STRING, unique | NOT NULL |
| `created_at` | DATE | |
| `updated_at` | DATE | |

**Table name:** `automated_topics`. Stores trending topics for the Autopilot generation feature.

#### ScripturaKeyword Model (`backend/src/models/scripturaKeyword.js`)

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER, PK, auto-increment | |
| `primary_keyword` | STRING | NOT NULL |
| `secondary_keywords` | JSON | Array of secondary keywords |
| `search_intent` | ENUM | 'informational', 'transactional', 'navigational' (default: 'informational') |
| `status` | ENUM | 'not_used', 'in_progress', 'used' (default: 'not_used') |
| `serp_data` | JSON | Cached SERP data for the keyword |
| `used_in_blog_id` | BIGINT.UNSIGNED | FK to `blogs.id` |
| `created_at` | DATE | |
| `updated_at` | DATE | |

**Table name:** `scriptura_keywords`. SEO keyword pool management.
**Associations:**
- `ScripturaKeyword.hasMany(Blog, { foreignKey: 'keyword_pool_id', as: 'blogs' })`
- `Blog.belongsTo(ScripturaKeyword, { foreignKey: 'keyword_pool_id', as: 'keyword' })`

### 4.4 Routes & Controllers

All routes are mounted under `/api/v1` in `backend/src/routes/v1/index.js`.

#### Auth Routes (`/api/v1/auth`)

| Method | Path | Controller | Auth | Rate Limit | Purpose |
|---|---|---|---|---|---|
| `POST` | `/login` | `authController.login` | Public | `authLimiter` | Sign in, returns token pair + profile |
| `POST` | `/refresh` | `authController.refresh` | Public | `authLimiter` | Rotates both tokens |
| `POST` | `/logout` | `authController.logout` | Required | — | Revokes all refresh tokens |
| `GET` | `/me` | `authController.me` | Required | — | Hydrate current user |

**Login logic:** Returns identical response for wrong password and unknown email. Burns comparable bcrypt time on missing-account path to prevent enumeration by timing.

**Refresh logic:** Validates refresh token with separate secret, checks `type: 'refresh'` claim, checks `token_version` against DB. Returns rotated token pair.

**Logout logic:** Increments `token_version`, instantly invalidating all outstanding refresh tokens. Access tokens remain valid until TTL (15 min) — a deliberate, bounded trade-off.

#### Blog Routes (`/api/v1/blogs`)

| Method | Path | Controller | Auth | Purpose |
|---|---|---|---|---|
| `GET` | `/` | `blogController.list` | Required | Paginated list (omits `blog_content`) |
| `POST` | `/` | `blogController.create` | Required | Create draft (**always forces draft status**) |
| `GET` | `/linkable` | `blogController.getLinkable` | Required | Published blogs for internal link picker |
| `GET` | `/:id` | `blogController.show` | Required | Full record with content_blocks + blog_content |
| `PATCH` | `/:id` | `blogController.update` | Required | Partial update |
| `DELETE` | `/:id` | `blogController.remove` | Required | Soft delete |
| `POST` | `/:id/publish` | `blogController.publish` | Required | Publish or schedule |
| `POST` | `/:id/restore` | `blogController.restore` | Admin only | Restore soft-deleted |
| `GET` | `/:id/generation-status` | `blogController.generationStatus` | Required | Poll generation progress |

**Create logic:** Forces `blog_status: DRAFT` and `generation_status: DRAFT`, defaults attribution to `DEFAULT_PUBLISHED_BY` ('DivineTalk Astrology'), sets default SEO structure config, and matches `ScripturaKeyword` pool if `keyword_pool_id` is present.

**Update logic:** Blocks content updates if `blog.isGenerating()` (returns `409 Conflict`), preventing mutations to an article while AI generation is in flight.

**List filters:** `page`, `limit` (≤100), `status` (number or label, comma-separated), `generation_status`, `category`, `q` (searches title, topic, keywords), `sort` (allowlist), `order`, `include_deleted` (admin only).

**Search behaviour:** `%` and `_` are **stripped** (not escaped) from search terms for cross-dialect compatibility. Searching `100%` searches for `100`.

**Publish validation (`assertPublishable`):** Refuses to publish if:
- No `content_blocks`
- No rendered `blog_content`
- `generation_status === 'failed'`
- `generation_status === 'generating'` or `'queued'`

Returns specific `422` error codes: `NO_CONTENT`, `NO_RENDERED_CONTENT`, `GENERATION_FAILED`, `GENERATION_IN_PROGRESS`.

#### Generation Routes (`/api/v1/generate`)

| Method | Path | Controller | Auth | Rate Limit | Purpose |
|---|---|---|---|---|---|
| `POST` | `/title` | `generateController.generateTitle` | Required | `generationLimiter` | AI title suggestions with SEO scores |
| `POST` | `/outline` | `generateController.generateOutline` | Required | `generationLimiter` | AI article outline |
| `POST` | `/article` | `generateController.generateArticle` | Required | `generationLimiter` | Async full article generation |
| `GET` | `/status/:blogId` | `generateController.getStatus` | Required | — | Poll generation status |
| `POST` | `/auto-topic` | `generateController.generateAutoTopic` | Required | `generationLimiter` | AI trending topic suggestion |
| `POST` | `/reap-stale` | `generateController.reapStale` | Admin | — | Recover stuck generations |

**Article generation validation:**
- Returns `422 BRAND_VOICE_NOT_CONFIRMED` if brand voice was set but not confirmed
- Returns `409 GENERATION_IN_PROGRESS` if a generation is already running for that blog

#### Brand Voice Routes (`/api/v1/brand-voice`)

| Method | Path | Controller | Auth | Purpose |
|---|---|---|---|---|
| `POST` | `/analyze` | `brandVoiceController.analyze` | Required | Analyze text/URL/file for brand voice |

**Three source modes:**
1. **Text:** Direct paste → AI analysis
2. **URL:** Web scrape with SSRF guard → AI analysis
3. **File:** `.txt` or `.docx` (≤2MB) upload → extract text (mammoth for .docx) → AI analysis

Returns `{tone, pov, traits[], summary, source_ref}`.

#### Media Routes (`/api/v1/media`)

| Method | Path | Controller | Auth | Purpose |
|---|---|---|---|---|
| `POST` | `/upload` | `mediaController.upload` | Required | Upload image (validates magic bytes, strips EXIF) |
| `POST` | `/generate-image` | `mediaController.generateImage` | Required | AI image generation |
| `POST` | `/composite-logo` | `mediaController.compositeLogo` | Required | Apply logo overlay |

**Security:** Upload validates actual file content via magic bytes (spoofed `Content-Type` is rejected). EXIF metadata is stripped (uploaded photos can carry GPS).

**Path convention:** Responses carry both `relativePath` (store this) and `publicUrl` (render this). Database holds paths, never URLs — enabling S3 migration via `.env` change.

#### SERP Routes (`/api/v1/serp`) — Feature-Flagged

| Method | Path | Controller | Auth | Purpose |
|---|---|---|---|---|
| `POST` | `/check-rank` | `serpController.checkRank` | Required | Google position for a keyword |
| `POST` | `/ground-facts` | `serpController.groundFacts` | Required | Web grounding for generation |

Both return `503 FEATURE_DISABLED` unless `SERPAPI_ENABLED=true` **AND** `SERPAPI_KEY` is set.

#### Analytics Routes (`/api/v1/analytics`)

| Method | Path | Controller | Auth | Purpose |
|---|---|---|---|---|
| `GET` | `/overview` | `analyticsController.overview` | Required | Full dashboard data (one request) |
| `GET` | `/in-flight` | `analyticsController.inFlight` | Required | Queued/running generations |

**`?months=1..36`** — bounded because aggregation happens in application code.

#### Settings Routes (`/api/v1/settings`)

| Method | Path | Controller | Auth | Purpose |
|---|---|---|---|---|
| `GET` | `/topics` | `settingsController.getTopics` | Required | List automated topics |
| `POST` | `/topics` | `settingsController.addTopic` | Required | Add a topic |
| `DELETE` | `/topics/:id` | `settingsController.deleteTopic` | Required | Remove a topic |
| `GET` | `/topics/suggest` | `settingsController.suggestTopics` | Required | AI topic trend suggestions |

#### Keywords Routes (`/api/v1/keywords`)

| Method | Path | Controller | Auth | Purpose |
|---|---|---|---|---|
| `GET` | `/` | `keywordsController.list` | Required | List keyword pool |
| `POST` | `/` | `keywordsController.create` | Required | Add keyword |
| `PUT` | `/:id` | `keywordsController.update` | Required | Update keyword |
| `DELETE` | `/:id` | `keywordsController.remove` | Required | Remove keyword |
| `POST` | `/bulk-import` | `keywordsController.bulkImport` | Required | Bulk import keywords |
| `GET` | `/suggest` | `keywordsController.suggest` | Required | AI keyword suggestions by topic |

#### Meta Route (`/api/v1/meta`) — Inline in `routes/v1/index.js`

| Method | Path | Controller | Auth | Purpose |
|---|---|---|---|---|
| `GET` | `/` | Inline handler in `index.js` | Public | Capabilities, enums, defaults, feature flags |

**There is no separate `metaController.js` or `metaRoutes.js`.** The handler is defined directly in `backend/src/routes/v1/index.js` as an inline `router.get('/meta', ...)` callback. It reads `config.ai.textProvider`, `config.ai.imageProvider`, `config.serp.enabled`, `config.storage.driver` and returns feature flags alongside all enum constants.

Returns feature flags: `serp_api`, `text_provider`, `image_provider`, `storage_driver`. The frontend uses these to conditionally show/hide features and display "Mock AI provider" notices.

### 4.5 Middleware Stack

#### `auth.js`
- **`requireAuth`:** Extracts Bearer token from `Authorization` header → verifies JWT with access secret → loads user from DB by `id` (one indexed PK read per request) → checks `is_active` → populates `req.user` (`{ id, name, email, role }`) and `req.userRecord`. User is loaded from DB on every request (not just cached from JWT) to enable **immediate account deactivation**.
- **`requireRole(...roles)`:** Checks `req.user.role` against allowed roles → returns `403 INSUFFICIENT_ROLE` if not authorised.
- **`requireAdmin`:** Shorthand for `requireRole(USER_ROLES.ADMIN)`.
- **`optionalAuth`:** Populates `req.user` if valid token present; continues as unauthenticated without throwing on invalid/missing token.

#### `validate.js`
- Generic Zod validation middleware factory. Takes schemas for `body`, `query`, `params`.
- Validates each part, collects all errors into one response.
- Returns `422` with `fieldErrors` keyed as `body.field`, `query.field`, `params.field` — so a bad query param and a bad body field are distinguishable in one response.

#### `rateLimit.js`
Three rate limiters using `express-rate-limit`, keyed per-user (`user:{id}`) when authenticated, falling back to IP (`ip:{req.ip}`) when unauthenticated:
- **`globalLimiter`:** 300 requests per 15 minutes across all `/api/v1` routes
- **`authLimiter`:** 20 requests per 15 minutes on login/refresh
- **`generationLimiter`:** 30 requests per 60 minutes on paid AI generation and SERP endpoints

All are **in-memory** — per-instance only. Multiple instances need a shared store (Redis).

#### `errorHandler.js`
Catches all errors and formats into the standard envelope:
```json
{ "error": { "code": "ERROR_CODE", "message": "...", "details": {} } }
```
Maps: Sequelize errors, JWT errors, Zod validation errors, custom `AppError` instances, and unknown errors.

#### `upload.js`
Configures `multer` with size limits, file type filters, and temp storage.

### 4.6 Validators (Zod Schemas)

Located in `backend/src/validators/`. Each file exports Zod schemas used by the `validate` middleware. Files use the naming convention `<domain>.validators.js`.

**Existing validator files:**
- `blog.validators.js` — create/update/list/publish schemas
- `auth.validators.js`
- `generation.validators.js`
- `brandVoice.validators.js`
- `media.validators.js`
- `serp.validators.js`
- `analytics.validators.js`

**Note:** There are no `settingsValidator.js` or `keywordValidator.js` files. The settings and keywords routes use inline validation or minimal Zod checks directly in their route/controller files rather than dedicated validator modules.

**Key design: mass-assignment prevention.** The write schemas **do not declare** server-owned fields: `id`, `total_views`, `seo_score`, `word_count`, `generation_status`, `generation_error`, `serp_rank_*`, `created_at`, `deleted_at`. Since Zod strips unknown keys, posting these fields has them silently dropped.

**`POST /blogs` additionally forces `blog_status: draft`** even if the client asks for published — publishing must go through the dedicated publish endpoint.

Key schemas:
- **`createBlog`:** Requires `blog_title`. All other fields optional. Server-owned fields excluded.
- **`updateBlog`:** All fields optional (partial update). Server-owned fields excluded.
- **`listBlogs`:** Query params: `page`, `limit` (≤100), `status`, `sort` (allowlist: `created_at`, `updated_at`, `publish_date`, `blog_title`, `total_views`, `seo_score`, `word_count`), `order`, `q`, `generation_status`, `category`, `include_deleted`.
- **`publishBlog`:** Optional `scheduled` boolean, optional `publish_date`.

### 4.7 Services Layer

#### `analyticsService.js` — Dashboard Analytics

**Exported:** `getOverview({ months })`, `getInFlightGenerations()`, `SCORE_BUCKETS`, `monthSeries(months)`, `average(values)`.

**In-JS aggregation rationale:** Aggregates in JavaScript rather than SQL (`DATE_FORMAT` in MySQL vs `strftime` in SQLite) to keep queries portable. All aggregation uses narrow column selection (never selects `blog_content` or `content_blocks`).

`getOverview` performs a single `Blog.findAll` and calculates: totals by status and generation status, total views, average SEO score, average word count, monthly publishing cadence, word count trends, SEO score trends, score distribution buckets (0-20, 21-40, 41-60, 61-80, 81-100), top 12 keywords (combining primary and secondary), category breakdown, and recent activity. If `config.serp.enabled`, appends SERP ranking position trends.

`getInFlightGenerations` fetches up to 50 blogs with `generation_status` of `QUEUED` or `GENERATING` for real-time frontend polling.

#### `blogService.js` — Core Business Logic

**`listBlogs(options)`:** Paginated listing with:
- Status filtering (supports numeric, label, comma-separated)
- Generation status filtering
- Category filtering
- Full-text search across `blog_title`, `topic`, `seo_keywords` using `buildSearchPattern` (strips `%` and `_` for dialect portability)
- Sort with allowlist validation
- Soft-delete inclusion (admin only)
- Always omits `blog_content` from list queries (performance)
- Returns `{ blogs, total, page, limit }`

**`createBlog(data)`:**
- Forces `blog_status` to `DRAFT`
- Generates slug from `blog_title` using `slugify`
- On slug collision, appends random suffix
- Returns created blog

**`updateBlog(id, data)`:**
- Partial update via `blog.update(data)`
- If `blog_title` changes, regenerates slug
- Prevents setting slug to empty/null

**`publishBlog(id, payload)`:**
- Calls `assertPublishable(blog)` — checks for content, rendered content, no failed/in-progress generation
- Sets `blog_status` to `PUBLISHED` or `SCHEDULED`
- Sets `published_by`, `publish_date`

**`getAnalytics(months)`:**
- All aggregation done in **JavaScript, not SQL** (for MySQL/SQLite portability)
- Narrow column selection (never selects `blog_content`)
- Calculates: publishing cadence (gap-filled monthly counts), SEO score distribution (5 buckets: 0-20, 21-40, 41-60, 61-80, 81-100), status breakdown, word count trends (gap-filled, null for empty months), top keywords, average scores

**`reapStaleGenerations({ olderThanMs })`:**
- Finds rows stuck in `queued`/`generating` older than threshold (default: 30 minutes)
- Marks them as `failed` with appropriate error message
- Called on server boot and exposed as an admin endpoint

**`getLinkableBlogs()`:** Returns published blogs with only `id`, `blog_title`, `slug` for the internal link picker.

#### `slug.js` — URL Slug Generation

**Exported:** `slugifyTitle(input)`, `generateUniqueSlug(title, options)`, `MAX_SLUG_LENGTH` (240).

- `slugifyTitle` converts input to URL-safe lowercase slug (`[a-z0-9-]`), strips non-Latin/punctuation characters, truncates at word boundaries
- `generateUniqueSlug` queries DB for existing matching slugs (including soft-deleted rows), appends `-2`, `-3`, etc. for collisions. If attempts exceed 50, appends a base36 timestamp discriminator.

#### `tokens.js` — JWT Token Management

**Exported:** `signAccessToken(user)`, `signRefreshToken(user)`, `issueTokenPair(user)`, `verifyAccessToken(token)`, `verifyRefreshToken(token)`, `extractBearerToken(req)`, `TOKEN_TYPE`.

- Uses separate secret keys for access and refresh tokens
- Access tokens are short-lived (default 15m)
- Refresh tokens embed the user's `token_version` (`tv`) — logout increments this in DB, revoking all existing refresh tokens statelessly

#### `brandVoice.js` — Brand Voice Analysis

**Exported:** `analyzeBrandVoice(input, options)`, `extractFromText(text)`, `extractFromUrl(url)`, `extractFromFile(buffer, filename)`, `extractTextFromHtml(html)`, `assertSafeUrl(url)`, `isBlockedAddress(address)` + constants.

**Three extraction paths:**
1. **Text:** Direct paste → AI analysis
2. **URL:** Web scrape with full SSRF defense → `cheerio` HTML parsing to extract body prose → AI analysis
3. **File:** `.txt` (direct read) or `.docx` (via `mammoth` lazy-require) → AI analysis

**SSRF defense (multi-layered):**
- Validates protocols (http/https only)
- Rejects credentials in URLs
- Checks hostnames against blocked lists/suffixes (`localhost`, `.internal`, `.local`)
- Resolves DNS and verifies ALL returned IP addresses against blocked CIDR ranges (loopback, RFC1918, link-local metadata 169.254.169.254)
- Handles redirects manually (`maxRedirects: 0`) up to 3 hops, re-running full SSRF check on every hop
- Response size capped at 2MB

Returns `{ tone, pov, traits, summary, confirmed: false }`. The `confirmed: false` is key — human must explicitly confirm.

#### `imageGeneration.js` — AI Image Pipeline

**Exported:** `generateBlogImage(options)`, `buildImagePrompt(args)`, `buildAltText(args)`, `STYLE_DIRECTIVES`, `BASE_DIRECTIVES`.

- `buildImagePrompt` assembles structured prompts combining subject, topic, style directive, and base cultural/dignity constraints (`BASE_DIRECTIVES` enforcing no text/watermarks and respectful Hindu cultural depiction)
- `generateBlogImage` executes sequential image generation calls (avoiding 429 rate limits), applies optional logo overlays via `logoComposite`, extracts dimensions/format using `sharp`, saves images via storage, and returns image metadata array

#### `logoComposite.js` — Server-Side Logo Watermarking

**Exported:** `compositeLogo(imageBuffer, options)`, `computeOverlayGeometry(args)`, `resolveLogoPath(candidates)`.

- Overlays brand logos server-side using `sharp` so stored bytes carry the watermark for public display and social sharing
- `computeOverlayGeometry` is a pure function calculating logo size as proportion of base image width (`DEFAULT_SIZE_RATIO = 0.18`, `MARGIN_RATIO = 0.04`)
- Handles EXIF rotation, alpha transparency modulation, and 9-point grid positioning
- If no logo asset exists, logs warning and returns original buffer without throwing

### 4.8 AI Provider Abstraction

Located in `backend/src/services/ai/`.

**Factory pattern (`index.js`):**
- `getTextProvider()` → instantiates and caches the provider identified by `config.ai.textProvider` (`'anthropic'`, `'openai'`, or `'mock'`). An unrecognised string falls back to `MockProvider` with a warning rather than crashing.
- `getImageProvider()` → same pattern keyed by `config.ai.imageProvider`.
- Both cache their instance (one per process) so the SDK client's HTTP connection pool is reused.
- `resetProviders()` clears the cache — used by tests that swap providers without restarting.
- `setProviders({ text, image })` injects pre-built instances directly — narrow escape hatch for integration tests.
- Logs a debug line when each provider is first instantiated (e.g. `Text provider ready: anthropic`).

#### AnthropicProvider (`anthropicProvider.js`)
- Uses `@anthropic-ai/sdk` to call Claude (configured with `maxRetries: 0` — retries managed by `BaseProvider.withRetry`)
- Default model: `claude-sonnet-5` (configurable via `ANTHROPIC_MODEL`)
- **Temperature settings:** titles=0.9, brandVoice=0.1, outline=0.6, article=0.7
- **Methods:**
  - `generateTitles(topic, keywords)` — Returns title suggestions with SEO scores and breakdowns
  - `generateOutline(topic, keywords, title)` — Returns structured article outline
  - `generateArticle(config)` — Builds a detailed prompt including brand voice, SEO config, outline, web grounding data. Returns `content_blocks` array
  - `analyzeBrandVoice(text)` — Analyzes text for tone, POV, traits, summary
  - `suggestTopics()` — Suggests trending astrology/spiritual topics
  - `generateAutoTopicFromKeyword(opts)` — Topic from keyword pool
- Each method constructs system + user prompts, calls `client.messages.create()`, parses JSON response

#### BaseProvider (`BaseProvider.js`) — Abstract Base Class
- Declares standard AI interface (`generateTitles`, `suggestTopics`, `analyzeBrandVoice`, `generateOutline`, `generateArticle`, `generateImage`)
- **`withRetry(fn)`:** Shared retry policy with full-jitter exponential backoff (retries up to 3 times on transient status codes: 429, 500, 502, 503, 504, 529 and network timeouts/resets)
- **`extractJson(raw)`:** Resilient JSON extraction stripping markdown code fences and scanning for balanced `{}`/`[]` boundaries, string-literal aware
- **`normalizeBlocks(rawBlocks, options)`:** Normalizes model output to `{ id, type, data }` block objects, enforcing allowed block types and applying SEO structure toggles (e.g., promoting h3→h2 when h3 is toggled off)

#### Prompts (`prompts.js`) — Centralised Prompt Repository
- Houses ALL editorial prompt templates for DivineTalk
- `SYSTEM_PROMPT` defines senior content editor persona enforcing terminology rules, prohibiting false predictions, and forbidding fear-selling or medical/financial guarantees
- `fence(tag, content)` wraps untrusted user/scraped text in XML-like tags with explicit instructions for the model to treat content as data only
- Prompt functions: `titlesPrompt`, `brandVoicePrompt`, `outlinePrompt`, `articlePrompt`, `imagePrompt`, `suggestTopicsPrompt`, `suggestTopicsFromKeywordPrompt`

#### OpenAIProvider (`openaiProvider.js`)
- Uses `openai` SDK — dual provider implementing both text completions and image generation
- Default text model: `gpt-4o-mini`, default image model: `gpt-image-1` (configurable via env)
- Text methods call `client.chat.completions.create` with `response_format: { type: 'json_object' }`
- **`generateImage(prompt, options)`** — Calls `client.images.generate()`, decodes base64 or downloads image URL to return raw buffer

#### MockProvider (`mockProvider.js`)
- **Deterministic offline provider** for keyless, offline generation. Uses `Picker` class (SHA-256 PRNG seeded from input options) so identical inputs yield byte-identical outputs
- Returns realistic pre-built content blocks, titles with SEO scores, outlines, brand voice analysis, and trending topics
- `generateImage` synthesizes real valid PNG buffers using `sharp` in Divinetalk's palette (saffron/indigo/gold) — downstream sharp processing works without network calls
- All mock outputs are realistic enough for full end-to-end testing and demo

### 4.9 Storage Abstraction

Located in `backend/src/services/storage/`.

#### StorageService (`StorageService.js`) — Singleton Facade
- Delegates to `LocalDriver` or `S3Driver` based on `config.storage.driver`
- **Methods:** `save(buffer, relativePath)`, `read(relativePath)`, `delete(relativePath)`, `exists(relativePath)`, `toPublicUrl(relativePath)`
- **`buildStoragePath(filename, category)`** — Generates paths matching production format: `{category}/{MonthYear}/{40-char-random}.{ext}` (matches Laravel's `Str::random(40)` pattern from live data)

**Critical design:** Database columns hold **storage-relative paths, never URLs** (e.g., `blogs/July2026/xxx.png`). `toPublicUrl()` resolves them at serialisation time. This is what makes S3 migration a `.env` change.

#### LocalDriver (`LocalDriver.js`)
- Saves files to `backend/uploads/`
- Resolves public URLs relative to the API base URL
- Fully functional, used in development and production

#### S3Driver (`S3Driver.js`) — Deliberate Stub
- **Constructor validates config** — `STORAGE_DRIVER=s3` fails **on boot** with a message naming missing variables
- **`toPublicUrl()` is fully implemented** — returns `{S3_PUBLIC_BASE_URL}/{path}`
- **All I/O methods throw `501 Not Implemented`** — save, read, delete, exists
- Implementing S3 = adding `@aws-sdk/client-s3` and implementing four methods

### 4.10 Content Pipeline (Blocks → HTML)

**`backend/src/services/blocksToHtml.js`** — The Canonical Renderer

Converts `content_blocks` array to full HTML. Supports **10 block types:**

| Block Type | HTML Output | Notes |
|---|---|---|
| `heading` | `<h2>`, `<h3>`, `<h4>` | Level clamped to 2-4 (h1 reserved for page title) |
| `paragraph` | `<p>` | Supports inline formatting, `scriptura-lead` class |
| `image` | `<figure><img><figcaption>` | URLs resolved via `StorageService.toPublicUrl` |
| `list` | `<ul>` or `<ol>` with `<li>` | Ordered/unordered |
| `quote` | `<blockquote>` | Optional citation |
| `table` | `<table><thead><tbody>` | Dynamic rows/columns, header row |
| `faq_accordion` | `<details><summary>` | Q&A pairs, collapsible |
| `cta_button` | `<a class="scriptura-cta">` | Call-to-action button link |
| `embed` | `<iframe>` | External embed (YouTube, etc.) |
| `key_takeaway` | `<div class="scriptura-takeaway">` | Key takeaway box with title |

**Final output is sanitized** through `sanitizeHtml()` before being returned — a future renderer that forgets to escape cannot introduce a hole.

### 4.11 SEO Scoring Engine

**`backend/src/services/seoScore.js`**

**Transparent heuristic** scoring articles from 0-100. Criteria:

| Criterion | Optimal Range | What It Checks |
|---|---|---|
| Title length | 50-60 chars | SEO-optimal title length |
| Keyword in title | Present | Title contains target keyword |
| Keyword count | 3-8 keywords | Number of comma-separated keywords |
| Word count | 1500-2500 words | Article length |
| Keyword density | 1-3% | Keyword occurrence in content |
| Heading structure | Has H2/H3 | Proper heading hierarchy |
| Internal links | Has links | Internal linking present |
| Image count | Has images | Visual content present |
| FAQ presence | Has FAQ blocks | Structured FAQ content |
| Meta description | 120-160 chars | SEO meta description |

Each criterion contributes a **weighted score**. Returns both total score (0-100) and detailed `breakdown` object showing each criterion's contribution. The breakdown is stored in `seo_score_breakdown` for transparency.

**`seo_score` is set to `null`** when the block list is empty — prevents unconfigured drafts from dragging down dashboard averages.

### 4.12 Generation Pipeline (State Machine)

**`backend/src/services/generation.js`**

**State machine:** `draft → queued → generating → generated | failed`

**`startGeneration(blogId, options)`:**

1. **Validates** the blog exists and is not already generating
2. Sets `generation_status` to `queued`
3. **Kicks off async work** (returns immediately to caller):
   a. Sets status to `generating`
   b. Builds prompt from blog config (topic, keywords, brand voice, content config, outline)
   c. If web grounding enabled + SerpAPI configured: calls `SerpService.groundFacts()` to fetch contextual web data
   d. Calls `getTextProvider().generateArticle(config)` → returns `content_blocks`
   e. If image generation enabled: calls `getImageProvider().generateImage(prompt)` → optionally composites logo overlay using `sharp`
   f. Saves: `content_blocks`, `blog_picture`, `extra_images`, `generation_config` (full snapshot)
   g. Sets `generation_status` to `generated`
4. **On error:** sets `generation_status` to `failed` with `generation_error`

**Key invariants:**
- **Generation runs in-process** — no queue, no Redis. Right for a single-instance internal tool.
- **Generation never publishes.** It never touches `blog_status`. Publishing is a separate, explicit action.
- **Brand voice gate:** If brand voice was supplied but `brand_voice_confirmed !== true`, the controller refuses with `422 BRAND_VOICE_NOT_CONFIRMED` before even calling this service.
- **No concurrent generations:** Returns `409 GENERATION_IN_PROGRESS` if already queued/generating.
- **`generation_config`** stores a full snapshot of all settings used — makes "why did this article come out like this?" answerable from a single SELECT.

**Recovery:** `reapStaleGenerations({ olderThanMs })` finds rows stuck in `queued`/`generating` older than a threshold and marks them `failed`. Called on boot.

### 4.13 Sanitization & Security

**`backend/src/services/sanitize.js`**

#### `sanitizeHtml(html)`
Uses `sanitize-html` with a **narrow allow-list:**
- **Allowed tags:** `h1`-`h6`, `p`, `a`, `img`, `ul`, `ol`, `li`, `blockquote`, `pre`, `code`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `details`, `summary`, `div`, `span`, `strong`, `em`, `br`, `hr`, `figure`, `figcaption`, `sup`, `sub`, `mark`, `del`
- **Attributes restricted per tag:** e.g., `href` for `<a>`, `src`/`alt`/`width`/`height` for `<img>`
- **`data:` URLs rejected everywhere** (inline SVG is a common script-smuggling vector)
- **Class names filtered to a known list**
- **`<script>` and `<style>` tags have their CONTENT dropped**, not just tags stripped

#### `isValidUrl(url)`
Validates URLs for href/src attributes:
- Strips `javascript:` schemes, `data:` URIs, control characters
- Removes space/DEL bytes and protocol-relative `//` URLs
- Adds `rel="noopener noreferrer"` and `target="_blank"` on external links
- Adds `loading="lazy"` on images

#### Security Layers

**Stored XSS prevention:**
- Content is sanitized **on the way in** (before persisting), not only on render
- `blocksToHtml` runs the assembled document through the sanitizer once more
- Frontend `sanitizeInline.js` (DOMPurify) is a second layer for content from other systems

**SSRF protection** (brand voice URL analysis):
- Blocks non-HTTP(S) schemes
- Blocks loopback, link-local (169.254/*), RFC1918 ranges
- Blocks `localhost`, `*.local`, cloud metadata hostnames
- Re-checks after redirects with redirect cap and response-size cap

**Path traversal prevention** (`resolveSafePath`):
- Rejects `..`, absolute paths, Windows drive letters, UNC paths, NUL bytes, control characters, percent signs, trailing dots/spaces

**Mass assignment prevention:**
- Zod schemas strip unknown keys
- Server-owned fields not declared in schemas → silently dropped on write

### 4.14 Constants (Single Source of Truth)

**`backend/src/constants/index.js`**

```javascript
BLOG_STATUS = { DRAFT: 0, PUBLISHED: 1, SCHEDULED: 2, ARCHIVED: 3 }
BLOG_STATUS_LABELS / BLOG_STATUS_BY_LABEL  // Bidirectional name ↔ value maps
GENERATION_STATUS = { DRAFT: 'draft', QUEUED: 'queued', GENERATING: 'generating', GENERATED: 'generated', FAILED: 'failed' }
GENERATION_RETRYABLE_FROM = ['draft', 'generated', 'failed']
GENERATION_IN_FLIGHT = ['queued', 'generating']
USER_ROLES = { ADMIN: 'admin', EDITOR: 'editor' }
ARTICLE_TYPES = ['how_to', 'listicle', 'product_review', 'comparison', 'case_study', 'general']
READABILITY_LEVELS = ['5th_grade', '8th_grade', 'college', 'none']
BRAND_VOICE_SOURCE_TYPES = ['text', 'web_scrape', 'file_upload', 'none']
POINTS_OF_VIEW = ['first_person_singular', 'first_person_plural', 'second_person', 'third_person']
IMAGE_STYLES = ['photo', 'illustration', 'minimal', 'brand_colored']
LOGO_POSITIONS = ['top_left', 'top_right', 'bottom_left', 'bottom_right', 'center', 'none']
BLOCK_TYPES = ['heading', 'paragraph', 'image', 'quote', 'table', 'faq_accordion', 'cta_button', 'list', 'embed', 'key_takeaway']
DEFAULT_SEO_STRUCTURE = { h1: true, h2: true, h3: true, faq: true, tables: false, key_takeaways: true, quotes: false, lists: true, emphasis: true }
IMAGE_COUNT_MIN = 1, IMAGE_COUNT_MAX = 4
DEFAULT_PUBLISHED_BY = 'DivineTalk Astrology'
```

Nothing else hard-codes these values. Frontend mirrors them in `frontend/src/lib/constants.js`.

### 4.15 OpenAPI / Swagger Docs

**`backend/src/docs/swagger.js`:**
- Assembles OpenAPI spec from per-route-group fragments in `docs/paths/`
- Serves Swagger UI at `/api-docs` (disabled in production)
- Serves raw spec at `/openapi.json` (all environments)
- Uses `swagger-jsdoc` for generation and `swagger-ui-express` for UI

---

## 5. Frontend Architecture

### 5.1 App Shell & Routing

**`frontend/src/App.js`:**
- Uses `react-router-dom` v6
- All routes except `/login` wrapped in `<ProtectedRoute>`
- Layout: `<Header>` + `<Sidebar>` rendered for authenticated routes

| Path | Page | Purpose |
|---|---|---|
| `/login` | `LoginPage` | Sign in |
| `/` | `DashboardPage` | Analytics dashboard |
| `/blogs` | `BlogListPage` | Paginated blog list with filters |
| `/blogs/new` | `WizardPage` | 6-step generation wizard (new blog) |
| `/blogs/automated` | `AutomatedBlogPage` | Autopilot 1-click generation |
| `/blogs/:id` | `BlogViewPage` | Read-only blog view |
| `/blogs/:id/edit` | `EditorPage` | Block editor |
| `/blogs/:id/wizard` | `WizardPage` | Resume wizard for existing blog |
| `/keywords` | `KeywordsPage` | SEO keyword pool management |
| `/settings` | `SettingsPage` | Trending topics management |
| `*` | `NotFoundPage` (inline in `App.js`) | 404 — defined as a local function component inside `App.js`, not a separate page file |

**`frontend/src/index.js`:**
- Renders `<App>` inside `<StrictMode>`, `<MotionConfig>` (with `reducedMotion="user"` to honor OS settings), `<BrowserRouter>`, and `<AuthProvider>`
- Dynamically detects basename from `window.location.pathname` for flexible deployment paths

### 5.2 Authentication Context

**`frontend/src/context/AuthContext.js`:**

React Context managing auth and capabilities state:
- Exports `AuthProvider`, `useAuth()`, `useFeatures()`
- Stores `user`, `features`, `initialising`, `error` in React state
- Tokens stored via `tokenStore` (localStorage wrapper) in `lib/api.js`
- **`login(email, password)`:** Calls `authApi.login()`, stores tokens
- **`logout()`:** Calls `authApi.logout()`, clears tokens
- **Auto-hydration:** On mount, bootstraps capabilities (`metaApi.get()`) and user session (`authApi.me()`) when token exists
- Registers global `setSessionExpiredHandler` to clear local tokens on token refresh failure
- **Exposes:** `isAuthenticated`, `isAdmin`, `user`, `login`, `logout`, `features`

**Known trade-off:** Tokens in `localStorage` — an XSS would expose them. Backend CORS is pre-configured with `credentials: true` for future httpOnly cookie migration.

### 5.3 API Client Layer

**`frontend/src/lib/api.js`:**

- **Axios instance** with base URL `/api/v1`
- **Request interceptor:** Attaches `Authorization: Bearer {token}` from localStorage
- **Response interceptor (401 handling):**
  - On `TOKEN_EXPIRED`, automatically attempts silent refresh via single-flight promise (`refreshPromise`) — only one refresh call at a time
  - Queues concurrent requests during refresh, replays with new access token
  - On refresh failure, triggers `onSessionExpired` handler (clears tokens, redirects to login)
- **`normalizeError(err)`:** Standardises API errors into consistent structure for components

**Exported API wrapper objects:**
```
authApi:       { login, refresh, logout, me }
metaApi:       { get }
blogsApi:      { list, create, get, update, remove, publish, restore, linkable, generationStatus }
generateApi:   { titles, outline, article, status, autoTopic, reapStale }
brandVoiceApi: { analyze, analyzeFile }
mediaApi:      { upload, generateImage, compositeLogo }
serpApi:       { checkRank, groundFacts }
analyticsApi:  { overview, inFlight }
settingsApi:   { getTopics, addTopic, deleteTopic, suggestTopics }
keywordsApi:   { list, create, update, remove, bulkImport, suggest }
```

### 5.4 Pages

#### `DashboardPage.js`
- Fetches `GET /analytics/overview` on mount with configurable `months` window
- Renders: `PublishedOverTimeChart` (area), `MonthlyAverageChart` (line, for word count & SEO trends), `ScoreDistributionChart` (histogram), `StatusDonutChart` (donut), `RankedBarChart` (horizontal bars, for top keywords & categories), `SerpRankChart` (scatter, conditional on SERP enabled)
- `InFlightPanel` polls `GET /analytics/in-flight` every 8s for live generation progress
- `RecentActivityPanel` shows latest articles
- Single overview API call hydrates all charts (prevents data inconsistency)
- Shows "Mock AI provider" notice from features context
- Conditionally shows SERP ranking data based on `data.meta.serp_enabled`

#### `BlogListPage.js`
- Paginated list using `fetchBlogs(params)`
- Filters: status, search query, sort field/order
- Uses `BlogCard` for each blog and `BlogListFilters` for filter controls
- Admin actions: restore deleted blogs
- `X-Total-Count` header for total count display

#### `WizardPage.js`
- 6-step guided article generation wizard
- Manages flat `config` state object matching writable blog columns
- Integrates `useWizardDraft` for auto-saving draft updates to server
- Flattens nested server response into flat config via `configFromBlog`
- Gated step progression via `missingForStep` and `furthestReachableStep`
- Auto-navigates to `/blogs/:id/wizard` after initial draft creation and to `/blogs/:id/edit` after generation completion
- Can resume existing wizard by navigating to `/blogs/:id/wizard`

#### `EditorPage.js`
- Full-featured block editor page
- `content_blocks` owned exclusively by `useBlockHistory` (undo/redo)
- `useAutosave` persists changes — only sends `content_blocks` (server regenerates HTML/word count/SEO via hook)
- Global `Ctrl+Z` / `Ctrl+Y` for undo/redo (ignoring keystrokes inside text inputs)
- Polls status during generation runs and locks canvas while generating
- Includes `EditorCanvas`, `PreviewPane` (toggle), `BlockSettingsPanel`, and publish controls

#### `AutomatedBlogPage.js` — Autopilot Mode
- Autonomous 1-click AI blog generator ("Autopilot Mode")
- Executes full automated pipeline: (1) fetch AI topic/keywords via `generateApi.autoTopic()`, (2) select highest SEO score title, (3) create draft blog row, (4) trigger article generation, (5) poll status every 2.5s until complete
- Animated promo workflow and particle effects
- On completion, offers direct navigation to editor

**Autopilot — Behind the Scenes (Full Flow)**

The `startAutomation` function in `AutomatedBlogPage.js` is the orchestrator. It runs 5 sequential steps with abort-checking between each:

**Step 1 — Fetch AI topic (`topic` stage)**
- Calls `POST /api/v1/generate/auto-topic`
- Backend `generateAutoTopic()` in `generation.js`:
  1. Queries `scriptura_keywords` for the oldest `status: 'not_used'` keyword row
  2. If no keyword exists → picks a random topic from `automated_topics` table (fallback hardcoded list if that's also empty) → creates a new keyword row with `status: 'in_progress'`
  3. If a keyword row exists → marks it `in_progress`
  4. If SerpAPI is enabled → fetches SERP data for the primary keyword and stores it on the keyword row
  5. Calls `textProvider.generateAutoTopicFromKeyword({ keyword, secondaryKeywords, serpData })` → Claude returns `{ titles, topic, suggested_secondary_keywords }`
  6. Scores each title via `scoreTitle()` (same SEO scoring engine as the wizard)
  7. Returns `{ topic, seo_keywords, secondary_keywords, titles[] }` to the frontend

**Step 2 — Pick best title (`title` stage)**
- Pure frontend logic — no API call
- Reduces the `titles` array to find the entry with the highest `seo.score`
- Falls back to `"{topic}: What the Stars Reveal"` if no titles returned

**Step 3 — Create blog draft (`creating` stage)**
- Calls `POST /api/v1/blogs` with a hardcoded sensible defaults payload:
  - `brand_voice_source_type: 'none'`, `brand_voice_confirmed: false`
  - `article_type: 'general'`, `readability_level: '8th_grade'`, `point_of_view: 'second_person'`
  - `target_country: 'IN'`, `language: 'en'`
  - `include_images: true`, `image_count: 1`, `image_style: 'photo'`, `logo_overlay: false`
  - `seo_structure_config: DEFAULT_SEO_STRUCTURE`
  - `category: 'Astrology'`, `published_by: 'DivineTalk Astrology'`
  - Tags = first 3 secondary keywords
- Returns a blog row with `id`

**Step 4 — Trigger generation (`generating` stage)**
- Builds generation config by merging `INITIAL_CONFIG` + blogPayload via `buildGenerationConfig()` (same helper as Step 6 of the wizard)
- Calls `POST /api/v1/generate/article` with `{ blog_id, config }`
- Backend immediately sets `generation_status: 'queued'` and returns — actual generation runs async in-process

**Step 5 — Poll until done**
- Polls `GET /api/v1/blogs/:id/generation-status` every **2.5 seconds** (max 120 iterations = 5 minutes)
- On `generated` → sets stage to `done`, navigates to `/blogs/:id/edit`
- On `failed` → shows error, sets stage to `error` with retry option
- On timeout → shows timeout error

**Key behaviours:**
- Brand voice is deliberately skipped (`brand_voice_confirmed: false`) — autopilot bypasses the server-side brand voice gate because `brand_voice_source_type: 'none'` means the gate is not triggered
- No outline step — Claude generates structure inline during article generation
- `abortRef` allows cancellation between steps if user navigates away
- The `elapsed` timer ticks every second via `useInterval` while running

#### `KeywordsPage.js`
- SEO keyword pool management
- List, add, remove keywords
- AI keyword suggestions by topic (Claude-backed)
- Status chips: `not_used`, `in_progress`, `used`
- One-click adding of suggested keywords to active pool

**Keyword Suggestion — Behind the Scenes:**

UI flow: User types a broad topic (e.g. "Vedic Astrology") → clicks "Suggest Keywords" → calls `GET /api/v1/keywords/suggest?topic=<topic>`

Backend (`keywords.controller.js` → `suggest`):
1. Validates `topic` query param is present
2. Gets `getTextProvider()` (Claude or mock)
3. Builds an inline prompt (NOT using `prompts.js`): *"You are an SEO expert for an astrology platform. Generate 5 high-value primary SEO keywords related to: `{topic}`. Respond ONLY with a JSON array of strings."*
4. Calls `textProvider.complete({ operation: 'suggestKeywords', prompt, temperature: 0.7, maxTokens: 500 })`
5. Extracts JSON array via regex `/\[.*\]/s` → parses it
6. Returns `{ data: ["keyword1", "keyword2", ...] }` — plain array of strings

Frontend receives the array, renders each as a card with an "Add" button. Clicking Add calls `POST /api/v1/keywords` to persist it to the `scriptura_keywords` table with `status: 'not_used'`.

**Keyword lifecycle in the pool:**
- `not_used` → available for Autopilot to pick up
- `in_progress` → Autopilot has claimed it and is generating
- `used` → generation completed (note: the code marks it `in_progress` but does NOT mark it `used` after generation — this transition is not yet implemented)

#### `SettingsPage.js`
- Trending topics management for Autopilot generation
- CRUD for `automated_topics` table
- Real-time AI topic trend suggestions

**Topic Suggestion — Behind the Scenes:**

UI flow: User clicks "Suggest Topics" (no input needed) → calls `GET /api/v1/settings/topics/suggest`

Backend (`settings.controller.js` → `suggestTopics`):
1. Gets `getTextProvider()` (Claude or mock)
2. Calls `provider.suggestTopics({ count: 5 })`
3. Inside `AnthropicProvider.suggestTopics` → uses `suggestTopicsPrompt(count)` from `prompts.js`:
   - *"You are a digital marketing expert for Divinetalk. Generate {count} trending astrology topics that are currently highly searched or contextually relevant (e.g. current retrogrades, transits, or evergreen topics). Do NOT invent fake news. Respond ONLY with `{ "topics": ["string"] }`"*
4. Returns `{ data: ["topic1", "topic2", ...] }` — plain array of strings

Frontend renders each suggestion with an "Add" button. Clicking Add calls `POST /api/v1/settings/topics` which creates a row in `automated_topics` table (unique constraint — duplicate topics return `409`).

**How topics feed into Autopilot:**
- Topics in `automated_topics` serve as a **fallback pool** when no unused keywords exist in `scriptura_keywords`
- Autopilot picks a random one via `astrologyTopics[Math.floor(Math.random() * astrologyTopics.length)]`
- If `automated_topics` is also empty, Autopilot falls back to a 15-item hardcoded list in `generation.js`

**Relationship between Keywords and Topics:**
```
scriptura_keywords (primary source)
    ↓ if empty
automated_topics (secondary source)  ← managed on SettingsPage
    ↓ if empty
hardcoded fallback list in generation.js
```

#### `BlogViewPage.js`
- Read-only view of a blog
- Uses `BlockRenderer` to render `content_blocks` (same component as editor preview)
- Shows metadata, SEO score, publish info

#### `LoginPage.js`
- Login form using `AuthContext.login`
- Redirects to dashboard on success

**Note:** The 404 page (`NotFoundPage`) is defined inline as a function component inside `App.js`, not as a separate page file in `pages/`.

### 5.5 6-Step Generation Wizard

Located in `frontend/src/components/wizard/`.

**Key wizard infrastructure:**
- **`steps.js`** — Step definitions (`WIZARD_STEPS`), initial config defaults (`INITIAL_CONFIG`), step validation (`missingForStep`), reachability (`furthestReachableStep`), publish mode utilities
- **`WizardShell.js`** — Outer container with header (autosave status), animated step transitions, and footer navigation
- **`StepIndicator.js`** — Visual step progress bar
- **`WizardPage.js`** — Parent page:
- Manages flat `config` state for all 6 steps
- Integrates `useWizardDraft` for debounced API draft persistence
- Gated step progression via `missingForStep` validation

#### Step 1: Topic & Title (`Step1Topic.js`)
- Inputs: topic, primary SEO keyword, secondary keywords (via `TagInput`)
- "Generate Titles" button → calls `generateApi.titles()`
- Displays AI-suggested titles via `TitleSuggestions` component with **live SEO scores and detailed breakdowns** (via `SeoScoreBreakdown`)
- User picks a suggested title or writes their own
- Computes live title score locally via `scoreTitle()` (debounced)

#### Step 2: Brand Voice (`Step2BrandVoice.js`)
- Three source modes: paste text, URL, file upload
- Calls `POST /brand-voice/analyze` with appropriate payload
- Displays AI-derived: tone, POV, traits array, summary
- **User must explicitly confirm** the brand voice (clicks confirm button)
- Sets `brand_voice_confirmed: true` on the blog
- **Without confirmation, generation is blocked server-side**

#### Step 3: Content Configuration (`Step3Content.js`)
- Article type selector (how-to, listicle, product review, comparison, case study, general)
- Readability level (5th grade, 8th grade, college, none)
- Tone of voice, point of view, country, language settings
- AI content cleaning toggle
- SEO structure toggles (h1, h2, h3, faq, tables, key takeaways, quotes, lists, emphasis)
- Internal linking toggle with `InternalLinkPicker` (fetches published blogs via `blogsApi.linkable`)
- Web grounding toggle (shown only if `features.serp_api` is true)
- "Generate Outline" button → calls `generateApi.outline()`
- `OutlineBuilder` — manual heading outline editor (H2-H4) with add/remove/indent/reorder

#### Step 4: Image Configuration (`Step4Images.js`)
- Image inclusion toggle and count selector (1-4)
- Image style selector (`photo`, `illustration`, `minimal`, `brand_colored`)
- Logo overlay toggle with `LogoPositionGrid` (3×3 radio selector built on real `<input type="radio">` with 16:9 aspect ratio)
- Size ratio and opacity controls
- "Preview" button → generates isolated 1-image style preview via `mediaApi.generateImage()` without writing to blog's primary picture field

#### Step 5: Publish Settings (`Step5Publish.js`)
- Publish intent: save as draft, schedule (with date picker), or publish now
- Category input, tags (via `TagInput`)
- Author byline (`published_by`)
- Maps intent to `blog_status` and `publish_date` via `patchForPublishMode` — never writes status `PUBLISHED` directly

#### Step 6: Generate (`Step6Generate.js`)
- Displays pre-flight configuration summary
- Builds schema-compliant generation payload via `buildGenerationConfig(config)`
- Triggers generation via `generateApi.article({ blog_id, config })`
- Shows **live status polling** every 2s via `blogsApi.generationStatus(blogId)` while status is in `GENERATION_IN_FLIGHT`
- Displays progress: queued → generating → generated | failed
- Tracks elapsed time with animated indicators
- On success: calls `onGenerated()` which navigates to editor
- On failure: shows error message with retry option

### 5.6 Visual Block Editor

Located in `frontend/src/components/editor/`.

#### `EditorCanvas.js` — Main Editing Canvas
- Provides `DndContext` and `SortableContext` from `@dnd-kit` for drag-and-drop
- Configures `PointerSensor` (4px constraint) and `KeyboardSensor`
- Restricts drag movement to vertical axis (`restrictToVerticalAxis`)
- Provides screen-reader drag announcements
- Renders `SortableBlock` components for each block

#### `SortableBlock.js` — Individual Block Container
- Integrated with `useSortable` from `@dnd-kit`
- Separates Framer Motion container from dnd-kit transform node to prevent animation conflicts
- Includes `AddBlockMenu` between blocks for insertion

#### `AddBlockMenu.js` — Block Insertion Popover
- Positional block insertion popover placed between canvas blocks
- 2-column grid of all block types with icons and hints
- Dismisses on Escape key or pointer down outside

#### `BlockToolbar.js` — Per-Block Header
- Drag handle, type label, position indicator, settings toggle, duplicate button, delete button
- Connects dnd-kit drag handle attributes/listeners to dedicated drag button element (`⠿`)

#### `BlockSettingsPanel.js` — Block Configuration
- Renders as bottom sheet on mobile, sticky right column on desktop
- Mounts per-type settings form from `SETTINGS_PANELS`
- Handles Escape key to close
- Includes duplicate and delete actions

#### `InlineEditable.js` — Canvas Text Editing
- Auto-growing plain-text `<textarea>` element
- Adjusts height dynamically on `useLayoutEffect` to fit content
- Intercepts Enter key on `singleLine` fields
- Preserves browser native text undo stack

#### `PreviewPane.js` — Live Article Preview
- Real-time preview passing blocks directly to `<BlockRenderer>` with `resolveImageUrl`

#### `SaveStatus.js` — Autosave Indicator
- Accessible live status readout (`aria-live="polite"`, `role="status"`)
- Maps save status enum to formatted timestamps and status dots

#### Individual Block Editors (`editor/blocks/`)

Each of the 10 block types has its own inline editing component:

| Block | Component | Editing Features |
|---|---|---|
Each block type has both a **body component** (`BlockBody.js` renders all) and a **settings panel** (`settings/` directory):

| Block | Body Renderer | Settings Panel | Editing Features |
|---|---|---|---|
| Heading | `HeadingBody` | `HeadingSettings.js` | Level select H2-H4, inline text |
| Paragraph | `ParagraphBody` | `ParagraphSettings.js` | `InlineEditable` text, lead paragraph toggle |
| Image | `ImageBody` | `ImageSettings.js` | Alt text, URL, caption, logo overlay toggle + position |
| List | `ListBody` | `ListSettings.js` | Style (bullet/numbered), item count control |
| Quote | `QuoteBody` | `QuoteSettings.js` | Quote text + attribution string input |
| Table | `TableBody` | `TableSettings.js` | Caption, row/column `CountControl`, grid normalisation |
| FAQ Accordion | `FaqBody` | `FaqSettings.js` | Question/answer pairs, count control |
| CTA Button | `CtaBody` | `CtaSettings.js` | Button label, URL, link warnings |
| Embed | `EmbedBody` | `EmbedSettings.js` | Iframe URL, frame title, HTTPS warnings |
| Key Takeaway | `KeyTakeawayBody` | `KeyTakeawaySettings.js` | Box title, takeaway count control |

**Shared utilities** (`editor/settings/shared.js`): `CountControl` (+/− buttons) and `SettingsNote`.
**Block model** (`editor/blockModel.js`): `createBlock`, `duplicateBlock`, `withBlockIds`, `blockTypeLabel`, `blockTypeIcon`, `plainTextOf`, `isRichText`, `setBlockText`.

### 5.7 BlockRenderer (Shared Component)

**`frontend/src/components/BlockRenderer.js`**

**Used by BOTH:**
1. The editor preview (in `BlockEditor`)
2. The blog view page (`BlogViewPage`)

This is critical — the spec requires the preview and the published page to use the **same component**, and they do. There is no second frontend implementation.

**Renders `content_blocks` JSON to React elements.** Must match the backend's `blocksToHtml.js` output exactly.

**Cross-renderer parity is enforced mechanically:**
- `shared/block-fixtures.json` is generated from the backend renderer
- `frontend/src/components/__tests__/blockRenderer.parity.test.js` asserts DOM match
- Comparison normalises both sides through `innerHTML` round-trip (handles `<img … />` vs `<img …>` HTML5 void-element serialisation difference)
- **This test caught two real divergences** during the build

### 5.8 Dashboard & Charts

Located in `frontend/src/components/charts/`. All use **Recharts** library.

| Chart | Component | Type | Notes |
|---|---|---|---|
| Published Over Time | `PublishedOverTimeChart.js` | Area | Monthly volume, zero values on baseline |
| Monthly Average | `MonthlyAverageChart.js` | Line | Word count & SEO score trends, `connectNulls=false` for gaps |
| Score Distribution | `ScoreDistributionChart.js` | Histogram | 5 SEO score bands, preserves bucket order |
| Status Breakdown | `StatusDonutChart.js` | Donut | Keyed color scale for color stability |
| Top Keywords/Categories | `RankedBarChart.js` | Horizontal Bar | Dynamic height based on row count |
| SERP Ranking | `SerpRankChart.js` | Scatter | Reversed X-axis (position 1 = best = far right) |

**Chart infrastructure:**
- `ChartFrame.js` — Accessible `<figure>` wrapper with title, summary, `<ResponsiveContainer>`, and toggleable data table fallback view
- `ChartTooltip.js` — Custom dark-themed tooltip, renders null values as "No data"
- `chartTheme.js` — Color scales (`buildColorScale`), axis/grid properties, number/date formatters

**Data handling:**
- `null` values are rendered as gaps (not 0) — plotting 0 asserts something false
- Time series are gap-filled (months with no posts show `count: 0` so x-axis doesn't compress)
- SERP ranking data conditionally shown based on `meta.features.serp_api`
- Chart colours validated for accessibility (see §16 for details)

### 5.9 UI Primitives

Located in `frontend/src/components/ui/`:

| Component | Purpose |
|---|---|
| `Badge.js` | Status/category badges |
| `Button.js` | Styled button with variants |
| `Card.js` | Card container |
| `Dialog.js` | Modal dialog |
| `Input.js` | Text input with label/error states |
| `Select.js` | Dropdown select |
| `Spinner.js` | Loading spinner |
| `Textarea.js` | Multi-line text input |
| `Toast.js` | Toast notifications |

### 5.10 Custom Hooks

| Hook | File | Purpose |
|---|---|---|
| `useAutosave` | `hooks/useAutosave.js` | Debounced auto-save with single-flight execution. Options: `{ value, save, delay=1500, enabled, warnBeforeUnload, saveOnUnmount }`. Exposes `status`, `savedAt`, `error`, `sync`, `saveNow`, `flush`. Queues rerun if mutated while request in flight. Listens to `beforeunload` for unsaved changes warning. |
| `useBlockHistory` | `hooks/useBlockHistory.js` | Undo/redo stack management (bounded to 50 steps). Uses `useReducer`. Coalesces consecutive keystroke edits matching `mergeKey` (`"<blockId>:field"`). Pushes structural changes as new states. Clears future on fresh edits. |
| `useWizardDraft` | `hooks/useWizardDraft.js` | Debounced API draft writer for the wizard. Defers `blogsApi.create` until `blog_title` is provided. Drains accumulated `pendingRef` patch loop to prevent race conditions. Retries failed writes on subsequent edits. |
| `useDebouncedValue` | `hooks/useDebouncedValue.js` | Generic debounce — returns debounced value after specified delay. |
| `useDebouncedCallback` | `hooks/useDebouncedValue.js` | Debounced callback with `flush`/`cancel` methods. Holds callbacks in `useRef` to prevent timer resets on re-render. |
| `useInterval` | `hooks/useDebouncedValue.js` | Safe recurring interval timer. Cancels on unmount. |

### 5.11 Utility Libraries

| File | Purpose |
|---|---|
| `lib/api.js` | Axios instance + typed API functions + token refresh interceptor |
| `lib/constants.js` | Frontend mirror of backend constants (BLOG_STATUS, GENERATION_STATUS, ARTICLE_TYPES, READABILITY_LEVELS, POV options, DEFAULT_SEO_STRUCTURE, chart color palettes: `SERIES_COLORS`, `STATUS_COLORS`, `CHART_CHROME`, plus `humanizeEnum` helper) |
| `lib/sanitizeInline.js` | Browser-side sanitizer using inert DOM `<template>`. Recursively scrubs non-allowed tags (`ALLOWED_TAGS`), removes unsafe attributes/schemes (`javascript:`, control chars), adds `rel="noopener noreferrer"` and `target="_blank"` on external links. Also exports `escapeHtml()` and `safeUrl()`. |
| `lib/media.js` | `resolveImageUrl(pathOrUrl)` — passes absolute `http(s)://` URLs through; prefixes relative upload paths with `REACT_APP_UPLOADS_PREFIX` (`/scriptura/uploads`) and `REACT_APP_API_URL` |

### 5.12 Styling System (Tailwind CSS)

**`frontend/tailwind.config.js`:**

- **Dark mode:** `class` strategy
- **Custom colour scheme:** `void`, `panel`, `ink`, `accent`, `series`, `sequential`, `status`
- Hairline borders, custom radial background gradients (`cosmic-wash`, `glow-accent`)
- Custom box shadows and animations (`fade-in-up`, `pulse-glow`, `float`, `shimmer`, `spin-slow`)
- Extra breakpoint: `xs: '375px'`
- `series-1` through `series-8`: Chart colours (**validated** for accessibility — see §16)
- `status.*`: Draft (gray), Published (green), Scheduled (amber), Archived (slate)

**Chart colour validation rules:**
- Validated against actual panel surface `#141221`
- Lightness band, chroma floor, adjacent-pair colour-vision-deficiency separation (worst 8.4 ΔE)
- Normal-vision separation (worst 19.3 ΔE) and ≥3:1 contrast
- Slots assigned in fixed order, never cycle, never a 9th hue
- `status.*` colours are reserved — never double as series colours
- `constants.parity.test.js` pins the count, disjointness, and surface

---

## 6. Data Model Deep Dive

### The Denormalisation Decision

Brand voice, image configuration, generation configuration and SEO settings all live **on the blog row**, not in separate tables. This is deliberate:

**Benefits:**
- One blog = one row. No joins anywhere in the read path.
- The wizard's entire submission is auditable in place (`generation_config` is a full snapshot)
- Entire feature set ships without touching the relational shape other systems depend on

**Costs:**
- Brand voices cannot be reused across blogs without copying
- Multiple images live in a JSON array (`extra_images`), not queryable/sortable
- Generation history not retained — `generation_config` holds only the latest run

**When to normalise:** Split when the team wants to define brand voices centrally, query "which articles used voice X?", retain generation history, or give images independent lifecycle.

### `blog_status` Semantics

| Value | Meaning | Source |
|---|---|---|
| 0 | draft | App convention (safe default) |
| 1 | published | **Confirmed from live production data** (row 813) |
| 2 | scheduled | App convention |
| 3 | archived | App convention |

Defined once in `backend/src/constants/index.js`. Nothing else hard-codes them.

### Content Block Schema

Each block in the `content_blocks` JSON array:
```json
{
  "id": "uuid",
  "type": "heading|paragraph|image|list|quote|code|table|divider|faq|callout",
  "data": { /* type-specific data */ }
}
```

**Type-specific data:**
- **heading:** `{ text, level: 2|3|4, html? }` (level clamped to 2-4)
- **paragraph:** `{ text, html?, is_lead? }` (may contain inline HTML: `<strong>`, `<em>`, `<a>`)
- **image:** `{ src, alt, caption, alignment, width?, height? }`
- **list:** `{ style: 'ordered'|'unordered', items: ['...'] }`
- **quote:** `{ text, attribution? }`
- **table:** `{ has_header: bool, caption?, rows: [['cell', ...], ...] }`
- **faq_accordion:** `{ items: [{ question, answer }, ...] }`
- **cta_button:** `{ label, url }`
- **embed:** `{ url, title? }`
- **key_takeaway:** `{ title, items: ['...'] }`

---

## 7. API Reference Summary

**Base URL:** `/api/v1`
**Interactive docs:** `/api-docs` (non-production)
**Raw spec:** `/openapi.json` (all environments)

### Error Envelope (Every Error)
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": { "fieldErrors": { "body.blog_title": ["blog_title is required."] } }
  }
}
```
Branch on `code`, never on `message`. Field errors keyed `part.field` (`body.`, `query.`, `params.`).

### Status Codes

| Code | Meaning |
|---|---|
| 400 | Malformed JSON, oversized body, bad upload |
| 401 | Missing/expired/invalid token, or bad credentials |
| 403 | Wrong role, or deactivated account |
| 404 | No such resource |
| 409 | Duplicate slug, or generation in progress |
| 413 | Upload too large |
| 422 | Validation failed, or business rule refused |
| 429 | Rate limited (`details.retryAfterSeconds`) |
| 502 | AI or SERP provider failed/timed out |
| 503 | Feature disabled, or DB unavailable |

### Complete Endpoint List

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/auth/login` | Public | Sign in |
| `POST` | `/auth/refresh` | Public | Rotate tokens |
| `POST` | `/auth/logout` | Required | Revoke refresh tokens |
| `GET` | `/auth/me` | Required | Current user |
| `GET` | `/blogs` | Required | Paginated list |
| `POST` | `/blogs` | Required | Create draft |
| `GET` | `/blogs/linkable` | Required | Published blogs for link picker |
| `GET` | `/blogs/:id` | Required | Full blog record |
| `PATCH` | `/blogs/:id` | Required | Partial update |
| `DELETE` | `/blogs/:id` | Required | Soft delete |
| `POST` | `/blogs/:id/publish` | Required | Publish/schedule |
| `POST` | `/blogs/:id/restore` | Admin | Restore deleted |
| `GET` | `/blogs/:id/generation-status` | Required | Poll generation |
| `POST` | `/generate/title` | Required | AI title suggestions |
| `POST` | `/generate/outline` | Required | AI outline |
| `POST` | `/generate/article` | Required | Async article generation |
| `GET` | `/generate/status/:blogId` | Required | Poll generation |
| `POST` | `/generate/auto-topic` | Required | AI trending topic |
| `POST` | `/generate/reap-stale` | Admin | Recover stuck generations |
| `POST` | `/brand-voice/analyze` | Required | Analyze voice (text/URL/file) |
| `POST` | `/media/upload` | Required | Upload image |
| `POST` | `/media/generate-image` | Required | AI image generation |
| `POST` | `/media/composite-logo` | Required | Logo overlay |
| `POST` | `/serp/check-rank` | Required | Google rank check |
| `POST` | `/serp/ground-facts` | Required | Web grounding |
| `GET` | `/analytics/overview` | Required | Dashboard data |
| `GET` | `/analytics/in-flight` | Required | Live generation progress |
| `GET` | `/settings/topics` | Required | List automated topics |
| `POST` | `/settings/topics` | Required | Add topic |
| `DELETE` | `/settings/topics/:id` | Required | Remove topic |
| `GET` | `/settings/topics/suggest` | Required | AI topic suggestions |
| `GET` | `/keywords` | Required | List keyword pool |
| `POST` | `/keywords` | Required | Add keyword |
| `PUT` | `/keywords/:id` | Required | Update keyword |
| `DELETE` | `/keywords/:id` | Required | Remove keyword |
| `POST` | `/keywords/bulk-import` | Required | Bulk import keywords |
| `GET` | `/keywords/suggest` | Required | AI keyword suggestions |
| `GET` | `/meta` | Public | Capabilities + feature flags |
| `GET` | `/health` | Public | Load balancer health check |

---

## 8. Authentication & Authorization Flow

### Token Architecture
- **Two JWT secrets, two token types**
  - Access token: 15-minute TTL, verified with `JWT_ACCESS_SECRET`
  - Refresh token: 7-day TTL, verified with `JWT_REFRESH_SECRET`
- A refresh token cannot be used as an access token: different secrets **AND** an explicit `type` claim
- Config refuses to boot if the two secrets are equal

### Login Flow
1. Client sends `POST /auth/login` with `{email, password}`
2. Server finds user by email, compares password with bcrypt
3. **Anti-enumeration:** Returns identical response for wrong password AND unknown email, burns comparable bcrypt time on missing-account path
4. Returns `{ access_token, refresh_token, user }` on success
5. Client stores tokens in localStorage and `AuthContext` state

### Token Refresh Flow
1. On `401 TOKEN_EXPIRED`, Axios interceptor calls `POST /auth/refresh` with refresh token
2. Server validates: correct secret, `type: 'refresh'`, `token_version` matches DB
3. Increments `token_version` → **rotating tokens** (captured token useful only until next legitimate use)
4. Returns new token pair
5. Interceptor retries the original failed request
6. Concurrent requests during refresh are queued (only one refresh call at a time)

### Logout Flow
1. Client calls `POST /auth/logout`
2. Server increments `token_version` → instantly invalidates ALL outstanding refresh tokens
3. Access tokens remain valid until TTL (up to 15 min) — bounded, understood trade-off
4. Client clears localStorage and state

### Authorization
- User loaded from DB on **every authenticated request** (not cached from JWT) → enables immediate account deactivation
- Two roles: `admin` and `editor`
- `requireRole('admin')` middleware for admin-only endpoints (e.g., restore deleted blogs)
- No registration endpoint — accounts provisioned out-of-band

---

## 9. The Content Invariant

**The single most important invariant in the codebase:**

```
content_blocks (JSON)  ──derived──►  blog_content (HTML)
   editable                            read-only, for external consumers
```

### How It Works
- `content_blocks` is the source of truth — what the editor mutates, what the app renders
- `blog_content` is derived HTML — exists because the existing Divinetalk site and crawlers read it
- A `beforeSave` model hook regenerates `blog_content`, `word_count`, and `seo_score` from `content_blocks` on every save where blocks changed

### Why a Hook (Not a Service Call)
A hook **cannot be forgotten**. Every write path — controller, generation worker, future admin script, direct `Sequelize.update()` with `individualHooks` — goes through it.

### Two Renderers, One Guarantee
- **Backend:** `blocksToHtml.js` — canonical; writes `blog_content`
- **Frontend:** `BlockRenderer.js` — used by BOTH editor preview AND blog page

**Parity enforcement:**
1. `backend/scripts/generate-block-fixtures.js` renders blocks through the backend renderer
2. Output saved to `shared/block-fixtures.json`
3. Both suites assert against these fixtures:
   - `backend/tests/unit/blocksToHtml.test.js` — exact string match
   - `frontend/src/components/__tests__/blockRenderer.parity.test.js` — DOM match (normalised through `innerHTML` round-trip)

**If you change markup in one renderer, you must change it in the other and regenerate fixtures.**

---

## 10. Third-Party APIs & External Services

### Anthropic Claude API (Text Generation)
- **SDK:** `@anthropic-ai/sdk ^0.52.0`
- **Model:** `claude-sonnet-5` (configurable via `ANTHROPIC_MODEL`)
- **Used for:** Title generation, outline generation, full article generation, brand voice analysis
- **Env:** `ANTHROPIC_API_KEY`
- **Fallback:** `MockTextProvider` with deterministic, realistic outputs
- **Provider file:** `backend/src/services/ai/anthropicProvider.js`

### OpenAI API (Text + Image Generation)
- **SDK:** `openai ^4.77.0`
- **Text model:** `gpt-4o-mini` (configurable via `OPENAI_TEXT_MODEL`)
- **Image model:** `gpt-image-1` (configurable via `OPENAI_IMAGE_MODEL`)
- **Used for:** AI featured image generation, optionally text generation
- **Env:** `OPENAI_API_KEY`
- **Fallback:** `MockProvider` generates deterministic placeholder images locally using `sharp`
- **Provider file:** `backend/src/services/ai/OpenAIProvider.js`

### SerpAPI (Web Search / SERP Ranking)
- **Feature-flagged:** Requires BOTH `SERPAPI_ENABLED=true` AND `SERPAPI_KEY`
- **Used for:**
  - `POST /serp/ground-facts` — Web grounding for article generation (fetches factual context from web search results)
  - `POST /serp/check-rank` — Check Google ranking position for a keyword
- **Fallback:** Feature entirely hidden when disabled; endpoints return `503 FEATURE_DISABLED`
- All SERP-dependent UI controls hidden (not shown-and-broken)

### MySQL 8
- **Production database**
- **Driver:** `mysql2 ^3.14.1`
- **ORM:** `sequelize ^6.37.7`
- **Docker image:** `mysql:8.0`

### No Other External Services
- No Redis (generation is in-process)
- No message queue (no BullMQ yet)
- No CDN (unless S3 is configured)
- No email service
- No analytics/tracking services

---

## 11. Environment Variables (Complete List)

### Server
| Variable | Default | Required | Notes |
|---|---|---|---|
| `PORT` | `5000` | No | Backend server port |
| `NODE_ENV` | `development` | No | `development`, `production`, `test` |
| `CORS_ORIGIN` | `http://localhost:3000` | Production | Comma-separate for multiple origins |
| `TRUST_PROXY` | `false` | No | Set if behind nginx/ALB (for rate limiting) |

### Database
| Variable | Default | Required | Notes |
|---|---|---|---|
| `DB_HOST` | `localhost` | Production | |
| `DB_PORT` | `3306` | No | |
| `DB_NAME` | `scriptura` | Production | |
| `DB_USER` | `root` | Production | |
| `DB_PASSWORD` | (empty) | Production | |
| `DB_LOGGING` | `false` | No | SQL query logging |

### JWT
| Variable | Default | Required | Notes |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | (none) | Production | ≥32 chars, must differ from refresh secret |
| `JWT_REFRESH_SECRET` | (none) | Production | ≥32 chars, must differ from access secret |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | No | Access token TTL |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | No | Refresh token TTL |

### AI Providers
| Variable | Default | Required | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | (none) | No | Falls back to mock provider without it |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | No | Claude model identifier |
| `OPENAI_API_KEY` | (none) | No | Falls back to mock provider without it |
| `OPENAI_TEXT_MODEL` | `gpt-4o-mini` | No | OpenAI text model |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1` | No | OpenAI image model |
| `BLOG_GENERATION_SECRET` | (none) | No | Secret for automated generation |

### SerpAPI
| Variable | Default | Required | Notes |
|---|---|---|---|
| `SERPAPI_ENABLED` | `false` | No | Feature flag |
| `SERPAPI_KEY` | (none) | No | Both flag AND key required |

### Storage
| Variable | Default | Required | Notes |
|---|---|---|---|
| `STORAGE_DRIVER` | `local` | No | `local` or `s3` |
| `UPLOADS_DIR` | `./uploads` | No | Local uploads directory |
| `UPLOAD_MAX_SIZE` | `10485760` | No | 10MB in bytes (configurable) |
| `S3_BUCKET` | (none) | If S3 | |
| `S3_REGION` | (none) | If S3 | |
| `S3_ACCESS_KEY` | (none) | If S3 | |
| `S3_SECRET_KEY` | (none) | If S3 | |
| `S3_PUBLIC_BASE_URL` | (none) | If S3 | CDN/bucket URL |

### App
| Variable | Default | Required | Notes |
|---|---|---|---|
| `LOGO_PATH` | `src/assets/logo.png` | No | Path to logo for overlay |

---

## 12. Docker & Deployment

### Development (`docker-compose.yml`)
- **3 services:** `mysql` (MySQL 8.0, container: `scriptura-mysql`), `api` (Node + Express, container: `scriptura-api`), `web` (React CRA, container: `scriptura-web`)
- MySQL configured with `utf8mb4` charset, `utf8mb4_unicode_ci` collation, `innodb-default-row-format=dynamic`
- MySQL health check via `mysqladmin ping` every 5s; backend waits for healthy DB
- Backend volume-mounts `uploads-data` volume for persistent uploads
- Environment passes `SEED_ON_START=true` for auto-seeding
- Backend health check: `http://localhost:5000/health`
- Frontend gets `REACT_APP_API_URL` build arg
- Named volumes: `mysql-data`, `uploads-data`
- Network: `scriptura` (bridge)
- Run: `docker compose up --build`

### Production (`docker-compose.prod.yml`)
- MySQL uses `MYSQL_RANDOM_ROOT_PASSWORD=true`
- Backend: no source volume mounts, `NODE_ENV=production`, no nodemon
- Frontend: multi-stage build → Nginx serves built React app on port 80/443
- `docker-entrypoint.sh`: Waits for DB → runs migrations → optionally seeds → starts server

### Frontend Nginx Config (`frontend/nginx.conf`)
- Static files from `/usr/share/nginx/html`
- `/api/`, `/scriptura/api/` → proxy to `http://api:5000/`
- `/uploads/`, `/scriptura/uploads/` → proxy to `http://api:5000/`
- SPA fallback: `try_files $uri $uri/ /index.html`
- 1-year immutable caching for hashed static assets, no-cache for `index.html`
- Security headers: `X-Robots-Tag`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`
- 12MB body size limit
- Gzip compression enabled

### Deployment Checklist
1. Set `NODE_ENV=production` — requires real JWT secrets and DB credentials
2. Set `TRUST_PROXY` if behind nginx/ALB (otherwise rate limiting keys to proxy address)
3. Lock `CORS_ORIGIN` to real web origin
4. Run `npm run migrate`
5. Swagger UI auto-disabled in production; `/openapi.json` remains
6. For existing production table: follow the adoption runbook (§14)

---

## 13. Testing Strategy

### Backend Tests (In-Memory SQLite)

**IMPORTANT NOTE:** All backend test files in `backend/tests/unit/` and `backend/tests/integration/` are currently **placeholder stubs** (single-line comment files, 35-48 bytes each). The test infrastructure is in place (`tests/setup.js`, Jest config, SQLite test database), but the actual test implementations have not been written yet.

**Planned test structure:**
- Setup: `tests/setup.js` sets `NODE_ENV=test` → triggers SQLite in `models/index.js`
- Framework: Jest 29 + Supertest 7
- Configuration: Serial execution (`--runInBand`) against in-memory SQLite
- Test timeout: 20000ms

**Test files present (all currently stubs):**
- `unit/migration-parity.test.js`
- `unit/config.test.js`
- `unit/blocksToHtml.test.js`
- `unit/seoScore.test.js`
- `unit/aiProviders.test.js`
- `unit/authMiddleware.test.js`
- `unit/brandVoice-parser.test.js`
- `unit/generationConfig.test.js`
- `unit/logoComposite.test.js`
- `unit/serp.test.js`
- `unit/storage.test.js`
- `integration/auth.test.js`
- `integration/blogs.test.js`
- `integration/generation.test.js`
- `integration/analytics.test.js`
- `integration/brandVoice.test.js`
- `integration/media.test.js`
- `integration/serp.test.js`
- `helpers/db.js`
- `helpers/factories.js`

### Frontend Tests
- Framework: React Testing Library + Jest (via CRA)
- **163 passing tests across 10 suites** (constants parity, API envelope, blockRenderer parity, titleScore, wizard, editor, blockHistory, blockSettings, dashboard, blogList)
- Zero `act()` warnings (pinned `@testing-library/dom` version)
- **`blockRenderer.parity.test.js`:** Asserts React renderer produces same DOM as backend HTML renderer, from shared fixtures. Normalises through `innerHTML` round-trip.

### End-to-End Tests (`e2e/`)

**NOTE:** E2E test files are also currently **placeholder stubs** (single-line comment files).

**Planned E2E structure:**
- Framework: Playwright
- Uses dedicated E2E test harness server (`backend/scripts/e2e-server.js`) — planned to run on port 5055 with in-memory SQLite and deterministic mock AI providers
- Test scenarios planned: full-flow (sign in → wizard → editor → publish), responsive layout tests

**Test files present (all currently stubs):**
- `tests/full-flow.spec.js`
- `tests/responsive.spec.js`

### Dual-Dialect Limitations
**What SQLite tests DO NOT verify:**
- MySQL-specific DDL (column widths, charset, ENGINE)
- Collation-dependent behaviour (MySQL is case-insensitive by default)
- JSON path operators (`->>`)
- Concurrency (SQLite is single-writer)
- `utf8mb4` storage

**Known bug caused by this:** LIKE escape characters work differently between MySQL and SQLite. Fixed by stripping `%` and `_` instead of escaping them.

### Shared Block Fixtures

`shared/block-fixtures.json` is generated by `backend/scripts/generate-block-fixtures.js`. Contains **8 test cases:** `all_block_types`, `empty_and_unknown_blocks_are_omitted`, `xss_payloads_are_neutralised`, `heading_levels_are_clamped`, `malformed_data_degrades_gracefully`, `multiline_text_becomes_line_breaks`, `unicode_content_round_trips`, `empty_block_list`.

### Total Test Count

**Current status:**
- Backend: **0 implemented tests** (infrastructure in place, test files are stubs)
- Frontend: 163 tests (10 suites) — **IMPLEMENTED**
- E2E: **0 implemented tests** (infrastructure in place, test files are stubs)

**Total implemented tests: 163** (frontend only)

---

## 14. Production Adoption (Existing Table Migration)

The dev migration creates a standalone `blogs` table. For production (where `blogs` already exists), use the adoption scripts.

### Runbook
1. **Back up** the production table
2. **Rehearse** on a restored copy
3. **Check table size** and pick a maintenance window
4. **Apply:** `mysql < backend/scripts/prod-adoption/001-add-ai-columns.sql` — idempotent, each column guarded by `information_schema` check, reports ADDED/EXISTS
5. **Point app at production DB** and smoke-test
6. **Backfill slugs** (last, because it writes to existing rows):
   ```bash
   node scripts/prod-adoption/backfill-slugs.js --dry-run
   node scripts/prod-adoption/backfill-slugs.js --commit
   ```

### Rollback
`002-rollback-ai-columns.sql` drops only what `001` added. Original columns untouched.

### Unresolved: Existing Rows Without content_blocks
Two options (neither implemented — needs team decision):
1. **HTML → blocks importer** — lossy, author will notice
2. **Legacy read-only mode** — render `blog_content` directly, require explicit "convert to blocks" action (recommended)

---

## 15. Known Limitations & Upgrade Paths

| Limitation | Impact | Upgrade Path |
|---|---|---|
| Generation runs in-process, not on a queue | Doesn't scale horizontally; restart mid-generation leaves stuck rows | BullMQ + Redis |
| Rate limiting is in-memory | Per-instance only | Redis-backed rate limiter |
| Tokens in localStorage | XSS would expose them | httpOnly refresh cookie (CORS already configured) |
| Brand voices can't be reused across blogs | Must copy for each blog | Normalise to `brand_voices` table with FK |
| Analytics aggregates in JS, not SQL | Fine to low thousands of rows | Dialect-specific SQL or materialised summary table past ~100k rows |
| S3 storage is a stub | toPublicUrl works, I/O throws 501 | Add `@aws-sdk/client-s3`, implement 4 methods |
| Existing production rows have no content_blocks | Empty editor canvas | HTML→blocks importer or legacy read-only mode |
| No registration endpoint | Accounts provisioned out-of-band | Add admin user management UI |
| `published_by` is free text, not FK | Can't join blogs↔users | Would change meaning for other systems |

---

## 16. Key Design Decisions & Trade-offs

### 1. Single Table (56 Columns)
Everything on the blog row. No joins. Auditable in place. Cost: no brand voice reuse, no generation history.

### 2. content_blocks as Source of Truth
HTML is derived, never directly written. Hook-enforced, not service-enforced — cannot be forgotten.

### 3. Dual-Dialect Testing (MySQL + SQLite)
`npm test` is green on a fresh clone with no DB server. Real limits documented and tested.

### 4. Graceful Degradation (No API Keys = Mock Providers)
App is fully usable without any API keys. Boot prints every degradation. UI shows notices.

### 5. SSRF, XSS, Path Traversal — Defended
User-supplied URLs, AI-generated content, file uploads — all treated as untrusted. Multiple layers.

### 6. Generation Never Publishes
Always lands in editor for human review. Publishing is separate, explicit, and validated.

### 7. Brand Voice Confirmation Gate
Server-side enforcement. UI-only gate would be a suggestion; this is a rule.

### 8. Environment Centralisation
Only `config/index.js` reads `process.env`. Enforced by automated test.

### 9. SerpAPI Double-Flag
Both `SERPAPI_ENABLED=true` AND `SERPAPI_KEY` required. Half-configured = disabled. UI controls hidden, not broken.

### 10. Chart Colour Accessibility
Palette validated for colour-vision-deficiency separation, contrast ratios, and lightness bands against the actual rendered surface.

### 11. htmlparser2 Pin to v9
v12+ is pure ESM, breaks Jest. Pin documented in package.json with reasoning.

### 12. No blogs↔users Association
`published_by` is free-text by design — other Divinetalk systems already read it.

---

## Seeded Development Accounts

| Email | Role | Password |
|---|---|---|
| `shivamkumar@divinetalk.in` | admin | `123456` |
| `harsh@divinetalk.com` | admin | `Scriptura@Dev2026` |
| `ananya@divinetalk.com` | editor | `Scriptura@Dev2026` |
| `rohit@divinetalk.com` | editor | `Scriptura@Dev2026` |

**Seeded demo content:** ~10 realistic astrology/spiritual blog entries covering all blog and generation statuses, with `blog_content` generated programmatically from `content_blocks` by the real renderer.

**Seeded automated topics:** 15 initial astrology/horoscope topics in `automated_topics` table.

The seeder refuses to run when `NODE_ENV=production`.

---

## Quick Commands Reference

### Backend (`cd backend`)
| Command | Purpose |
|---|---|
| `npm run dev` | Start with auto-reload (nodemon) |
| `npm start` | Start production |
| `npm run migrate` | Apply migrations |
| `npm run migrate:undo` | Roll back last migration |
| `npm run seed` | Seed demo data |
| `npm run db:reset` | Drop → migrate → seed |
| `npm test` | Full test suite (no DB needed) |
| `npm run test:coverage` | Tests with coverage |
| `npm run lint` | ESLint |

### Frontend (`cd frontend`)
| Command | Purpose |
|---|---|
| `npm start` | Dev server on :3000 |
| `npm run build` | Production bundle |
| `npm test` | Full test suite |
| `npm run test:watch` | Watch mode |

### Docker
| Command | Purpose |
|---|---|
| `docker compose up --build` | Start everything |
| `docker compose down -v` | Stop and remove volumes |

---

---

> **End of context file.** This document covers every module, service, logic flow, data model, API endpoint, third-party integration, environment variable, security layer, testing strategy, and architectural decision in the Scriptura project. Give it to any AI tool to provide full project understanding.

## 17. Upcoming Changes & Roadmap

This section documents planned features and architectural changes for the next phase of Scriptura development. These are **not yet implemented** — this is the agreed design direction.

---

### 17.1 Autopilot — Keyword Cluster Scheduling Engine

**Current behaviour (what exists today):**
Autopilot picks one keyword from the pool → writes one blog → done. No scheduling, no cluster awareness, no frequency control.

**Problem with current approach:**
One blog per keyword misses the entire competitive SEO opportunity. For a keyword like "Guru Purnima 2026" there are 7–10 high-value secondary/sub-topic keywords each deserving their own article, scheduled at optimal pre-event dates. Currently all of that is thrown away.

**What we are building:**

#### Keyword Cluster Model

When a primary keyword is added or selected, the system should recognise it as the head of a **cluster** — a group of semantically related sub-keywords that collectively dominate a topic's search surface.

Example cluster for **"Guru Purnima 2026":**

| Sub-keyword | Search Intent | Ideal Publish Date |
|---|---|---|
| Guru Purnima 2026 | Informational | 30 days before event |
| Ashadha Purnima 2026 | Informational | 25 days before |
| Vyasa Purnima 2026 | Informational | 25 days before |
| Guru Puja Muhurat | Transactional | 20 days before |
| Guru Purnima Significance | Informational | 15 days before |
| Guru Purnima Rituals | Informational | 15 days before |
| Guru Purnima Puja Vidhi | Transactional | 10 days before |
| Guru Purnima Wishes | Navigational | 5 days before |
| Guru Purnima Celebration | Informational | 3 days before |

This is the cluster-scheduling pattern used by high-output content teams at scale.

#### Planned UI Changes

**KeywordsPage — Cluster Builder:**
- When a keyword is added, a "Expand Cluster" button appears
- Clicking it calls Claude → generates related sub-keywords with suggested search intent and recommended publish timing
- Each sub-keyword rendered as a **checkbox row** — user can select which ones to include
- Selected sub-keywords saved as `secondary_keywords[]` on the parent `ScripturaKeyword` row, OR as individual keyword rows linked to the parent via a `parent_keyword_id` FK

**Autopilot Scheduling Panel:**
- Instead of "Start Generating" (one shot), Autopilot gets a **Schedule Queue** view
- User sees all selected cluster keywords laid out on a timeline
- For each: set publish date + time, or let the system suggest based on event proximity
- "Schedule All" → creates all blog drafts immediately, each with `blog_status: SCHEDULED` and the correct `publish_date`
- Generation runs per blog at scheduled time (or immediately if date is in the past)

#### Planned Frequency Controls

User should be able to configure Autopilot output frequency at three levels:

| Level | Setting | Example |
|---|---|---|
| **Topic-level** | How many blogs per topic cluster | "Guru Purnima" → 9 blogs |
| **Keyword-level** | Publish cadence for a keyword type | Transactional keywords → 2 weeks before event |
| **Global** | Max blogs per day/week | Never publish more than 3/day |

These frequency rules prevent keyword cannibalisation (two articles competing for the same query on the same day) and ensure a steady publishing cadence Google's crawlers expect from authoritative sites.

---

### 17.2 SEO, AEO, and GEO — Three-Layer Optimisation Strategy

**Why this matters:** Search has changed more in the last year than in the previous decade. Most tools (including Scriptura v1) treat all content optimisation as SEO. It isn't. DivineTalk needs to rank in three distinct surfaces.

#### SEO — Search Engine Optimisation *(already partially implemented)*

**What it is:** Ranking on Google's blue links.

**How it works:**
- High-intent keyword clusters mapped to individual service/blog pages
- Authoritative backlinks + on-page content optimisation

**Current Scriptura support:** SEO score (0–100), keyword density, heading structure, internal linking, meta description — all calculated in `seoScore.js`.

**What needs adding:**
- Keyword cluster coverage score (are we covering the full cluster or just the head term?)
- Keyword cannibalisation detection (alert when two blogs target same primary keyword)
- Quarterly content refresh reminders based on `publish_date` age
- Technical audit flags: missing meta description, title too long/short, no internal links

#### AEO — Answer Engine Optimisation *(not yet implemented)*

**What it is:** Getting DivineTalk's content pulled into Google's AI Overviews, featured snippets, and "People Also Ask" boxes.

**How it works:**
- Provide direct, concise answers (40–60 words) to questions under clear headings
- Use FAQ blocks and How-To structured data (JSON-LD schema)
- Match content shape to what AI summary engines extract

**What needs adding to Scriptura:**

1. **AEO Score** — separate from SEO score. Criteria:
   - Has FAQ block with ≥3 Q&A pairs (`faq_accordion` blocks)
   - At least one answer is 40–60 words (PAA-optimised length)
   - H2/H3 headings are question-shaped ("What is...", "How to...", "Why does...")
   - Article contains a direct definition paragraph in the first 100 words
   - Meta description is a complete answer sentence (not a teaser)

2. **AEO generation toggles** in the wizard (Step 3):
   - "Optimise for Featured Snippets" → Claude writes a definition paragraph first
   - "Include PAA questions" → Claude generates FAQ items from actual People Also Ask data (via SerpAPI)
   - "How-To schema" → generation pipeline wraps applicable blocks in JSON-LD

3. **AEO block type** — a new `how_to` block type:
   ```json
   { "type": "how_to", "data": { "title": "...", "steps": [{ "name": "...", "text": "..." }] } }
   ```
   Renders as `<ol>` with schema markup in `blocksToHtml.js`

#### GEO — Generative Engine Optimisation *(not yet implemented)*

**What it is:** Getting ChatGPT, Claude, Gemini, and Perplexity to mention and recommend DivineTalk when users ask astrology questions.

**How it works:**
- AI models pull from well-cited, structured, entity-rich sources
- Presence on sources AI frequently references (Wikipedia-style pages, authoritative directories, cited research)
- E-E-A-T signals: Experience, Expertise, Authoritativeness, Trustworthiness

**What needs adding to Scriptura:**

1. **GEO Score** — third scoring dimension. Criteria:
   - Author byline present (`published_by` is a real name, not generic)
   - Article cites external authoritative sources (links to `.edu`, `.gov`, established astrology orgs)
   - Content contains entity-rich statements (named people, places, dates, scripture references)
   - Article has a "Key Takeaway" block (`key_takeaway` — already exists as block type)
   - Word count ≥ 1800 (thin content is not cited by AI)
   - Structured data present (JSON-LD `Article` schema)

2. **GEO generation directives** for Claude in `prompts.js`:
   - Include at least 2 citations to real, named classical texts (Brihat Parashara Hora Shastra etc.)
   - Write in a declarative, encyclopaedic tone for key sections (AI prefers authoritative assertions)
   - Include the author's expertise signal in the opening paragraph

3. **Entity linking** in the block editor — ability to tag entities (planet names, festivals, deities) so the rendered HTML carries `<span itemscope>` microdata

#### Combined Score Display

The wizard and editor should eventually show **three scores side by side:**

```
SEO  ████████░░  78/100
AEO  █████░░░░░  52/100
GEO  ███░░░░░░░  34/100
```

Each with a breakdown panel (like the current `SeoScoreBreakdown` component) explaining exactly which criteria are met and which are missing.

---

### 17.3 Scheduled Publishing Engine

**Current behaviour:** `blog_status: SCHEDULED` and `publish_date` exist in the data model but there is no background process that actually flips blogs live at the scheduled time. It requires manual publish action.

**What needs building:**

A lightweight scheduler that runs on a cron-like interval (every minute) inside the existing backend process:

```
Every 60 seconds:
  SELECT * FROM blogs
  WHERE blog_status = 2 (SCHEDULED)
    AND publish_date <= NOW()
    AND generation_status = 'generated'
  → SET blog_status = 1 (PUBLISHED)
  → Log each transition
```

Implementation options:
- `setInterval` inside `server.js` (simplest — fits the single-instance model)
- `node-cron` package (slightly cleaner, same process)
- BullMQ delayed job (proper upgrade path when moving to queue architecture)

This is the missing piece that makes the cluster scheduling feature actually automated end-to-end — user schedules blogs at specific dates/times, and they go live without any manual action.

---

### 17.4 Manual Wizard — Three-Score Integration

**Current behaviour:** The 6-step wizard (manual blog creation flow) only shows SEO score with breakdown. No AEO or GEO scoring exists.

**What needs adding:**

All three scores should be calculated and displayed throughout the manual wizard journey, exactly as they will be in the Autopilot flow:

**Step 1 (Topic & Title):**
- Current: Shows SEO score breakdown for title + keywords
- **Add:** Show **all three scores** side-by-side (SEO, AEO, GEO) as the user types
- Each score should have its own expandable breakdown panel (like current `SeoScoreBreakdown`)
- Live recalculation on every keystroke (debounced 500ms)

**Step 3 (Content Configuration):**
- Current: SEO structure toggles only
- **Add:** 
  - "Optimise for Featured Snippets" toggle (affects AEO score)
  - "Include PAA Questions" toggle → if enabled, wizard fetches People Also Ask data via SerpAPI and includes it in the outline
  - "Add Citations" toggle → Claude embeds real scripture/authoritative references (boosts GEO score)
  - "E-E-A-T Optimisation" toggle → adds author expertise signals in opening (GEO)

**Step 6 (Generate):**
- Current: Shows generation summary with SEO score
- **Add:** Summary panel should display **all three projected scores** based on the config choices made in previous steps
- After generation completes → show **actual computed scores** from the generated content

**Editor Page:**
- Current: SEO score shown in header, breakdown in sidebar
- **Add:** Replace single score with **three-score dashboard** (SEO / AEO / GEO), each expandable
- Real-time recalculation when content blocks change (debounced to avoid performance hit)
- Each score breakdown should guide the user: *"Missing: FAQ block with 3+ questions"* etc.

---

### 17.5 Image Generation — Consistency Across Manual & Autopilot

**Current problem:** Image generation works in manual wizard (Step 4), but Autopilot hardcodes `include_images: true, image_count: 1, image_style: 'photo', logo_overlay: false` — no flexibility, and some edge cases where images fail silently are not handled properly in either flow.

**What needs fixing:**

1. **Autopilot image configuration:**
   - Add a settings panel on AutomatedBlogPage where user can set default image preferences:
     - Image count: 1–4 (currently hardcoded to 1)
     - Image style: photo / illustration / minimal / brand_colored
     - Logo overlay: on/off + position (9-point grid)
   - **Storage decision:** Use a dedicated `scriptura_autopilot_settings` table (recommended), NOT `localStorage`
   - Applied to all Autopilot-generated blogs unless overridden

**Design Decision: Database Table vs localStorage for Autopilot Config**

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **localStorage** | Quick to implement, no migration needed, per-user per-browser | Lost on browser clear/different device; no audit trail; not team-shareable; survives logout (bad for multi-user machines) | ❌ Not recommended |
| **Column on `users_scriptura`** | One row per user; easy to query | Clutters user table with feature-specific config; hard to add more autopilot settings later | ⚠️ Acceptable for MVP |
| **`scriptura_autopilot_settings` table** | Clean separation; audit trail via timestamps; extensible (add frequency controls, scheduling defaults etc.); supports team-wide defaults + per-user overrides | Requires migration | ✅ **RECOMMENDED** |

**Recommended schema for `scriptura_autopilot_settings`:**

```sql
CREATE TABLE scriptura_autopilot_settings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,  -- NULL = org-wide default, non-null = user override
  
  -- Image defaults
  default_image_count TINYINT DEFAULT 1,
  default_image_style VARCHAR(50) DEFAULT 'photo',
  default_logo_overlay BOOLEAN DEFAULT false,
  default_logo_position VARCHAR(20) DEFAULT 'bottom_right',
  
  -- Frequency controls (future)
  max_blogs_per_day INT DEFAULT NULL,
  max_blogs_per_week INT DEFAULT NULL,
  
  -- Scheduling defaults (future)
  default_publish_time TIME DEFAULT '09:00:00',
  default_timezone VARCHAR(50) DEFAULT 'Asia/Kolkata',
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_user_settings (user_id),
  FOREIGN KEY (user_id) REFERENCES users_scriptura(id) ON DELETE CASCADE
);
```

**Lookup logic:**
1. Check if `user_id = <current user>` row exists → use it
2. Else check if `user_id IS NULL` row exists → use org-wide default
3. Else fallback to hardcoded defaults in code

This design allows:
- Individual users to override org defaults
- Admins to set team-wide defaults via Settings page
- Future extensibility without schema changes (just add columns)
- Full audit trail of who changed what when

**Migration path:** Start with column on `users_scriptura` for MVP (faster), migrate to dedicated table when adding frequency controls in 17.1.

2. **Error handling parity:**
   - Both flows should handle image generation failure gracefully:
     - If OpenAI API fails → log error, set `blog_picture: null`, continue with generation (don't abort the whole article)
     - If logo composite fails → log warning, save without logo (don't crash)
   - Currently manual wizard shows loading spinner indefinitely if image gen hangs — add timeout (30s) with retry option

3. **Image generation status visibility:**
   - Manual wizard Step 4 "Preview" shows a loading state but no progress — add: *"Generating image 1 of 3..."*
   - Autopilot "generating" stage shows *"AI is writing your article"* but doesn't mention images — add explicit status: *"Writing article and generating 1 featured image..."*

4. **Consistent logo positioning:**
   - Both flows use `logoComposite.js` but manual wizard allows 9-point grid selection (`LogoPositionGrid.js`) while Autopilot hardcodes `logo_overlay: false`
   - Make Autopilot respect the saved logo preference
   - Add a global "Default Logo Settings" page in Settings so team can set org-wide defaults (currently logo path is env-only)

5. **Validation:**
   - Both flows should validate: if `include_images: true` but no API key / mock provider → show warning in UI before starting generation, not after
   - Currently wizard allows proceeding, then image gen silently returns placeholder — user doesn't know it's not a real AI image

**Backend changes needed:**
- `imageGeneration.js`: wrap all image API calls in try-catch, return `null` on failure instead of throwing
- `generation.js` (`runGeneration`): check image provider status before starting → if mock and user expected real images, add a note to `generation_config`

**Frontend changes needed:**
- `Step4Images.js`: add timeout + retry UI
- `AutomatedBlogPage.js`: add image config panel in idle state (before "Start Generating")
- Both: show explicit "Using mock image provider" warning if no API key configured

---

### 17.6 Summary of Changes Required

| Feature | Backend Changes | Frontend Changes | Priority |
|---|---|---|---|
| Keyword cluster builder | `ScripturaKeyword`: add `parent_keyword_id`, `cluster_keywords[]`; `POST /keywords/:id/expand-cluster` | KeywordsPage: cluster expansion UI, checkbox selection | High |
| Sub-keyword scheduling | Generation service: batch job creation; blogs table already has `publish_date` | New "Schedule Queue" view in AutomatedBlogPage | High |
| Frequency controls | New `autopilot_settings` table or config JSON; validation in generation service | Settings page: frequency config panel | Medium |
| AEO score | `aeo_score` + `aeo_score_breakdown` columns; `aeoScore.js` service; `beforeSave` hook | Wizard Steps 1/3/6 + Editor: AEO score badge + breakdown | High |
| GEO score | `geo_score` + `geo_score_breakdown` columns; `geoScore.js` service; prompts.js directives | Wizard Steps 1/3/6 + Editor: GEO score badge + breakdown | Medium |
| Three-score display (wizard) | Scores computed server-side on every save | Replace `SeoScoreBreakdown` with tri-score component across all 6 wizard steps | High |
| Three-score display (editor) | Already computed on every `beforeSave` once services exist | Replace single `ScoreMeter` in editor header with tri-score dashboard | High |
| AEO/GEO wizard toggles | `generation.validators.js`: new toggle fields; `prompts.js`: new directives | Step 3: add 4 new AEO/GEO toggles | Medium |
| `how_to` block type | New type in `BLOCK_TYPES`; `blocksToHtml.js` renderer + JSON-LD output | `HowToBody` + `HowToSettings` editor components; `BlockRenderer.js` update | Medium |
| Scheduled publish engine | `publishScheduledBlogs()` in `blogService.js`; `setInterval`/`node-cron` in `server.js` | Blog list: show countdown to scheduled publish time | High |
| JSON-LD schema injection | `blocksToHtml.js`: wrap output in `Article` + `FAQPage` JSON-LD | No frontend change needed | Medium |
| Autopilot image config panel | New table `scriptura_autopilot_settings` (or column on `users_scriptura` for MVP) | AutomatedBlogPage: image settings panel in idle state; API to save/fetch user settings | High |
| Image generation error handling | `imageGeneration.js`: catch-and-null on failure; `generation.js`: don't abort on image failure | Step4Images + AutomatedBlogPage: timeout (30s), retry, explicit failure state | High |
| Image generation status visibility | `generation.js`: emit per-image progress into status field | Step 6 + AutomatedBlogPage: show *"Generating image N of M"* progress | Medium |
| Mock provider warning | `GET /meta` already exposes provider type | Wizard Step 4 + AutomatedBlogPage idle: show banner if image provider is mock | Medium |
| Global logo defaults | New settings endpoint for default logo position/opacity | Settings page: "Default Image Settings" panel | Low |

---

> **End of context file.** This document covers every module, service, logic flow, data model, API endpoint, third-party integration, environment variable, security layer, testing strategy, and architectural decision in the Scriptura project. Give it to any AI tool to provide full project understanding.