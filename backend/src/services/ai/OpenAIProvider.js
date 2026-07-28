'use strict';

/**
 * OpenAI provider — the image provider by default, and a drop-in text provider.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IMPLEMENTS BOTH INTERFACES
 * ---------------------------------------------------------------------------
 * Images are OpenAI's job in the default configuration (`AI_IMAGE_PROVIDER=openai`),
 * but the whole point of the provider layer is that `AI_TEXT_PROVIDER=openai`
 * has to work too — that is the fallback if Anthropic is unavailable or if
 * Divinetalk's contract changes. So the four text methods are implemented for
 * real against Chat Completions, using the same prompts and the same retry
 * policy, not stubbed out.
 *
 * ---------------------------------------------------------------------------
 * WHY response_format: json_object
 * ---------------------------------------------------------------------------
 * It is the provider-native version of what the Anthropic path achieves with an
 * assistant prefill: it removes the prose preamble class of failure entirely.
 * extractJson still runs, because "guaranteed JSON" is guaranteed syntax, not a
 * guaranteed shape.
 *
 * ---------------------------------------------------------------------------
 * WHY A REAL Buffer COMES BACK
 * ---------------------------------------------------------------------------
 * `gpt-image-1` returns base64. Handing a base64 *string* up to the storage
 * layer would mean every consumer has to remember to decode it, and one that
 * forgets writes a text file with a .png extension. Decoding at the boundary
 * makes the interface honest: `{ buffer, mimeType }`, always bytes.
 */

const OpenAI = require('openai');
const axios = require('axios');

const { BaseProvider, normalizeBlocks } = require('./BaseProvider');
const prompts = require('./prompts');
const config = require('../../config');
const ApiError = require('../../utils/ApiError');
const { BLOCK_TYPES, DEFAULT_SEO_STRUCTURE } = require('../../constants');

/** Text model used when OpenAI is selected as the text provider. */
const DEFAULT_TEXT_MODEL = 'gpt-4o';

/** Default image geometry: 16:9-ish, matching the editorial crop we ask for. */
const DEFAULT_IMAGE_SIZE = '1536x1024';

/** Sizes the image API accepts. Anything else is rejected before the call. */
const ALLOWED_IMAGE_SIZES = Object.freeze([
  '1024x1024',
  '1024x1536',
  '1536x1024',
  '1792x1024',
  '1024x1792',
  'auto',
]);

/** Mirrors AnthropicProvider.TEMPERATURE; see that file's header for the reasoning. */
const TEMPERATURE = Object.freeze({
  titles: 0.9,
  brandVoice: 0.1,
  outline: 0.6,
  article: 0.7,
});

const MAX_TOKENS = Object.freeze({
  titles: 1024,
  brandVoice: 1024,
  outline: 2048,
});

class OpenAIProvider extends BaseProvider {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey]
   * @param {string} [options.textModel]
   * @param {string} [options.imageModel]
   * @param {number} [options.maxTokens]
   * @param {number} [options.timeoutMs]
   * @param {object} [options.client] Pre-built SDK client, for tests.
   * @param {(ms: number) => Promise<void>} [options.sleep]
   * @param {() => number} [options.random]
   */
  constructor({ apiKey, textModel, imageModel, maxTokens, timeoutMs, client, sleep, random } = {}) {
    super({ name: 'openai', sleep, random });

    this.textModel = textModel || DEFAULT_TEXT_MODEL;
    this.imageModel = imageModel || config.ai.openai.imageModel;
    this.maxTokens = maxTokens || config.ai.anthropic.maxTokens;
    this.timeoutMs = timeoutMs || config.ai.requestTimeoutMs;

    const key = apiKey || config.ai.openai.apiKey;
    if (!client && !key) {
      throw new Error(
        'OpenAIProvider requires an API key. Set OPENAI_API_KEY or use the mock provider.'
      );
    }

    this.client =
      client ||
      new OpenAI({
        apiKey: key,
        timeout: this.timeoutMs,
        // Retries are BaseProvider's job — see AnthropicProvider's header.
        maxRetries: 0,
      });
  }

  /**
   * One Chat Completions call constrained to a JSON object response.
   *
   * @private
   * @param {object} options
   * @param {string} options.operation
   * @param {string} options.prompt
   * @param {number} options.temperature
   * @param {number} options.maxTokens
   * @returns {Promise<string>}
   */
  async complete({ operation, prompt, temperature, maxTokens }) {
    return this.run(operation, async () => {
      const response = await this.client.chat.completions.create(
        {
          model: this.textModel,
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: prompts.SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
        },
        { timeout: this.timeoutMs }
      );

      const text = response?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || text.trim() === '') {
        throw ApiError.upstream('OpenAI returned no message content.', {
          code: 'UPSTREAM_EMPTY_RESPONSE',
          details: {
            provider: this.name,
            operation,
            finishReason: response?.choices?.[0]?.finish_reason ?? null,
          },
        });
      }
      return text;
    });
  }

  /**
   * Generates SEO title candidates.
   * @param {object} opts See prompts.titlesPrompt.
   * @returns {Promise<{titles: Array<{title: string, angle: string|null, char_count: number}>}>}
   */
  async generateTitles(opts = {}) {
    const raw = await this.complete({
      operation: 'generateTitles',
      prompt: prompts.titlesPrompt(opts),
      temperature: TEMPERATURE.titles,
      maxTokens: MAX_TOKENS.titles,
    });

    const parsed = this.parse(raw, 'titles response');
    const cleaned = (Array.isArray(parsed?.titles) ? parsed.titles : [])
      .map((entry) => {
        const title = typeof entry === 'string' ? entry : entry?.title;
        if (typeof title !== 'string' || title.trim() === '') return null;
        return {
          title: title.trim(),
          angle: typeof entry?.angle === 'string' ? entry.angle.trim() : null,
          char_count: title.trim().length,
        };
      })
      .filter(Boolean);

    if (cleaned.length === 0) {
      throw ApiError.upstream('OpenAI returned no usable titles.', {
        code: 'UPSTREAM_EMPTY_RESPONSE',
        details: { provider: this.name, operation: 'generateTitles' },
      });
    }

    return { titles: cleaned };
  }

  /**
   * Derives a brand voice from a writing sample.
   * @param {{sample: string}} opts
   * @returns {Promise<{raw: string, parsed: object}>}
   */
  async analyzeBrandVoice(opts = {}) {
    const raw = await this.complete({
      operation: 'analyzeBrandVoice',
      prompt: prompts.brandVoicePrompt(opts),
      temperature: TEMPERATURE.brandVoice,
      maxTokens: MAX_TOKENS.brandVoice,
    });
    return { raw, parsed: this.parse(raw, 'brand voice response') };
  }

  /**
   * Generates a section outline.
   * @param {object} opts See prompts.outlinePrompt.
   * @returns {Promise<{outline: Array<{level: number, text: string}>}>}
   */
  async generateOutline(opts = {}) {
    const raw = await this.complete({
      operation: 'generateOutline',
      prompt: prompts.outlinePrompt(opts),
      temperature: TEMPERATURE.outline,
      maxTokens: MAX_TOKENS.outline,
    });

    const parsed = this.parse(raw, 'outline response');
    const cleaned = (Array.isArray(parsed?.outline) ? parsed.outline : [])
      .map((section) => {
        const text = typeof section === 'string' ? section : section?.text;
        if (typeof text !== 'string' || text.trim() === '') return null;
        const level = Number.parseInt(section?.level, 10);
        return { level: level === 3 ? 3 : 2, text: text.trim() };
      })
      .filter(Boolean);

    if (cleaned.length === 0) {
      throw ApiError.upstream('OpenAI returned an empty outline.', {
        code: 'UPSTREAM_EMPTY_RESPONSE',
        details: { provider: this.name, operation: 'generateOutline' },
      });
    }

    return { outline: cleaned };
  }

  /**
   * Generates the article body as a block list.
   * @param {object} opts See prompts.articlePrompt.
   * @returns {Promise<{blocks: Array, meta_title: string|null, meta_description: string|null}>}
   */
  async generateArticle(opts = {}) {
    const seoStructure = { ...DEFAULT_SEO_STRUCTURE, ...(opts.seoStructure || {}) };

    const raw = await this.complete({
      operation: 'generateArticle',
      prompt: prompts.articlePrompt({ ...opts, seoStructure }),
      temperature: TEMPERATURE.article,
      maxTokens: this.maxTokens,
    });

    const parsed = this.parse(raw, 'article response');

    return {
      blocks: normalizeBlocks(parsed?.blocks, {
        seoStructure,
        provider: this.name,
        allowedTypes: BLOCK_TYPES,
      }),
      meta_title: typeof parsed?.meta_title === 'string' ? parsed.meta_title.trim() : null,
      meta_description:
        typeof parsed?.meta_description === 'string' ? parsed.meta_description.trim() : null,
    };
  }

  /**
   * Generates one illustration.
   *
   * @param {object} opts
   * @param {string} opts.prompt Text prompt; build it with prompts.imagePrompt.
   * @param {string} [opts.size] One of ALLOWED_IMAGE_SIZES.
   * @param {string} [opts.style] Passed through for prompt shaping by the caller.
   * @returns {Promise<{buffer: Buffer, mimeType: string}>}
   */
  async generateImage({ prompt, size = DEFAULT_IMAGE_SIZE } = {}) {
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw ApiError.badRequest('An image prompt is required.', { code: 'IMAGE_PROMPT_REQUIRED' });
    }
    const requestedSize = ALLOWED_IMAGE_SIZES.includes(size) ? size : DEFAULT_IMAGE_SIZE;

    return this.run('generateImage', async () => {
      const response = await this.client.images.generate(
        {
          model: this.imageModel,
          prompt: prompt.trim(),
          n: 1,
          size: requestedSize,
        },
        { timeout: this.timeoutMs }
      );

      const item = response?.data?.[0];
      if (!item) {
        throw ApiError.upstream('OpenAI returned no image data.', {
          code: 'UPSTREAM_EMPTY_RESPONSE',
          details: { provider: this.name, operation: 'generateImage' },
        });
      }

      if (typeof item.b64_json === 'string' && item.b64_json !== '') {
        return {
          buffer: Buffer.from(item.b64_json, 'base64'),
          mimeType: 'image/png',
        };
      }

      // Older image models (and `dall-e-3` with the default response_format)
      // hand back a short-lived URL instead of bytes. Fetching it here keeps the
      // interface's promise of a Buffer regardless of which model is configured.
      if (typeof item.url === 'string' && item.url !== '') {
        const download = await axios.get(item.url, {
          responseType: 'arraybuffer',
          timeout: this.timeoutMs,
          maxContentLength: 20 * 1024 * 1024,
        });
        return {
          buffer: Buffer.from(download.data),
          mimeType: download.headers?.['content-type'] || 'image/png',
        };
      }

      throw ApiError.upstream('OpenAI returned an image without bytes or a URL.', {
        code: 'UPSTREAM_BAD_RESPONSE',
        details: { provider: this.name, operation: 'generateImage', keys: Object.keys(item) },
      });
    });
  }
}

module.exports = {
  OpenAIProvider,
  DEFAULT_TEXT_MODEL,
  DEFAULT_IMAGE_SIZE,
  ALLOWED_IMAGE_SIZES,
  TEMPERATURE,
  MAX_TOKENS,
};
