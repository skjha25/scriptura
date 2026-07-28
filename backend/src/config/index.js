'use strict';

/**
 * Central environment configuration.
 *
 * Every environment-driven knob in the app is resolved here exactly once and
 * exported as a frozen object. Nothing else under `src/` reads `process.env`
 * directly — enforced by tests/unit/config.test.js, which greps the tree — so
 * there is a single place to look when asking "what does this deployment
 * actually do?".
 *
 * Validation is deliberately environment-aware:
 *   - production  -> secrets and DB credentials are hard requirements, we throw
 *   - development -> we warn but boot, so the app is explorable before keys exist
 *   - test        -> we substitute deterministic values and never touch MySQL
 */

const path = require('path');
const fs = require('fs');

// Load .env from the backend root regardless of the cwd the process was started
// from (matters for `sequelize-cli`, Jest, and Docker, which all differ).
const backendRoot = path.resolve(__dirname, '..', '..');
require('dotenv').config({ path: path.join(backendRoot, '.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';
const isTest = NODE_ENV === 'test';
const isProduction = NODE_ENV === 'production';
const isDevelopment = !isTest && !isProduction;

/** Collected non-fatal configuration problems, surfaced on boot. */
const warnings = [];

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  // `.env.example` uses trailing comments (`local # local | s3`); dotenv keeps
  // them for unquoted values, so strip them rather than silently mis-parsing.
  const cleaned = String(value).replace(/\s+#.*$/, '').trim();
  return cleaned === '' ? fallback : cleaned;
}

/**
 * Splits CORS_ORIGIN into a list. Supports a single origin, a comma-separated
 * list, or `*`. An explicit list is what production should use.
 */
function originList(value, fallback) {
  const raw = str(value, fallback);
  if (raw === '*') return '*';
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

// --- Secrets -----------------------------------------------------------------
// In test we use fixed throwaway secrets so token fixtures are reproducible.
// In dev, a missing secret would otherwise crash `jwt.sign`, which is a
// confusing first-run experience — so we generate an ephemeral one and warn
// loudly. Ephemeral means tokens do not survive a restart, which is fine
// locally and unacceptable in production (hence the throw below).
function resolveSecret(name, testValue) {
  const provided = str(process.env[name]);
  if (provided) {
    if (isProduction && provided.length < 32) {
      throw new Error(
        `${name} must be at least 32 characters in production (got ${provided.length}).`
      );
    }
    return provided;
  }
  if (isTest) return testValue;
  if (isProduction) {
    throw new Error(`${name} is required in production. Set it in the environment.`);
  }
  warnings.push(
    `${name} is not set — using a random per-process secret. ` +
      'Tokens will be invalidated on every restart. Set it in backend/.env.'
  );
  return require('crypto').randomBytes(48).toString('hex');
}

const jwtAccessSecret = resolveSecret('JWT_ACCESS_SECRET', 'test-access-secret-not-for-real-use');
const jwtRefreshSecret = resolveSecret('JWT_REFRESH_SECRET', 'test-refresh-secret-not-for-real-use');

if (!isTest && jwtAccessSecret === jwtRefreshSecret) {
  throw new Error(
    'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values. ' +
      'Reusing one secret means a refresh token is accepted as an access token.'
  );
}

// --- Database ----------------------------------------------------------------
// Two dialects by design, documented in ARCHITECTURE.md:
//   - mysql  : the real runtime target (dev, staging, production)
//   - sqlite : in-memory, tests only, so `npm test` is green on a fresh clone
//              with no database server installed.
const dbDialect = isTest ? 'sqlite' : 'mysql';

const database = {
  dialect: dbDialect,
  host: str(process.env.DB_HOST, 'localhost'),
  port: int(process.env.DB_PORT, 3306),
  name: str(process.env.DB_NAME, isTest ? ':memory:' : 'scriptura'),
  user: str(process.env.DB_USER, 'root'),
  password: str(process.env.DB_PASSWORD, ''),
  // `logging` is noisy and leaks query contents; opt in explicitly.
  logging: bool(process.env.DB_LOGGING, false),
  pool: {
    max: int(process.env.DB_POOL_MAX, 10),
    min: int(process.env.DB_POOL_MIN, 0),
    idle: int(process.env.DB_POOL_IDLE, 10000),
    acquire: int(process.env.DB_POOL_ACQUIRE, 30000),
  },
};

if (isProduction) {
  for (const key of ['DB_HOST', 'DB_NAME', 'DB_USER']) {
    if (!str(process.env[key])) {
      throw new Error(`${key} is required in production.`);
    }
  }
} else if (!isTest && !str(process.env.DB_NAME)) {
  warnings.push(
    `DB_NAME is not set — falling back to "${database.name}" on ${database.host}:${database.port}.`
  );
}

// --- AI providers ------------------------------------------------------------
// Tests must never make a network call, so the mock provider is forced there
// regardless of what the environment says.
const anthropicApiKey = str(process.env.ANTHROPIC_API_KEY);
const openaiApiKey = str(process.env.OPENAI_API_KEY);

let textProvider = str(process.env.AI_TEXT_PROVIDER, 'anthropic').toLowerCase();
let imageProvider = str(process.env.AI_IMAGE_PROVIDER, 'openai').toLowerCase();

if (isTest) {
  textProvider = 'mock';
  imageProvider = 'mock';
} else {
  // Degrade to mock rather than crash when a key is absent: the whole app stays
  // clickable and every non-AI feature keeps working. The warning makes the
  // downgrade obvious instead of silent.
  if (textProvider === 'anthropic' && !anthropicApiKey) {
    warnings.push(
      'ANTHROPIC_API_KEY is not set — text generation (titles, outlines, articles, ' +
        'brand voice) will use the mock provider and return canned content.'
    );
    textProvider = 'mock';
  }
  if (imageProvider === 'openai' && !openaiApiKey) {
    warnings.push(
      'OPENAI_API_KEY is not set — image generation will use the mock provider ' +
        'and return a locally generated placeholder image.'
    );
    imageProvider = 'mock';
  }
}

const ai = {
  textProvider,
  imageProvider,
  anthropic: {
    apiKey: anthropicApiKey,
    model: str(process.env.ANTHROPIC_MODEL, 'claude-sonnet-5'),
    maxTokens: int(process.env.ANTHROPIC_MAX_TOKENS, 8192),
  },
  openai: {
    apiKey: openaiApiKey,
    imageModel: str(process.env.OPENAI_IMAGE_MODEL, 'gpt-image-1'),
  },
  // Generation is the slowest path in the app; a request-level ceiling keeps a
  // hung provider call from pinning a worker forever.
  requestTimeoutMs: int(process.env.AI_REQUEST_TIMEOUT_MS, 120000),
};

// --- SerpAPI (feature-flagged) ----------------------------------------------
// Section 1 of the spec: the app must be fully functional with this disabled.
// `enabled` is the single source of truth the rest of the code checks; it
// requires BOTH the flag and a key, so a half-configured deployment behaves
// like a disabled one instead of failing at call time.
const serpKey = str(process.env.SERPAPI_KEY);
const serpFlag = bool(process.env.SERPAPI_ENABLED, false);

if (serpFlag && !serpKey && !isTest) {
  warnings.push(
    'SERPAPI_ENABLED=true but SERPAPI_KEY is empty — web grounding and rank ' +
      'checking will stay disabled. Set SERPAPI_KEY or flip the flag to false.'
  );
}

const serp = {
  enabled: serpFlag && Boolean(serpKey),
  // Exposed separately so the /health payload and the UI can distinguish
  // "switched off" from "switched on but misconfigured".
  flagEnabled: serpFlag,
  hasKey: Boolean(serpKey),
  apiKey: serpKey,
  baseUrl: str(process.env.SERPAPI_BASE_URL, 'https://serpapi.com/search.json'),
  timeoutMs: int(process.env.SERPAPI_TIMEOUT_MS, 20000),
};

// --- Storage -----------------------------------------------------------------
const uploadsDir = path.resolve(backendRoot, str(process.env.UPLOADS_DIR, './uploads'));

const storage = {
  driver: str(process.env.STORAGE_DRIVER, 'local').toLowerCase(),
  uploadsDir,
  // Public URL prefix the API prepends when handing paths to the frontend.
  publicPath: str(process.env.STORAGE_PUBLIC_PATH, '/uploads'),
  maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, 10 * 1024 * 1024),
  s3: {
    bucket: str(process.env.S3_BUCKET),
    region: str(process.env.S3_REGION),
    accessKeyId: str(process.env.S3_ACCESS_KEY_ID),
    secretAccessKey: str(process.env.S3_SECRET_ACCESS_KEY),
    publicBaseUrl: str(process.env.S3_PUBLIC_BASE_URL),
  },
};

if (!['local', 's3'].includes(storage.driver)) {
  throw new Error(`STORAGE_DRIVER must be "local" or "s3" (got "${storage.driver}").`);
}

// --- Brand logo --------------------------------------------------------------
const logoPath = path.resolve(backendRoot, str(process.env.LOGO_PATH, './assets/logo.png'));
if (!isTest && !fs.existsSync(logoPath)) {
  warnings.push(
    `Logo file not found at ${logoPath} — the logo-overlay feature will fall back ` +
      'to the bundled placeholder. Set LOGO_PATH to the real Divinetalk logo.'
  );
}

const config = Object.freeze({
  env: NODE_ENV,
  isTest,
  isProduction,
  isDevelopment,
  backendRoot,

  port: int(process.env.PORT, 5000),
  appUrl: str(process.env.APP_URL, `http://localhost:${int(process.env.PORT, 5000)}`),
  corsOrigin: originList(process.env.CORS_ORIGIN, 'http://localhost:3000'),
  apiPrefix: '/api/v1',

  /**
   * Reverse-proxy trust for `req.ip`.
   *
   * Off by default: behind nginx/ALB this must be set or rate limiting keys every
   * request to the proxy's own address, but enabling it unconditionally would let
   * a client on a directly-exposed deployment spoof its IP with an
   * `X-Forwarded-For` header and escape the limiter entirely.
   *
   * Accepts a hop count ('1') or an Express trust-proxy expression
   * ('loopback', a subnet, a comma-separated list).
   */
  trustProxy: (() => {
    const raw = str(process.env.TRUST_PROXY);
    if (!raw) return false;
    return /^\d+$/.test(raw) ? Number(raw) : raw;
  })(),

  /**
   * Logger threshold. Resolved here rather than in the logger so that every
   * environment knob lives in one file.
   *
   * Tests are near-silent by default because per-request logs bury real
   * failures; DEBUG_TESTS=1 turns them back on when diagnosing one.
   */
  logLevel: (() => {
    const explicit = str(process.env.LOG_LEVEL).toLowerCase();
    if (explicit) return explicit;
    if (isTest) return bool(process.env.DEBUG_TESTS, false) ? 'debug' : 'error';
    return isProduction ? 'info' : 'debug';
  })(),

  jwt: Object.freeze({
    accessSecret: jwtAccessSecret,
    refreshSecret: jwtRefreshSecret,
    accessTtl: str(process.env.JWT_ACCESS_TTL, '15m'),
    refreshTtl: str(process.env.JWT_REFRESH_TTL, '7d'),
    issuer: str(process.env.JWT_ISSUER, 'scriptura'),
  }),

  database: Object.freeze(database),
  ai: Object.freeze(ai),
  serp: Object.freeze(serp),
  storage: Object.freeze(storage),
  logoPath,

  bcryptRounds: int(process.env.BCRYPT_ROUNDS, isTest ? 4 : 12),

  rateLimit: Object.freeze({
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: int(process.env.RATE_LIMIT_MAX, 300),
    authWindowMs: int(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    authMax: int(process.env.AUTH_RATE_LIMIT_MAX, 20),
    generationWindowMs: int(process.env.GENERATION_RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000),
    generationMax: int(process.env.GENERATION_RATE_LIMIT_MAX, 30),
  }),

  pagination: Object.freeze({
    defaultLimit: int(process.env.PAGINATION_DEFAULT_LIMIT, 20),
    maxLimit: int(process.env.PAGINATION_MAX_LIMIT, 100),
  }),

  warnings: Object.freeze(warnings),
});

module.exports = config;
