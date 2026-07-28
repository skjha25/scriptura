'use strict';

/**
 * Provider factory.
 *
 * ---------------------------------------------------------------------------
 * WHY A FACTORY AND NOT DIRECT IMPORTS
 * ---------------------------------------------------------------------------
 * Call sites (services/generation.js, services/brandVoice.js, the media
 * workstream's image pipeline) must not know which vendor is configured — that
 * is the whole reason the provider layer exists. They ask for "the text
 * provider" and get whatever `AI_TEXT_PROVIDER` selected.
 *
 * ---------------------------------------------------------------------------
 * WHY INSTANCES ARE CACHED
 * ---------------------------------------------------------------------------
 * Each real provider owns an SDK client, which owns an HTTP agent and its
 * connection pool. Constructing one per request would throw that pool away every
 * time and add a TLS handshake to every generation. One instance per process is
 * correct and safe: the clients are stateless with respect to requests.
 *
 * `resetProviders()` exists because the cache is process-global, which is
 * exactly what a test that swaps `config.ai.textProvider` needs to clear.
 *
 * ---------------------------------------------------------------------------
 * WHY REQUIRES ARE LAZY
 * ---------------------------------------------------------------------------
 * `require('@anthropic-ai/sdk')` and `require('openai')` are not free, and a
 * deployment running the mock provider (or the test suite, which always does)
 * should not load either. Requiring inside the branch means only the selected
 * vendor's SDK is ever pulled in.
 */

const config = require('../../config');
const logger = require('../../utils/logger');

/** Provider ids accepted by AI_TEXT_PROVIDER / AI_IMAGE_PROVIDER. */
const PROVIDERS = Object.freeze({
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  MOCK: 'mock',
});

/** Cached instances, keyed by role. Cleared by resetProviders(). */
const cache = {
  text: null,
  image: null,
};

/**
 * Instantiates a provider by id.
 *
 * An unknown id falls back to the mock with a warning rather than throwing: a
 * typo in `.env` should leave the app running and obviously degraded, not dead
 * on boot. Every AI-dependent surface then behaves exactly as it does on a
 * keyless dev machine, which is a state the team already understands.
 *
 * @param {string} id
 * @param {string} role 'text' | 'image', used only in the warning.
 * @returns {import('./BaseProvider').BaseProvider}
 */
function instantiate(id, role) {
  switch (id) {
    case PROVIDERS.ANTHROPIC: {
      const { AnthropicProvider } = require('./AnthropicProvider');
      return new AnthropicProvider();
    }
    case PROVIDERS.OPENAI: {
      const { OpenAIProvider } = require('./OpenAIProvider');
      return new OpenAIProvider();
    }
    case PROVIDERS.MOCK: {
      const { MockProvider } = require('./MockProvider');
      return new MockProvider();
    }
    default: {
      logger.warn(`Unknown ${role} provider "${id}" — falling back to the mock provider.`, {
        configured: id,
        supported: Object.values(PROVIDERS),
      });
      const { MockProvider } = require('./MockProvider');
      return new MockProvider();
    }
  }
}

/**
 * The configured text provider: titles, brand voice, outlines, articles.
 * @returns {import('./BaseProvider').BaseProvider}
 */
function getTextProvider() {
  if (!cache.text) {
    cache.text = instantiate(config.ai.textProvider, 'text');
    logger.debug(`Text provider ready: ${cache.text.name}`);
  }
  return cache.text;
}

/**
 * The configured image provider.
 *
 * Kept separate from the text provider because the sensible default pairs two
 * different vendors — Claude writes better copy, OpenAI's image model is the one
 * with an API we can use — and forcing a single choice would mean giving one up.
 *
 * @returns {import('./BaseProvider').BaseProvider}
 */
function getImageProvider() {
  if (!cache.image) {
    cache.image = instantiate(config.ai.imageProvider, 'image');
    logger.debug(`Image provider ready: ${cache.image.name}`);
  }
  return cache.image;
}

/**
 * Drops the cached instances.
 *
 * For tests that need a fresh provider — typically after stubbing the SDK or
 * after overriding which provider is selected. Not called anywhere in
 * production code; a running process has exactly one configuration.
 */
function resetProviders() {
  cache.text = null;
  cache.image = null;
}

/**
 * Overrides the cached instances directly.
 *
 * Narrow escape hatch for integration tests that need a provider which fails on
 * demand (to exercise the generation failure/retry path) without monkey-patching
 * a shared module's exports. Production code never calls it.
 *
 * @param {{text?: object, image?: object}} providers
 */
function setProviders({ text, image } = {}) {
  if (text !== undefined) cache.text = text;
  if (image !== undefined) cache.image = image;
}

module.exports = {
  PROVIDERS,
  getTextProvider,
  getImageProvider,
  resetProviders,
  setProviders,
};
