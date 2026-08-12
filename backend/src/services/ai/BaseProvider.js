'use strict';

/**
 * The text/image provider interface, plus the two pieces of plumbing every real
 * provider needs: tolerant JSON extraction and a retry policy.
 *
 * ---------------------------------------------------------------------------
 * WHY AN ABSTRACT BASE AT ALL
 * ---------------------------------------------------------------------------
 * `AI_TEXT_PROVIDER` and `AI_IMAGE_PROVIDER` are environment switches, so the
 * call sites in services/generation.js and services/brandVoice.js must be able
 * to hold any provider without knowing which one it got. The base class states
 * that contract in one place and fails loudly — not silently returning
 * `undefined` — when a subclass forgets a method.
 *
 * ---------------------------------------------------------------------------
 * WHY WE PARSE JSON DEFENSIVELY
 * ---------------------------------------------------------------------------
 * Every prompt asks for bare JSON. Models mostly comply and sometimes do not:
 * they wrap the object in ```json fences, prepend "Here is the JSON:", or append
 * a closing remark. A naive `JSON.parse` turns each of those into a 500 for the
 * user even though the payload was perfectly good. `extractJson` therefore
 * strips fences and then walks the string for the first *balanced* JSON value,
 * string-literal aware so a brace inside a quoted string does not confuse the
 * depth count.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RETRY POLICY
 * ---------------------------------------------------------------------------
 * 429 and 5xx from an AI provider are overwhelmingly transient — capacity, not
 * a bad request. Retrying them is the difference between "the tool works" and
 * "the tool works most afternoons". 4xx other than 429 is our bug (bad model
 * name, malformed request, missing key) and retrying it just burns latency and
 * money, so it fails immediately.
 *
 * Backoff is exponential with full jitter. Jitter matters because a generation
 * run issues several calls: without it, two calls that hit the same rate limit
 * would retry in lockstep and collide again.
 *
 * `sleep` is injectable so the retry tests assert the policy without spending
 * real seconds.
 */

const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');

/**
 * HTTP statuses worth retrying.
 *   429 — rate limited
 *   500/502/503/504 — provider-side failure or gateway hiccup
 *   529 — Anthropic's "overloaded_error", not in any RFC but very real
 */
const RETRYABLE_STATUS = Object.freeze([429, 500, 502, 503, 504, 529]);

/** Attempts per logical call, including the first. Three is the spec's cap. */
const MAX_ATTEMPTS = 3;

/** First backoff step. Doubles per attempt: ~500ms, ~1s (before jitter). */
const BASE_DELAY_MS = 500;

/** Ceiling on a single backoff wait, so a 529 storm cannot stall a request. */
const MAX_DELAY_MS = 8000;

/** Real sleep. Replaced in tests. */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Full-jitter exponential backoff: a uniform random wait in [0, 2^n * base].
 *
 * Full jitter rather than "base * 2^n + small random" because it is the variant
 * that actually decorrelates concurrent clients (AWS's published analysis), and
 * decorrelation is the whole point when one generation issues several calls.
 *
 * @param {number} attempt 1-based attempt number that just failed.
 * @param {number} [baseDelayMs]
 * @param {() => number} [random] Injectable for deterministic tests.
 * @returns {number} Milliseconds to wait.
 */
function backoffDelayMs(attempt, baseDelayMs = BASE_DELAY_MS, random = Math.random) {
  const ceiling = Math.min(MAX_DELAY_MS, baseDelayMs * 2 ** (attempt - 1));
  return Math.round(random() * ceiling);
}

/**
 * Pulls an HTTP status off whatever an SDK threw.
 *
 * Anthropic and OpenAI both expose `.status`; axios uses `.response.status`;
 * some wrap it in `.statusCode`. Checking all three means the retry decision
 * does not depend on which client raised.
 *
 * @param {*} err
 * @returns {number|undefined}
 */
function statusOf(err) {
  if (!err || typeof err !== 'object') return undefined;
  return err.status ?? err.statusCode ?? err.response?.status ?? undefined;
}

/**
 * True when an error is worth another attempt.
 *
 * Connection resets and timeouts count: the request may never have reached the
 * provider, so it is not a "the provider rejected this" signal at all.
 *
 * @param {*} err
 * @returns {boolean}
 */
function isRetryable(err) {
  const status = statusOf(err);
  if (status !== undefined) return RETRYABLE_STATUS.includes(Number(status));

  const name = String(err?.name || '');
  const code = String(err?.code || '');
  if (name.includes('Timeout') || name === 'APIConnectionError') return true;
  return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE'].includes(code);
}

/**
 * Runs `fn` with the shared retry policy and converts any final failure into an
 * ApiError so no raw SDK error ever reaches the error handler.
 *
 * @param {() => Promise<*>} fn The provider call.
 * @param {object} options
 * @param {string} options.provider Provider name, for the message and logs.
 * @param {string} options.operation What was being attempted, e.g. 'generateArticle'.
 * @param {number} [options.attempts]
 * @param {number} [options.baseDelayMs]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => number} [options.random]
 * @returns {Promise<*>}
 */
async function withRetry(fn, { provider, operation, attempts = MAX_ATTEMPTS, baseDelayMs = BASE_DELAY_MS, sleep = defaultSleep, random = Math.random } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      // An ApiError from inside `fn` is our own deliberate failure (a bad
      // payload shape, for instance). Retrying it would just repeat the same
      // parse against the same body.
      if (err instanceof ApiError) throw err;

      const status = statusOf(err);
      const retryable = isRetryable(err);

      if (!retryable || attempt === attempts) {
        logger.error(`${provider}.${operation} failed`, {
          attempt,
          attempts,
          status,
          retryable,
          message: err?.message,
        });
        throw ApiError.upstream(
          `${provider} request failed after ${attempt} attempt${attempt === 1 ? '' : 's'}` +
            `${status ? ` (HTTP ${status})` : ''}: ${err?.message || 'unknown error'}`,
          {
            code: 'UPSTREAM_ERROR',
            details: { provider, operation, status: status ?? null, attempts: attempt },
            cause: err,
          }
        );
      }

      const delay = backoffDelayMs(attempt, baseDelayMs, random);
      logger.warn(`${provider}.${operation} attempt ${attempt} failed, retrying`, {
        status,
        delayMs: delay,
        message: err?.message,
      });
      await sleep(delay);
    }
  }

  /* istanbul ignore next -- the loop always returns or throws; this is a guard. */
  throw ApiError.upstream(`${provider} request failed.`, { cause: lastError });
}

/**
 * Removes a markdown code fence around a payload.
 *
 * Handles ```json … ```, bare ``` … ```, and an unterminated opening fence
 * (which happens when a response is truncated at max_tokens).
 *
 * @param {string} text
 * @returns {string}
 */
function stripFences(text) {
  const trimmed = String(text).trim();
  const fenced = /^```(?:json|javascript|js)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i.exec(trimmed);
  if (fenced) return fenced[1].trim();
  // Unterminated fence: drop the opener and take the rest.
  const opener = /^```(?:json|javascript|js)?\s*\r?\n?([\s\S]*)$/i.exec(trimmed);
  if (opener) return opener[1].replace(/```\s*$/, '').trim();
  return trimmed;
}

/**
 * Finds the first balanced `{...}` or `[...]` in a string.
 *
 * String-literal aware: a `}` inside `"a } b"` must not close the object, and a
 * `\"` inside a string must not end it. Without that, any article containing a
 * brace in its prose would truncate the parse at the wrong place.
 *
 * @param {string} text
 * @returns {string|null} The substring, or null if nothing balances.
 */
function findFirstJsonValue(text) {
  const source = String(text);

  for (let start = 0; start < source.length; start += 1) {
    const opener = source[start];
    if (opener !== '{' && opener !== '[') continue;

    const closer = opener === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < source.length; i += 1) {
      const ch = source[i];

      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') inString = true;
      else if (ch === opener) depth += 1;
      else if (ch === closer) {
        depth -= 1;
        if (depth === 0) return source.slice(start, i + 1);
      }
    }
    // Unbalanced from this opener — try the next one rather than giving up, so a
    // stray `{` in a preamble does not defeat the real payload behind it.
  }

  return null;
}

/**
 * Parses a model response into a JSON value, tolerating fences and prose.
 *
 * Throws ApiError.upstream rather than a SyntaxError, because from the client's
 * point of view "the model returned something unusable" is an upstream failure,
 * not an internal one.
 *
 * @param {string} raw The model's text output.
 * @param {object} options
 * @param {string} options.provider
 * @param {string} [options.operation]
 * @returns {*} Parsed JSON value.
 */
function extractJson(raw, { provider = 'ai', operation = 'response' } = {}) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw ApiError.upstream(`${provider} returned an empty ${operation}.`, {
      code: 'UPSTREAM_EMPTY_RESPONSE',
      details: { provider, operation },
    });
  }

  const cleaned = stripFences(raw);

  // 1. Try parsing the cleaned text as-is (fast path for well-behaved models).
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through to more tolerant extraction.
  }

  // 2. Try finding a balanced JSON value ({...} or [...]) in the cleaned text.
  const candidate = findFirstJsonValue(cleaned);
  if (candidate !== null) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Fall through.
    }
  }

  // 3. If cleaned didn't work, try the raw string too (handles cases where
  //    stripFences removed a valid fence but the content inside had issues,
  //    or the raw has JSON buried in prose like "Here is the JSON:\n{...}").
  if (cleaned !== raw.trim()) {
    const rawCandidate = findFirstJsonValue(raw);
    if (rawCandidate !== null) {
      try {
        return JSON.parse(rawCandidate);
      } catch {
        // Fall through.
      }
    }
  }

  // 4. Last resort: try to find JSON after common preamble patterns.
  const afterPreamble = raw.replace(/^[\s\S]*?(?:(?:here|below)\s+is|json[:\s]*\n)/i, '').trim();
  if (afterPreamble !== raw.trim()) {
    const preambleCandidate = findFirstJsonValue(afterPreamble);
    if (preambleCandidate !== null) {
      try {
        return JSON.parse(preambleCandidate);
      } catch {
        // Fall through to final error.
      }
    }
  }

  throw ApiError.upstream(`${provider} returned a ${operation} that is not valid JSON.`, {
    code: 'UPSTREAM_BAD_RESPONSE',
    details: {
      provider,
      operation,
      excerpt: cleaned.slice(0, 200),
    },
  });
}

/** Block types that only appear when their SEO toggle is on. */
const TOGGLE_FOR_BLOCK_TYPE = Object.freeze({
  faq_accordion: 'faq',
  table: 'tables',
  key_takeaway: 'key_takeaways',
  quote: 'quotes',
  list: 'lists',
});

/** Inline emphasis tags removed when the `emphasis` toggle is off. */
const EMPHASIS_TAG_RE = /<\/?(?:strong|b|em|i|u)\b[^>]*>/gi;

/**
 * Normalises a model's block array into the exact `{id, type, data}` shape
 * services/blocksToHtml.js renders, and enforces the SEO structure toggles.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS AT THE PROVIDER BOUNDARY
 * ---------------------------------------------------------------------------
 * Prompting is a request, not a guarantee. The prompt already omits disallowed
 * block types (see prompts.blockSchemaFor), but a model that decides an FAQ
 * would help will add one anyway. Filtering here means every provider — real or
 * mock — returns something the editor and the renderer can both accept, and the
 * generation service never has to re-check.
 *
 * Unknown types are dropped rather than passed through: blocksToHtml would
 * silently skip them, which would produce an article whose word count and SEO
 * score disagree with what the reader sees.
 *
 * @param {*} blocks Raw value from the model.
 * @param {object} options
 * @param {object} [options.seoStructure] Toggle map from the wizard.
 * @param {string} [options.provider] For the error message.
 * @param {string[]} options.allowedTypes Usually constants.BLOCK_TYPES.
 * @returns {Array<{id: string, type: string, data: object}>}
 */
function normalizeBlocks(rawBlocksInput, { seoStructure = {}, provider = 'ai', allowedTypes } = {}) {
  let blocks = rawBlocksInput;

  const isBlocksArray = (arr) => 
    Array.isArray(arr) && arr.length > 0 && arr[0] && typeof arr[0] === 'object' && typeof arr[0].type === 'string';
    
  const isNumericObjectBlocks = (obj) => {
    if (Array.isArray(obj) || !obj || typeof obj !== 'object') return false;
    const vals = Object.values(obj);
    return vals.length > 0 && vals[0] && typeof vals[0] === 'object' && typeof vals[0].type === 'string';
  };

  const findBlocksDeep = (obj, depth = 0) => {
    if (depth > 5 || !obj || typeof obj !== 'object') return null;
    
    if (isBlocksArray(obj)) return obj;
    if (isNumericObjectBlocks(obj)) return Object.values(obj);

    const priorityKeys = ['blocks', 'article', 'content', 'data', 'items', 'sections', 'body'];
    
    // First pass: look directly under priority keys (handles correctly named empty arrays too)
    for (const key of priorityKeys) {
      if (Array.isArray(obj[key])) {
        if (obj[key].length === 0 || isBlocksArray(obj[key])) {
           return obj[key];
        }
      }
    }

    // Second pass: deep search within priority keys
    for (const key of priorityKeys) {
      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        const found = findBlocksDeep(obj[key], depth + 1);
        if (found) return found;
      }
    }

    // Third pass: deep search everywhere else
    for (const key of Object.keys(obj)) {
      if (!priorityKeys.includes(key) && obj[key] && typeof obj[key] === 'object') {
        const found = findBlocksDeep(obj[key], depth + 1);
        if (found) return found;
      }
    }
    
    return null;
  };

  const foundBlocks = findBlocksDeep(blocks);
  if (foundBlocks) {
    blocks = foundBlocks;
  }

  if (!Array.isArray(blocks)) {
    throw ApiError.upstream(`${provider} returned an article without a blocks array.`, {
      code: 'UPSTREAM_BAD_RESPONSE',
      details: { provider, received: typeof rawBlocksInput },
    });
  }

  const structure = seoStructure || {};
  const allowed = new Set(allowedTypes || []);
  const out = [];

  for (const raw of blocks) {
    if (!raw || typeof raw !== 'object') continue;

    const type = typeof raw.type === 'string' ? raw.type.trim() : '';
    if (!allowed.has(type)) continue;

    const toggle = TOGGLE_FOR_BLOCK_TYPE[type];
    if (toggle && structure[toggle] === false) continue;

    const data = raw.data && typeof raw.data === 'object' ? { ...raw.data } : {};

    // Auto-correct LLM placing HTML in the `text` field instead of the `html` field.
    if (typeof data.text === 'string' && (!data.html || typeof data.html !== 'string')) {
      if (/<[a-z\/][^>]*>/i.test(data.text)) {
        data.html = data.text;
        delete data.text;
      }
    }

    // h3 off means "no third level", but the section's prose still belongs in
    // the article — so the heading is promoted rather than the content dropped.
    if (type === 'heading') {
      const level = Number.parseInt(data.level, 10);
      data.level = structure.h3 === false ? 2 : Number.isFinite(level) ? level : 2;
    }

    if (structure.emphasis === false && typeof data.html === 'string') {
      data.html = data.html.replace(EMPHASIS_TAG_RE, '');
    }

    out.push({
      // Ids must be stable within one article so the editor can key React rows
      // off them; sequential is enough because blocks are only ever reordered
      // client-side after this point.
      id: typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : `blk_${out.length + 1}`,
      type,
      data,
    });
  }

  if (out.length === 0) {
    throw ApiError.upstream(`${provider} returned no usable content blocks.`, {
      code: 'UPSTREAM_EMPTY_ARTICLE',
      details: { provider, receivedBlocks: blocks.length },
    });
  }

  return out;
}

/**
 * Abstract provider.
 *
 * Text providers implement generateTitles / analyzeBrandVoice / generateOutline /
 * generateArticle. Image providers implement generateImage. A provider that does
 * both (none today, but OpenAI could) simply implements all five.
 */
class BaseProvider {
  /**
   * @param {object} options
   * @param {string} options.name Stable provider id: 'anthropic' | 'openai' | 'mock'.
   * @param {(ms: number) => Promise<void>} [options.sleep] Injected for tests.
   * @param {() => number} [options.random] Injected for tests.
   */
  constructor({ name, sleep = defaultSleep, random = Math.random } = {}) {
    if (!name) throw new Error('A provider must declare a name.');
    this.name = name;
    this.sleep = sleep;
    this.random = random;
  }

  /** Runs `fn` under this provider's retry policy. */
  run(operation, fn) {
    return withRetry(fn, {
      provider: this.name,
      operation,
      sleep: this.sleep,
      random: this.random,
    });
  }

  /** Parses a model response with this provider's name attached to any error. */
  parse(raw, operation) {
    return extractJson(raw, { provider: this.name, operation });
  }

  /** @private Signals a subclass gap as a programming error, not a 502. */
  notImplemented(method) {
    throw new Error(`${this.constructor.name} does not implement ${method}().`);
  }

  // -------------------------------------------------------------------------
  // Text interface
  // -------------------------------------------------------------------------

  /**
   * @param {object} opts See prompts.titlesPrompt.
   * @returns {Promise<{titles: Array<{title: string, angle?: string}>}>}
   */
  async generateTitles(opts) {
    return this.notImplemented('generateTitles', opts);
  }

  /**
   * @param {{count?: number}} opts
   * @returns {Promise<{topics: string[]}>}
   */
  async suggestTopics(opts) {
    return this.notImplemented('suggestTopics', opts);
  }

  /**
   * @param {{sample: string}} opts
   * @returns {Promise<{tone: string, pov: string, traits: string[], summary: string}>}
   */
  async analyzeBrandVoice(opts) {
    return this.notImplemented('analyzeBrandVoice', opts);
  }

  /**
   * One-shot, vision-capable knowledge extraction — used by the Knowledge &
   * Learning Layer (services/agents/knowledge/knowledgeExtraction.js) to turn
   * admin-fed sources (text/links/images/video transcripts) into structured
   * candidate knowledge claims. Separate from `runAgentStep` (the tool-use
   * loop) and `complete` (always uses the shared SYSTEM_PROMPT) because this
   * needs a caller-supplied system prompt (parameterized by the target
   * agent's persona) and optional image content blocks — neither of which
   * either of those support today.
   *
   * @param {object} opts
   * @param {string} opts.systemPrompt
   * @param {string} opts.textContent Already-fenced, already-clamped combined text.
   * @param {Array<{mediaType: string, base64: string}>} [opts.images]
   * @returns {Promise<{raw: string, parsed: object}>}
   */
  async analyzeKnowledgeSample(opts) {
    return this.notImplemented('analyzeKnowledgeSample', opts);
  }

  /**
   * @param {object} opts See prompts.outlinePrompt.
   * @returns {Promise<{outline: Array<{level: number, text: string}>}>}
   */
  async generateOutline(opts) {
    return this.notImplemented('generateOutline', opts);
  }

  /**
   * @param {object} opts See prompts.articlePrompt.
   * @returns {Promise<{blocks: Array<{id: string, type: string, data: object}>, meta_title?: string, meta_description?: string}>}
   */
  async generateArticle(opts) {
    return this.notImplemented('generateArticle', opts);
  }

  // -------------------------------------------------------------------------
  // Image interface
  // -------------------------------------------------------------------------

  /**
   * @param {{prompt: string, size?: string, style?: string}} opts
   * @returns {Promise<{buffer: Buffer, mimeType: string}>}
   */
  async generateImage(opts) {
    return this.notImplemented('generateImage', opts);
  }

  // -------------------------------------------------------------------------
  // Agentic chat interface
  // -------------------------------------------------------------------------

  /**
   * Runs ONE step of a tool-use conversation — a single Messages API call that
   * either invokes a tool or produces a final reply. Deliberately not a loop:
   * the caller (services/agents/runAgentTurn.js) owns the multi-turn loop and
   * tool execution, the same way every other multi-step business decision in
   * this codebase lives in services/, never inside a provider. Returning raw
   * tool_use for the orchestrator to execute keeps "did this setting actually
   * get applied" a service-layer safety decision, not something trusted to
   * however a provider happens to stop.
   *
   * A single step may request MULTIPLE tools at once — Claude is free to do
   * this, and the Messages API requires every `tool_use` block to have a
   * matching `tool_result` in the very next message, all together. So
   * `toolUses` is always an array (possibly empty), never a single value, and
   * the caller must resolve every entry before continuing the conversation.
   *
   * @param {object} opts
   * @param {string} opts.systemPrompt
   * @param {Array<{name: string, description: string, input_schema: object}>} opts.tools
   * @param {Array<{role: string, content: *}>} opts.messages Running conversation, including any prior tool_use/tool_result blocks.
   * @param {number} [opts.maxTokens]
   * @returns {Promise<{stopReason: string, text: string|null, toolUses: Array<{id: string, name: string, input: object}>, rawAssistantContent: Array}>}
   */
  async runAgentStep(opts) {
    return this.notImplemented('runAgentStep', opts);
  }
}

module.exports = {
  BaseProvider,
  withRetry,
  extractJson,
  stripFences,
  findFirstJsonValue,
  normalizeBlocks,
  backoffDelayMs,
  isRetryable,
  statusOf,
  defaultSleep,
  RETRYABLE_STATUS,
  MAX_ATTEMPTS,
  BASE_DELAY_MS,
  MAX_DELAY_MS,
  TOGGLE_FOR_BLOCK_TYPE,
};
