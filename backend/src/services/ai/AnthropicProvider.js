'use strict';

/**
 * Anthropic (Claude) text provider — the primary provider for every text task.
 *
 * ---------------------------------------------------------------------------
 * WHY maxRetries: 0 ON THE SDK CLIENT
 * ---------------------------------------------------------------------------
 * The SDK retries twice by default. Leaving that on would compose with our own
 * retry loop and give up to 3 x 3 = 9 real requests per logical call, with a
 * backoff schedule nobody chose and no logging of the inner attempts. Retrying
 * is a policy decision, so it lives in exactly one place: BaseProvider.withRetry.
 *
 * ---------------------------------------------------------------------------
 * JSON OUTPUT RELIABILITY
 * ---------------------------------------------------------------------------
 * Every prompt asks for bare JSON and includes explicit instructions to output
 * ONLY JSON with no preamble or commentary. The extractJson() function in
 * BaseProvider handles edge cases where models still wrap output in markdown
 * fences or add prose. This two-layer approach (prompt discipline + tolerant
 * parsing) works without assistant message prefill, which newer Claude models
 * do not support.
 *
 * ---------------------------------------------------------------------------
 * THINKING AND SAMPLING (Claude Sonnet 5+)
 * ---------------------------------------------------------------------------
 * Claude Sonnet 5 introduced breaking changes:
 *   - Adaptive thinking is ON by default. When thinking is on, `max_tokens` is
 *     a hard limit on TOTAL output (thinking + response text). Without disabling
 *     it, the model can spend most of the token budget thinking and return an
 *     empty text response — producing the "Anthropic returned no text content"
 *     error that caused all blog generations to fail.
 *   - `temperature`, `top_p`, and `top_k` set to non-default values now return
 *     a 400 error. These parameters are silently ignored via OpenRouter but
 *     rejected by the direct Anthropic API.
 *
 * The fix: explicitly disable thinking (this app needs JSON output, not
 * chain-of-thought) and omit sampling parameters entirely.
 */

const Anthropic = require('@anthropic-ai/sdk');

const { BaseProvider, normalizeBlocks } = require('./BaseProvider');
const prompts = require('./prompts');
const config = require('../../config');
const ApiError = require('../../utils/ApiError');
const { BLOCK_TYPES, DEFAULT_SEO_STRUCTURE } = require('../../constants');

/**
 * Per-task sampling temperature. Retained for use with models that support it
 * (pre-Sonnet 5). Claude Sonnet 5+ rejects non-default values with a 400, so
 * the `complete()` method only sends temperature when the model supports it.
 */
const TEMPERATURE = Object.freeze({
  titles: 0.9,
  brandVoice: 0.1,
  outline: 0.6,
  article: 0.7,
});

/**
 * Models that reject sampling parameters (temperature, top_p, top_k).
 * Claude Sonnet 5 and above use adaptive thinking and no longer accept these.
 */
const MODELS_WITHOUT_SAMPLING = ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5', 'claude-mythos-5'];

/**
 * Token budgets per task. Titles and a brand-voice summary are tiny; an article
 * needs the configured ceiling. Asking for less than the model might produce is
 * how you get a truncated JSON object, so these are generous.
 */
const MAX_TOKENS = Object.freeze({
  titles: 8192,
  brandVoice: 8192,
  outline: 8192,
});

class AnthropicProvider extends BaseProvider {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey] Defaults to config.ai.anthropic.apiKey.
   * @param {string} [options.model]
   * @param {number} [options.maxTokens]
   * @param {number} [options.timeoutMs]
   * @param {object} [options.client] Pre-built SDK client, for tests.
   * @param {(ms: number) => Promise<void>} [options.sleep]
   * @param {() => number} [options.random]
   */
  constructor({ apiKey, model, maxTokens, timeoutMs, client, sleep, random } = {}) {
    super({ name: 'anthropic', sleep, random });

    this.model = model || config.ai.anthropic.model;
    this.maxTokens = maxTokens || config.ai.anthropic.maxTokens;
    this.timeoutMs = timeoutMs || config.ai.requestTimeoutMs;

    const key = apiKey || config.ai.anthropic.apiKey;
    if (!client && !key) {
      // config downgrades to the mock provider when the key is absent, so
      // reaching here means someone constructed this class directly. Fail at
      // construction rather than on the first billed call.
      throw new Error(
        'AnthropicProvider requires an API key. Set ANTHROPIC_API_KEY or use the mock provider.'
      );
    }

    this.client =
      client ||
      new Anthropic({
        apiKey: key,
        timeout: this.timeoutMs,
        maxRetries: 0,
      });
  }

  /**
   * One Messages API call, returning the concatenated text content.
   *
   * @private
   * @param {object} options
   * @param {string} options.operation Name used in logs and error details.
   * @param {string} options.prompt User-turn content.
   * @param {number} options.temperature
   * @param {number} options.maxTokens
   * @returns {Promise<string>}
   */
  async complete({ operation, prompt, temperature, maxTokens }) {
    return this.run(operation, async () => {
      const requestBody = {
        model: this.model,
        max_tokens: maxTokens,
        system: prompts.SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: prompt },
        ],
      };

      // Claude Sonnet 5+ has adaptive thinking ON by default. When thinking is
      // on, max_tokens is shared between thinking tokens and response text,
      // which causes empty text responses when the model spends its entire
      // budget thinking. Explicitly disable thinking for structured JSON output.
      const modelRequiresThinkingDisable = MODELS_WITHOUT_SAMPLING.some(
        (m) => this.model.startsWith(m)
      );
      if (modelRequiresThinkingDisable) {
        requestBody.thinking = { type: 'disabled' };
      } else if (temperature !== undefined) {
        // Only send temperature for models that support it.
        requestBody.temperature = temperature;
      }

      const response = await this.client.messages.create(
        requestBody,
        { timeout: this.timeoutMs }
      );

      const text = (response?.content || [])
        .filter((part) => part && part.type === 'text')
        .map((part) => part.text)
        .join('');

      if (!text || text.trim() === '') {
        throw ApiError.upstream('Anthropic returned no text content.', {
          code: 'UPSTREAM_EMPTY_RESPONSE',
          details: {
            provider: this.name,
            operation,
            stopReason: response?.stop_reason ?? null,
            contentTypes: (response?.content || []).map((p) => p?.type).filter(Boolean),
          },
        });
      }

      return text;
    });
  }

  async suggestTopics(opts = {}) {
    const raw = await this.complete({
      operation: 'suggestTopics',
      prompt: prompts.suggestTopicsPrompt(opts.count || 5),
      temperature: 0.9,
      maxTokens: 1024,
    });
    
    const parsed = this.parse(raw, 'topics response');
    const topics = Array.isArray(parsed?.topics) ? parsed.topics : [];
    
    return {
      topics: topics
        .filter((t) => typeof t === 'string' && t.trim() !== '')
        .map((t) => t.trim()),
    };
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
    const titles = Array.isArray(parsed?.titles) ? parsed.titles : [];

    const cleaned = titles
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
      throw ApiError.upstream('Anthropic returned no usable titles.', {
        code: 'UPSTREAM_EMPTY_RESPONSE',
        details: { provider: this.name, operation: 'generateTitles' },
      });
    }

    return { titles: cleaned };
  }

  /**
   * Derives a brand voice from a writing sample.
   * @param {{sample: string}} opts
   * @returns {Promise<object>} Raw parsed object; brandVoice.parseBrandVoiceResponse shapes it.
   */
  async analyzeBrandVoice(opts = {}) {
    const raw = await this.complete({
      operation: 'analyzeBrandVoice',
      prompt: prompts.brandVoicePrompt(opts),
      temperature: TEMPERATURE.brandVoice,
      maxTokens: MAX_TOKENS.brandVoice,
    });

    // Returned unparsed-into-shape on purpose: services/brandVoice.js owns the
    // tolerant coercion and is the unit-tested place for it, so every provider
    // funnels through one parser instead of three near-copies.
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
    const sections = Array.isArray(parsed?.outline) ? parsed.outline : [];

    const cleaned = sections
      .map((section) => {
        const text = typeof section === 'string' ? section : section?.text;
        if (typeof text !== 'string' || text.trim() === '') return null;
        const level = Number.parseInt(section?.level, 10);
        return { level: level === 3 ? 3 : 2, text: text.trim() };
      })
      .filter(Boolean);

    if (cleaned.length === 0) {
      throw ApiError.upstream('Anthropic returned an empty outline.', {
        code: 'UPSTREAM_EMPTY_RESPONSE',
        details: { provider: this.name, operation: 'generateOutline' },
      });
    }

    return { outline: cleaned };
  }

  /**
   * Generates the article body as a block list.
   * @param {object} opts See prompts.articlePrompt.
   * @returns {Promise<{blocks: Array<{id: string, type: string, data: object}>, meta_title: string|null, meta_description: string|null}>}
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
      blocks: normalizeBlocks(parsed?.blocks || parsed, {
        seoStructure,
        provider: this.name,
        allowedTypes: BLOCK_TYPES,
      }),
      meta_title: typeof parsed?.meta_title === 'string' ? parsed.meta_title.trim() : null,
      meta_description:
        typeof parsed?.meta_description === 'string' ? parsed.meta_description.trim() : null,
    };
  }

  async generateAutoTopicFromKeyword(opts = {}) {
    const raw = await this.complete({
      operation: 'generateAutoTopicFromKeyword',
      prompt: prompts.suggestTopicsFromKeywordPrompt(opts),
      temperature: 0.7,
      maxTokens: 1024,
    });
    
    const parsed = this.parse(raw, 'auto topic from keyword response');
    
    const titles = Array.isArray(parsed?.titles) ? parsed.titles : [];
    const suggested_secondary_keywords = Array.isArray(parsed?.secondary_keywords) ? parsed.secondary_keywords : [];
    const topic = typeof parsed?.topic === 'string' ? parsed.topic : opts.keyword;

    return {
      topic,
      suggested_secondary_keywords,
      titles,
    };
  }
}

module.exports = { AnthropicProvider, TEMPERATURE, MAX_TOKENS };
