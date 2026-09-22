'use strict';

/**
 * Google Search Console authentication — service-account only.
 *
 * Same "optional, half-configured behaves like off" shape as services/serp.js:
 *   - `isEnabled()` is true only when GSC_ENABLED AND valid service-account
 *     credentials AND a site URL are all present (see config/index.js's
 *     `gsc.enabled`), so a deployment that never set these up behaves exactly
 *     like one that explicitly switched GSC off.
 *   - `assertEnabled()` throws the same 503 FEATURE_DISABLED shape serp.js
 *     uses, so callers and the eventual tool layer answer "off" the same way
 *     everywhere in this app.
 *
 * No OAuth consent flow — Search Console access is granted once, out of band,
 * by adding the service account's email as a user on the property in Search
 * Console itself. The scope requested is read-only
 * (webmasters.readonly — see config.gsc.scopes), least privilege for a tool
 * that only ever queries Search Analytics.
 *
 * CREDENTIAL SAFETY: the private key lives only in `config.gsc.serviceAccount`
 * and the cached JWT client below. Nothing in this file ever logs, returns,
 * or interpolates the key or a token into an error message — every catch
 * block here surfaces only `err.message`, which for both JSON-parse failures
 * (config/index.js) and Google's own OAuth token-endpoint errors is already a
 * safe, generic description, never the credential material itself.
 */

const { JWT } = require('google-auth-library');

const config = require('../config');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/** Lazily created, reused across calls — token acquisition/refresh is handled internally by the JWT client. */
let cachedClient = null;

/**
 * Whether GSC-backed features are usable. Exported as a function, same
 * reasoning as serp.js's isEnabled: every call site asks the same question
 * the same way, rather than each reading config.gsc.enabled directly.
 * @returns {boolean}
 */
function isEnabled() {
  return config.gsc.enabled === true;
}

/**
 * Throws the standard 503 when GSC is off — disabled flag, missing
 * credentials, or a malformed key are all the same externally-visible state.
 * @param {string} feature Human name of what was attempted.
 */
function assertEnabled(feature) {
  if (isEnabled()) return;
  throw ApiError.featureDisabled(
    `${feature} needs the Google Search Console integration, which is switched off for this deployment. ` +
      'Set GSC_ENABLED=true, GSC_SITE_URL, and a valid GSC_SERVICE_ACCOUNT_KEY to enable it.',
    {
      details: {
        feature: 'gsc_api',
        flag_enabled: config.gsc.flagEnabled,
        has_credentials: config.gsc.hasCredentials,
        // configError is already a safe, generic message (see config/index.js) — never the key itself.
        config_error: config.gsc.configError,
      },
    }
  );
}

/**
 * Returns an authenticated google-auth-library JWT client, creating it once
 * and reusing it thereafter (matches the "one instance reused" shape already
 * established in this codebase for youtubeTranscriptProvider.js's browser).
 *
 * @returns {JWT|null} null when GSC is disabled — callers should have already
 *   called assertEnabled() and never reach here in that case, but this stays
 *   defensive rather than throwing from a getter.
 */
function getAuthClient() {
  if (!isEnabled()) return null;
  if (cachedClient) return cachedClient;

  try {
    const { client_email: email, private_key: key } = config.gsc.serviceAccount;
    cachedClient = new JWT({ email, key, scopes: [...config.gsc.scopes] });
    return cachedClient;
  } catch (err) {
    // Construction failure (e.g. a structurally-invalid key) — log only the
    // generic message, never the credential object itself.
    logger.error('Failed to construct the GSC auth client.', { message: err.message });
    throw new ApiError(502, 'Could not construct the Google Search Console auth client.', {
      code: 'GSC_AUTH_CLIENT_ERROR',
      details: { provider: 'gsc' },
    });
  }
}

module.exports = {
  isEnabled,
  assertEnabled,
  getAuthClient,
};
