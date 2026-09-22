// backend/tests/unit/clientDeliverySanitization.test.js
'use strict';

/**
 * Regression tests for the response_summary credential-redaction fix
 * (release-audit finding #4/#20, 2026-08-17).
 *
 * Root cause: services/delivery/clientDeliveryService.js persisted a
 * client's raw HTTP response body into `response_summary` unredacted. A
 * client endpoint that echoes request headers back (confirmed directly
 * against a real echo endpoint during the audit) would leak the decrypted
 * credential through GET /config/integrations/:id/delivery-logs and the
 * `delivery` array in POST /blogs/:id/publish's response.
 *
 * No real network, no real DB: `axios` and the SSRF guard are mocked so
 * these tests isolate sanitization behavior only — same "mock the external
 * boundary" convention as outcomeEvaluationScheduler.test.js (which mocks
 * services/serp + services/gsc rather than hitting the network or DB).
 *
 * TEST-ONLY credential material throughout — never a real client secret.
 */

process.env.CONFIG_ENCRYPTION_KEY =
  process.env.CONFIG_ENCRYPTION_KEY || 'dGVzdC1vbmx5LWtleS1uZXZlci11c2UtaW4tcHJvZC0hISE=';

jest.mock('axios');
jest.mock('../../src/services/brandVoice', () => ({
  assertSafeUrl: jest.fn(async (url) => ({ url, hostname: 'client.example', addresses: ['203.0.113.1'] })),
}));

const axios = require('axios');
const credentialCrypto = require('../../src/services/delivery/credentialCrypto');
const { sanitizeResponseText, sendPayload } = require('../../src/services/delivery/clientDeliveryService');

const TEST_SECRET = 'sk-test-super-secret-value-xyz789'; // test-only, not a real credential

function bearerIntegration(overrides = {}) {
  return {
    id: 1,
    name: 'Test Integration',
    endpoint_url: 'https://client.example/publish',
    auth_type: 'bearer',
    auth_header_name: null,
    auth_secret_encrypted: credentialCrypto.encrypt(TEST_SECRET),
    response_id_path: null,
    response_url_path: null,
    fieldMappings: [{ client_field: 'title', source_type: 'field', scriptura_field: 'blog.title', is_required: true, sort_order: 0 }],
    ...overrides,
  };
}

function customHeaderIntegration(overrides = {}) {
  return bearerIntegration({
    auth_type: 'custom_header',
    auth_header_name: 'X-Api-Key',
    auth_secret_encrypted: credentialCrypto.encrypt(TEST_SECRET),
    ...overrides,
  });
}

const SAMPLE_BLOG = { id: 1, blog_title: 'Test Blog', blog_content: '<p>hi</p>' };

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// A-G: sanitizeResponseText — pure function, no mocking needed
// ---------------------------------------------------------------------------

describe('sanitizeResponseText', () => {
  it('A. leaves a normal response with no credential untouched', () => {
    const text = JSON.stringify({ success: true, post_id: '123', url: 'https://client.example/post/123' });
    expect(sanitizeResponseText(text, { secret: null, headerNames: [] })).toBe(text);
  });

  it('B. "Authorization: Bearer SECRET" becomes "Authorization: Bearer [REDACTED]"', () => {
    const text = 'Authorization: Bearer sk-test-super-secret-value-xyz789';
    const out = sanitizeResponseText(text, { secret: 'sk-test-super-secret-value-xyz789', headerNames: ['authorization'] });
    expect(out).toBe('Authorization: Bearer [REDACTED]');
  });

  it('C. the exact decrypted API secret is redacted wherever it appears, even without a header wrapper', () => {
    const text = JSON.stringify({ echo: `the key was ${TEST_SECRET}, thanks` });
    const out = sanitizeResponseText(text, { secret: TEST_SECRET, headerNames: [] });
    expect(out).not.toContain(TEST_SECRET);
    expect(out).toContain('[REDACTED]');
  });

  it('D. a custom configured authentication header is redacted (JSON-echo shape)', () => {
    const text = JSON.stringify({ headers: { 'x-api-key': TEST_SECRET } });
    const out = sanitizeResponseText(text, { secret: TEST_SECRET, headerNames: ['x-api-key'] });
    expect(out).not.toContain(TEST_SECRET);
    expect(JSON.parse(out).headers['x-api-key']).toBe('[REDACTED]');
  });

  it('D2. a custom configured authentication header is redacted (plain header-line shape)', () => {
    const text = 'X-Api-Key: sk-test-super-secret-value-xyz789\nContent-Type: text/plain';
    const out = sanitizeResponseText(text, { secret: TEST_SECRET, headerNames: ['x-api-key'] });
    expect(out).toBe('X-Api-Key: [REDACTED]\nContent-Type: text/plain');
  });

  it('E. multiple occurrences of the same secret are all redacted', () => {
    const text = `first: ${TEST_SECRET}, second: ${TEST_SECRET}, third: ${TEST_SECRET}`;
    const out = sanitizeResponseText(text, { secret: TEST_SECRET, headerNames: [] });
    expect(out).not.toContain(TEST_SECRET);
    expect(out.match(/\[REDACTED\]/g)).toHaveLength(3);
  });

  it('F. unrelated fields in the response remain unchanged', () => {
    const text = JSON.stringify({ post_id: 'abc-123', status: 'accepted', count: 42, nested: { ok: true } });
    const out = sanitizeResponseText(text, { secret: TEST_SECRET, headerNames: ['authorization', 'x-api-key'] });
    expect(out).toBe(text); // none of these fields contain the secret or a credential header name
  });

  it('does not throw and returns an empty string for null/undefined input', () => {
    expect(sanitizeResponseText(null, { secret: TEST_SECRET })).toBe('');
    expect(sanitizeResponseText(undefined, { secret: TEST_SECRET })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// G, H, I, J: full sendPayload pipeline — the exact function whose returned
// `responseSummary` flows unmodified into both persistence
// (attemptDelivery -> PublishingDeliveryLog.create) and the API response
// (deliverIfConfigured's returned array -> blogs.controller.js's `delivery`
// field). Proving sendPayload's output is sanitized proves both H and I,
// since nothing downstream re-derives response_summary from the raw body.
// ---------------------------------------------------------------------------

describe('sendPayload — response_summary sanitization (the persisted/returned value)', () => {
  it('G. the 2000-character cap still applies after sanitization', async () => {
    const longBody = 'x'.repeat(3000);
    axios.post.mockResolvedValue({ status: 200, data: longBody });

    const result = await sendPayload(SAMPLE_BLOG, bearerIntegration(), 'https://client.example/publish');

    expect(result.responseSummary.body).toHaveLength(2000);
  });

  it('H/I. a bearer credential echoed back by the client is redacted in the exact value that would be persisted and returned', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { success: true, headers: { authorization: `Bearer ${TEST_SECRET}` }, post_id: '99' },
    });

    const result = await sendPayload(SAMPLE_BLOG, bearerIntegration(), 'https://client.example/publish');

    // This is literally what attemptDelivery passes to
    // PublishingDeliveryLog.create({ response_summary: result.responseSummary, ... })
    // and what deliverIfConfigured's returned row (-> the publish endpoint's
    // `delivery` field) carries — see clientDeliveryService.js.
    expect(result.responseSummary.body).not.toContain(TEST_SECRET);
    expect(result.responseSummary.body).toContain('Bearer [REDACTED]');
    expect(result.responseSummary.body).toContain('"post_id":"99"'); // F-equivalent: non-sensitive data survives
  });

  it('H/I. a custom-header credential echoed back is redacted in the persisted/returned value', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { headers: { 'x-api-key': TEST_SECRET }, ok: true },
    });

    const result = await sendPayload(SAMPLE_BLOG, customHeaderIntegration(), 'https://client.example/publish');

    expect(result.responseSummary.body).not.toContain(TEST_SECRET);
    expect(result.responseSummary.body).toContain('[REDACTED]');
  });

  it('J. the decrypted secret never appears anywhere in the full sendPayload result object', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { headers: { authorization: `Bearer ${TEST_SECRET}`, 'x-forwarded-for': '1.2.3.4' }, echoed_again: TEST_SECRET },
    });

    const result = await sendPayload(SAMPLE_BLOG, bearerIntegration(), 'https://client.example/publish');

    expect(JSON.stringify(result)).not.toContain(TEST_SECRET);
  });

  it('a failed (non-2xx) delivery also has its response_summary sanitized', async () => {
    axios.post.mockResolvedValue({
      status: 401,
      data: { error: 'invalid token', headers: { authorization: `Bearer ${TEST_SECRET}` } },
    });

    const result = await sendPayload(SAMPLE_BLOG, bearerIntegration(), 'https://client.example/publish');

    expect(result.responseSummary.body).not.toContain(TEST_SECRET);
    expect(result.error).toBe('Authentication failed — check the configured credential.');
  });
});
