'use strict';

/**
 * Delivers a published blog to every enabled `publishing_integrations` row.
 *
 * SECURITY: `endpoint_url`/`test_endpoint_url` are admin-supplied URLs the
 * SERVER will POST credentials to — the same SSRF class of risk
 * services/brandVoice.js's `assertSafeUrl` already guards against for
 * admin-supplied scrape URLs. Reused as-is here rather than reimplemented —
 * see that file's header comment for the full threat model. Redirects are
 * NOT followed for delivery requests (unlike brandVoice's scrape, which
 * expects them): axios runs with `maxRedirects: 0`, and any 3xx response is
 * treated as a failure with a clear message. A client's dedicated publish
 * endpoint redirecting is very likely a misconfiguration, and re-validating
 * a redirect chain for POST (which HTTP allows to silently downgrade to GET
 * on a 301/302) is complexity this feature does not need to take on.
 *
 * CONTRACT: `deliverIfConfigured` NEVER throws and NEVER blocks/reverses the
 * caller's own publish — every failure mode terminates in a logged
 * `publishing_delivery_logs` row, not an exception. This is deliberate (see
 * the integration plan, Section L): the existing Scriptura publish is the
 * source of truth Scriptura owns; delivery to an external system it doesn't
 * control is best-effort and additive.
 */

const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');

const logger = require('../../utils/logger');
const { assertSafeUrl } = require('../brandVoice');
const credentialCrypto = require('./credentialCrypto');
const { buildPayload, setAtPath } = require('./payloadMapper');

const DELIVERY_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const RESPONSE_SUMMARY_CAP_CHARS = 2000;

/** A `request_format: 'multipart'` request also carries the attached image's bytes, so it gets a larger cap than a plain JSON delivery. */
const MULTIPART_BODY_MAX_BYTES = 10 * 1024 * 1024;
/** Bounds fetching a mapped `kind: 'file'` field's source image before attaching it — independent of whatever size limit the client's own endpoint enforces. */
const IMAGE_FETCH_TIMEOUT_MS = 15000;
const IMAGE_FETCH_MAX_BYTES = 8 * 1024 * 1024;
const MIME_BY_EXTENSION = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };

/** Bounded manual retries — matches this codebase's "bounded batch, no infinite retry" convention (outcomeEvaluationScheduler's maxAttempts). */
const MAX_MANUAL_RETRIES = 5;

const REDACTED = '[REDACTED]';

/**
 * Builds the outbound auth header(s) AND reports back exactly what a
 * response-body sanitizer needs to know to redact them: the decrypted
 * secret value itself, and the header name it was sent under (always
 * `authorization` for bearer; the configured — or default — header name for
 * api_key/custom_header). `secret`/`headerName` are `null` for `auth_type:
 * 'none'`, so nothing downstream has anything to redact.
 */
function resolveAuth(integration) {
  if (integration.auth_type === 'none' || !integration.auth_secret_encrypted) {
    return { headers: {}, secret: null, headerName: null };
  }

  const secret = credentialCrypto.decrypt(integration.auth_secret_encrypted);
  if (integration.auth_type === 'bearer') {
    return { headers: { Authorization: `Bearer ${secret}` }, secret, headerName: 'authorization' };
  }
  // api_key / custom_header
  const headerName = integration.auth_header_name || 'X-Api-Key';
  return { headers: { [headerName]: secret }, secret, headerName: headerName.toLowerCase() };
}

/** Escapes a string for safe literal use inside a `RegExp`. */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Redacts credential material from a client's raw response body BEFORE it
 * is ever persisted (`publishing_delivery_logs.response_summary`) or
 * returned through any API response. A client endpoint that echoes request
 * headers back (common for debug/logging-style APIs — confirmed directly
 * against a real echo endpoint during the release audit that found this
 * gap) would otherwise leak the decrypted credential through
 * `GET /config/integrations/:id/delivery-logs` and the `delivery` array in
 * `POST /blogs/:id/publish`'s response.
 *
 * Three independent passes, all defensive:
 *   1. Literal, global replace of the exact decrypted secret — the
 *      deterministic guarantee, since the secret is always known at send
 *      time. `String.split/join`, not a regex, so no character in the
 *      secret needs escaping. This alone already turns
 *      `Authorization: Bearer <secret>` into `Authorization: Bearer
 *      [REDACTED]` — the scheme prefix is untouched because only the
 *      secret substring itself is replaced.
 *   2. A generic `Bearer <token>` scheme match, independent of whether the
 *      exact secret was known/matched — catches a differently-encoded echo
 *      of a bearer credential under ANY header name, and (like pass 1)
 *      preserves the `Bearer ` prefix rather than swallowing it. Idempotent
 *      against pass 1's own output (`Bearer [REDACTED]` re-matches itself
 *      to the same string).
 *   3. Header-shaped, whole-value redaction by name for every NON-bearer
 *      header name capable of carrying this integration's credential (the
 *      configured/default header for api_key/custom_header) — these carry
 *      a raw key with no scheme prefix to preserve, so the entire value is
 *      redacted. Matches both the common JSON-echo shape
 *      (`"x-api-key":"xyz"`) and a plain header-line shape
 *      (`X-Api-Key: xyz`). `authorization` is excluded here — pass 2
 *      already handles it while preserving the `Bearer ` scheme marker.
 *
 * @param {string} text Raw response body, UNTRUNCATED — sanitize before
 *   capping, never after, so a secret straddling the cap boundary can never
 *   leave a partial value visible.
 * @param {{secret: ?string, headerNames?: string[]}} options
 * @returns {string}
 */
function sanitizeResponseText(text, { secret, headerNames = [] } = {}) {
  let sanitized = String(text ?? '');

  if (secret) {
    sanitized = sanitized.split(secret).join(REDACTED);
  }

  sanitized = sanitized.replace(/\bBearer\s+[^\s"'\\]+/gi, `Bearer ${REDACTED}`);

  for (const name of headerNames) {
    if (!name || name.toLowerCase() === 'authorization') continue;
    const escaped = escapeRegExp(name);
    // JSON echo: "x-api-key":"xyz" / "x-api-key": "xyz"
    sanitized = sanitized.replace(new RegExp(`(["']${escaped}["']\\s*:\\s*["'])[^"']*(["'])`, 'gi'), `$1${REDACTED}$2`);
    // Plain header-line echo: X-Api-Key: xyz
    sanitized = sanitized.replace(new RegExp(`(^|[\\r\\n])(${escaped})(\\s*:\\s*)[^\\r\\n]*`, 'gi'), `$1$2$3${REDACTED}`);
  }

  return sanitized;
}

function getAtPath(obj, path) {
  if (!path || obj === null || typeof obj !== 'object') return null;
  const value = String(path)
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), obj);
  return value === undefined ? null : value;
}

/** Categorizes a failure into a safe, stable code+message — never raw exception text (which could echo request/credential details). */
function categorizeFailure({ httpStatus, err }) {
  if (httpStatus === 401 || httpStatus === 403) {
    return { code: 'AUTH_FAILED', message: 'Authentication failed — check the configured credential.' };
  }
  if (httpStatus === 400 || httpStatus === 422) {
    return { code: 'INVALID_PAYLOAD', message: 'The client rejected the payload — check the field mapping.' };
  }
  if (httpStatus >= 300 && httpStatus < 400) {
    return { code: 'UNEXPECTED_REDIRECT', message: 'The client endpoint returned a redirect, which is not followed for delivery requests. Use the final URL directly.' };
  }
  if (typeof httpStatus === 'number' && httpStatus >= 500) {
    return { code: 'SERVER_ERROR', message: 'The client server returned an error.' };
  }
  if (err && (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || ''))) {
    return { code: 'TIMEOUT', message: 'The client did not respond in time.' };
  }
  if (err) {
    return { code: 'NETWORK_ERROR', message: 'Could not reach the client endpoint.' };
  }
  return { code: 'DELIVERY_FAILED', message: `The client responded with HTTP ${httpStatus}.` };
}

/** JPEG quality steps tried in order until the re-encode fits `maxBytes`, or they run out. */
const COMPRESSION_QUALITY_STEPS = [80, 65, 50, 35];

/**
 * Re-encodes `buffer` as JPEG at decreasing quality (and, if quality alone
 * isn't enough, shrinking dimensions by 20% per extra pass) until it fits
 * under `maxBytes`. Scriptura's generated images run ~2.6-2.9MB PNG — well
 * over e.g. DivineTalk's real `max:2048` (KB) validation rule — so a
 * multipart integration with `max_file_kb` set needs this or every delivery
 * 422s. Always returns the smallest result achieved even if still over cap
 * (the client's own validation is the final word; this is best-effort, not
 * a guarantee) — the original buffer if it was already small enough.
 *
 * @param {Buffer} buffer
 * @param {number} maxBytes
 * @returns {Promise<{buffer: Buffer, contentType: string}>}
 */
async function compressToFit(buffer, maxBytes) {
  if (buffer.length <= maxBytes) return { buffer, contentType: null };

  let best = buffer;
  let scale = 1;
  for (let pass = 0; pass < 2; pass += 1) {
    for (const quality of COMPRESSION_QUALITY_STEPS) {
      try {
        let pipeline = sharp(buffer).jpeg({ quality });
        if (scale < 1) {
          const meta = await sharp(buffer).metadata();
          if (meta.width) pipeline = pipeline.resize({ width: Math.round(meta.width * scale) });
        }
        const out = await pipeline.toBuffer();
        if (out.length < best.length) best = out;
        if (out.length <= maxBytes) return { buffer: out, contentType: 'image/jpeg' };
      } catch {
        // A source format sharp can't decode — nothing to do but fall through with `best` unchanged.
      }
    }
    scale *= 0.7;
  }
  return { buffer: best, contentType: best === buffer ? null : 'image/jpeg' };
}

/**
 * Fetches a mapped `kind: 'file'` field's source URL (currently only the
 * featured/OG image) so it can be attached as a real file part in a
 * `request_format: 'multipart'` request. `assertSafeUrl` is reused here too
 * — the URL is stored on the blog row, not typed by an admin per-request,
 * but the SSRF risk of the server fetching an arbitrary URL is the same
 * class regardless of where the URL came from.
 *
 * @param {string} url
 * @param {?number} maxBytes From the integration's `max_file_kb`, if set — compresses down to fit.
 * @returns {Promise<{buffer: Buffer, filename: string, contentType: string}>}
 */
async function fetchFileField(url, maxBytes = null) {
  const safe = await assertSafeUrl(url);
  const response = await axios.get(safe.url, {
    responseType: 'arraybuffer',
    timeout: IMAGE_FETCH_TIMEOUT_MS,
    maxRedirects: 0,
    maxContentLength: IMAGE_FETCH_MAX_BYTES,
    maxBodyLength: IMAGE_FETCH_MAX_BYTES,
    validateStatus: (status) => status >= 200 && status < 300,
  });
  const ext = path.extname(new URL(safe.url).pathname).toLowerCase();
  let buffer = Buffer.from(response.data);
  let contentType = response.headers['content-type'] || MIME_BY_EXTENSION[ext] || 'application/octet-stream';
  let filename = path.basename(new URL(safe.url).pathname) || 'image';

  if (maxBytes && buffer.length > maxBytes) {
    const compressed = await compressToFit(buffer, maxBytes);
    buffer = compressed.buffer;
    if (compressed.contentType) {
      contentType = compressed.contentType;
      filename = `${filename.replace(/\.[^.]+$/, '')}.jpg`;
    }
  }

  return { buffer, filename, contentType };
}

/**
 * Builds the payload and sends ONE real HTTP POST to `targetUrl`. Pure
 * send-and-report — no database write, so both a real delivery attempt and
 * a Test Connection ping (which must never pollute delivery history) can
 * share this exact code path. Never throws.
 *
 * @private
 * @returns {Promise<{outcome:'ok'|'missing_required'|'invalid_url'|'auth_error'|'http', payload:object, fieldNames:string[], missingRequired:Array, httpStatus:?number, responseSummary:?object, externalPostId:?string, externalUrl:?string, error:?string}>}
 */
async function sendPayload(blog, integration, targetUrl, { extraFields = {} } = {}) {
  const { payload, fieldNames, missingRequired, fileFields } = buildPayload(blog, integration.fieldMappings || []);
  // Fields outside the admin's mapping — currently only the client's post id on an update.
  for (const [clientField, value] of Object.entries(extraFields)) {
    setAtPath(payload, clientField, value);
    fieldNames.push(clientField);
  }
  const isMultipart = integration.request_format === 'multipart';

  if (missingRequired.length > 0) {
    const field = missingRequired[0].client_field;
    return { outcome: 'missing_required', payload, fieldNames, missingRequired, httpStatus: null, responseSummary: null, externalPostId: null, externalUrl: null, error: `Publishing API requires "${field}", but no value was available.` };
  }

  let safe;
  try {
    safe = await assertSafeUrl(targetUrl);
  } catch (err) {
    return { outcome: 'invalid_url', payload, fieldNames, missingRequired, httpStatus: null, responseSummary: null, externalPostId: null, externalUrl: null, error: err.message || 'The configured endpoint URL is not allowed.' };
  }

  let auth;
  try {
    auth = resolveAuth(integration);
  } catch (err) {
    logger.error('Client delivery: failed to decrypt stored credential.', { integrationId: integration.id, message: err.message });
    return { outcome: 'auth_error', payload, fieldNames, missingRequired, httpStatus: null, responseSummary: null, externalPostId: null, externalUrl: null, error: 'Could not read the stored credential — it may need to be re-entered.' };
  }
  const secret = auth.secret;
  const authHeaderName = auth.headerName;

  let headers;
  let body = payload;
  if (isMultipart) {
    try {
      const form = new FormData();
      const fileFieldNames = new Set(fileFields.map((f) => f.client_field));
      for (const [key, value] of Object.entries(payload)) {
        if (fileFieldNames.has(key)) continue; // attached as a real file below, not a text field
        form.append(key, typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value));
      }
      const maxFileBytes = integration.max_file_kb ? integration.max_file_kb * 1024 : null;
      for (const { client_field: clientField, url } of fileFields) {
        const file = await fetchFileField(url, maxFileBytes);
        form.append(clientField, file.buffer, { filename: file.filename, contentType: file.contentType });
      }
      body = form;
      headers = { ...auth.headers, ...form.getHeaders() };
    } catch (err) {
      logger.warn('Client delivery: failed to attach a mapped file field.', { integrationId: integration.id, message: err.message });
      return { outcome: 'http', payload, fieldNames, missingRequired, httpStatus: null, responseSummary: null, externalPostId: null, externalUrl: null, error: `Could not fetch/attach the mapped file field: ${err.message}` };
    }
  } else {
    headers = { ...auth.headers, 'Content-Type': 'application/json' };
  }

  let response;
  let networkErr = null;
  try {
    response = await axios.post(safe.url, body, {
      timeout: DELIVERY_TIMEOUT_MS,
      maxRedirects: 0,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: isMultipart ? MULTIPART_BODY_MAX_BYTES : MAX_RESPONSE_BYTES,
      validateStatus: () => true,
      headers,
    });
  } catch (err) {
    networkErr = err;
  }

  if (networkErr) {
    const { code, message } = categorizeFailure({ httpStatus: null, err: networkErr });
    logger.warn('Client delivery request failed.', { integrationId: integration.id, code, message: networkErr.message });
    return { outcome: 'http', payload, fieldNames, missingRequired, httpStatus: null, responseSummary: null, externalPostId: null, externalUrl: null, error: message };
  }

  const httpStatus = response.status;
  const responseSummary = (() => {
    try {
      const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      // Sanitize the FULL body first, cap after — never log/return/persist
      // the raw text at any point before this line.
      const sanitized = sanitizeResponseText(text, {
        secret,
        headerNames: ['authorization', authHeaderName].filter(Boolean),
      });
      return { body: (sanitized || '').slice(0, RESPONSE_SUMMARY_CAP_CHARS) };
    } catch {
      return null;
    }
  })();

  if (httpStatus >= 200 && httpStatus < 300) {
    return {
      outcome: 'http',
      payload,
      fieldNames,
      missingRequired,
      httpStatus,
      responseSummary,
      externalPostId: integration.response_id_path ? String(getAtPath(response.data, integration.response_id_path) ?? '') || null : null,
      externalUrl: integration.response_url_path ? String(getAtPath(response.data, integration.response_url_path) ?? '') || null : null,
      error: null,
    };
  }

  const { message } = categorizeFailure({ httpStatus });
  return { outcome: 'http', payload, fieldNames, missingRequired, httpStatus, responseSummary, externalPostId: null, externalUrl: null, error: message };
}

/**
 * Decides whether this delivery creates the client's post or updates one it
 * already has. Update requires both an `update_endpoint_url` and a prior
 * successful delivery of the same blog that captured the client's post id
 * (via `response_id_path`) — otherwise it falls back to create, which is
 * exactly the pre-update behavior. Resolved fresh on every attempt, retries
 * included, so a retry never creates a duplicate after a later republish
 * already succeeded.
 *
 * @private
 * @returns {Promise<{mode:'create'|'update', targetUrl:string, externalPostId:?string}>}
 */
async function resolveDeliveryTarget(blog, integration) {
  const create = { mode: 'create', targetUrl: integration.endpoint_url, externalPostId: null };
  if (!integration.update_endpoint_url) return create;

  const { Op } = require('sequelize');
  const { PublishingDeliveryLog } = require('../../models');
  const prior = await PublishingDeliveryLog.findOne({
    where: {
      integration_id: integration.id,
      blog_id: blog.id,
      status: 'delivered',
      external_post_id: { [Op.ne]: null },
    },
    order: [['id', 'DESC']],
  });
  if (!prior) return create;

  return { mode: 'update', targetUrl: integration.update_endpoint_url, externalPostId: prior.external_post_id };
}

/**
 * One HTTP attempt to one integration for one blog, persisted as a
 * `publishing_delivery_logs` row. Never throws.
 *
 * @private
 */
async function attemptDelivery(blog, integration, { idempotencyKey, attemptNumber, traceId }) {
  const { PublishingDeliveryLog } = require('../../models');

  const target = await resolveDeliveryTarget(blog, integration);
  const extraFields = target.mode === 'update' ? { [integration.update_id_field || 'id']: target.externalPostId } : {};

  const result = await sendPayload(blog, integration, target.targetUrl, { extraFields });
  const isSuccess = result.error === null && typeof result.httpStatus === 'number';

  return PublishingDeliveryLog.create({
    integration_id: integration.id,
    blog_id: blog.id,
    delivery_mode: target.mode,
    attempt_number: attemptNumber,
    idempotency_key: idempotencyKey,
    request_field_names: result.fieldNames,
    trace_id: traceId,
    completed_at: new Date(),
    status: isSuccess ? 'delivered' : 'failed',
    http_status: result.httpStatus,
    response_summary: result.responseSummary,
    // An update response may not echo the id back — keep the one we updated
    // so the next republish still finds it.
    external_post_id: result.externalPostId || target.externalPostId,
    external_url: result.externalUrl,
    error: result.error,
  });
}

/**
 * Delivers `blog` to every enabled integration. Called from the two publish
 * call sites (blogs.controller.js, scheduledPublisher.js) — never throws.
 *
 * @param {import('../../models').Blog} blog
 * @param {{trigger: 'manual'|'scheduled'}} options
 * @returns {Promise<Array<object>>} the created delivery log rows (plain, for the manual-publish response).
 */
async function deliverIfConfigured(blog, { trigger } = {}) {
  try {
    const { PublishingIntegration, PublishingFieldMapping } = require('../../models');

    const integrations = await PublishingIntegration.findAll({
      where: { enabled: true },
      include: [{ model: PublishingFieldMapping, as: 'fieldMappings' }],
    });
    if (integrations.length === 0) return [];

    const idempotencyKey = `scriptura-blog-${blog.id}-${crypto.randomUUID()}`;
    const traceId = crypto.randomUUID();

    const results = [];
    for (const integration of integrations) {
      try {
        const log = await attemptDelivery(blog, integration, {
          idempotencyKey,
          attemptNumber: 1,
          traceId,
        });
        results.push(log);
        logger.info(`Client delivery (${trigger}, ${log.delivery_mode}): blog ${blog.id} -> integration ${integration.id} (${integration.name}): ${log.status}.`);
      } catch (err) {
        // A bug in delivery logging itself must still never break the caller's publish.
        logger.error('Client delivery attempt failed unexpectedly.', { integrationId: integration.id, blogId: blog.id, message: err.message });
      }
    }
    return results;
  } catch (err) {
    logger.error('Client delivery: deliverIfConfigured failed unexpectedly.', { blogId: blog?.id, message: err.message });
    return [];
  }
}

/**
 * Re-attempts a previously failed delivery, reusing its idempotency key and
 * incrementing attempt_number. Bounded by MAX_MANUAL_RETRIES.
 *
 * @param {number} deliveryLogId
 * @returns {Promise<object>} the new delivery log row.
 */
async function retryDelivery(deliveryLogId) {
  const ApiError = require('../../utils/ApiError');
  const { PublishingDeliveryLog, PublishingIntegration, PublishingFieldMapping, Blog } = require('../../models');

  const priorLog = await PublishingDeliveryLog.findByPk(deliveryLogId);
  if (!priorLog) throw ApiError.notFound(`No delivery log with id ${deliveryLogId}.`);
  if (priorLog.attempt_number >= MAX_MANUAL_RETRIES) {
    throw ApiError.unprocessable(`This delivery has already been retried ${MAX_MANUAL_RETRIES} times — reached the retry limit.`, {
      code: 'RETRY_LIMIT_REACHED',
    });
  }

  const [integration, blog] = await Promise.all([
    PublishingIntegration.findByPk(priorLog.integration_id, { include: [{ model: PublishingFieldMapping, as: 'fieldMappings' }] }),
    Blog.findByPk(priorLog.blog_id),
  ]);
  if (!integration) throw ApiError.notFound('The integration for this delivery no longer exists.');
  if (!blog) throw ApiError.notFound('The blog for this delivery no longer exists.');

  return attemptDelivery(blog, integration, {
    idempotencyKey: priorLog.idempotency_key,
    attemptNumber: priorLog.attempt_number + 1,
    traceId: priorLog.trace_id,
  });
}

/** A synthetic blog-shaped object — used only when Test Connection is run with no real blog to send. Clearly fake values so a client eyeballing a test payload can tell it's a test. */
function sampleTestBlog() {
  return {
    id: 0,
    blog_title: 'Sample Test Article',
    slug: 'sample-test-article',
    blog_content: '<p>This is a test payload sent by Scriptura\'s Config page to verify the connection. No real article data.</p>',
    meta_title: 'Sample Test Article',
    meta_description: 'A test payload from Scriptura.',
    canonical_url: null,
    seo_score: 0,
    aeo_score: 0,
    geo_score: 0,
    word_count: 0,
    og_image: null,
    blog_status: 1,
    published_by: 'Scriptura Test Connection',
    publish_date: new Date(),
  };
}

/**
 * Sends a real ping to the integration's `test_endpoint_url` (falling back to
 * `endpoint_url` when no test endpoint is configured) — never persisted as a
 * `publishing_delivery_logs` row, since a test ping isn't a real delivery.
 * Uses a real blog's data when `blogId` is given, otherwise a clearly-labeled
 * synthetic sample (see sampleTestBlog) — never a silent dry run, matching
 * the integration plan's Section K.
 *
 * @param {number} integrationId
 * @param {{blogId?: number}} [options]
 * @returns {Promise<{usedTestEndpoint: boolean, targetUrl: string} & Awaited<ReturnType<sendPayload>>>}
 */
async function testConnection(integrationId, { blogId } = {}) {
  const ApiError = require('../../utils/ApiError');
  const { PublishingIntegration, PublishingFieldMapping, Blog } = require('../../models');

  const integration = await PublishingIntegration.findByPk(integrationId, {
    include: [{ model: PublishingFieldMapping, as: 'fieldMappings' }],
  });
  if (!integration) throw ApiError.notFound(`No integration with id ${integrationId}.`);

  const blog = blogId ? await Blog.findByPk(blogId) : null;
  if (blogId && !blog) throw ApiError.notFound(`No blog with id ${blogId}.`);

  const targetUrl = integration.test_endpoint_url || integration.endpoint_url;
  const usedTestEndpoint = Boolean(integration.test_endpoint_url);

  const result = await sendPayload(blog || sampleTestBlog(), integration, targetUrl);
  return { usedTestEndpoint, targetUrl, ...result };
}

module.exports = {
  deliverIfConfigured,
  retryDelivery,
  testConnection,
  MAX_MANUAL_RETRIES,
  // Exported for direct unit testing only — not part of the public delivery API.
  sanitizeResponseText,
  sendPayload,
};
