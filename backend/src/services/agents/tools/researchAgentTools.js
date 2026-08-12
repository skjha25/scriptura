'use strict';

/**
 * Tools available to the Research Agent.
 *
 * Unlike imageAgentTools.js/generateAgentTools.js (which propose
 * ScripturaSettings changes), these tools propose NEW ROWS in real domain
 * tables (`automated_topics`, later `scriptura_keywords`). The safety
 * invariant is the same shape but a different endpoint: no tool here ever
 * calls `AutomatedTopic.create`/`ScripturaKeyword.create` itself — it only
 * returns a `{type:'proposed_change', change:{domain, action, ...}}` diff.
 * The only code path allowed to persist these is
 * POST /agents/proposals/apply (controllers/proposals.controller.js).
 */

const MAX_TOPIC_COUNT = 10;
const DEFAULT_TOPIC_COUNT = 5;

const MAX_KEYWORD_COUNT = 15;
const DEFAULT_KEYWORD_COUNT = 5;

// Matches models/scripturaKeyword.js's actual `search_intent` ENUM exactly —
// NOT the 4-value SEARCH_INTENT constant clusters use (which adds
// "commercial"). A proposal picking a value outside this list would look
// valid to the model but fail at apply-time with a raw DB enum error.
const KEYWORD_SEARCH_INTENTS = ['informational', 'transactional', 'navigational'];

const proposeTopics = {
  name: 'propose_topics',
  description:
    'Suggest new trending astrology topics to add to the Autopilot topic pool. Only proposes ' +
    'candidates for the admin to review — never creates them itself. Reuses the same trend-aware ' +
    'prompt the platform already uses for one-click topic suggestions.',
  input_schema: {
    type: 'object',
    properties: {
      count: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_TOPIC_COUNT,
        description: `How many topic candidates to suggest (default ${DEFAULT_TOPIC_COUNT}).`,
      },
    },
  },
  async execute({ count } = {}) {
    const n = Number.isInteger(count) && count > 0 && count <= MAX_TOPIC_COUNT ? count : DEFAULT_TOPIC_COUNT;

    // Lazy require: keeps this module loadable without pulling in the AI
    // provider layer for callers that never hit this path.
    const { getTextProvider } = require('../../ai');
    const provider = getTextProvider();
    const result = await provider.suggestTopics({ count: n });
    const topics = Array.isArray(result?.topics)
      ? result.topics.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
      : [];

    if (topics.length === 0) {
      throw new Error('The model returned no usable topic suggestions.');
    }

    return {
      type: 'proposed_change',
      // `revertible` lives INSIDE `change`, not as a sibling — runAgentTurn.js
      // only forwards `result.change` to the frontend's proposedChanges array,
      // so anything the widget needs to render must travel inside it.
      change: {
        domain: 'topics',
        action: 'topics.create_topics',
        key: 'topics.create_topics',
        current_value: null,
        proposed_value: topics,
        // Not offered as a one-click Revert — the existing Trending Topics
        // page already has a delete button for cleanup, and "undo N creates"
        // is a distinct action, not a symmetric current/proposed-value revert.
        revertible: false,
      },
      message: `Proposed ${topics.length} topic candidate${topics.length === 1 ? '' : 's'} — nothing has been added yet.`,
    };
  },
};

const proposeKeywords = {
  name: 'propose_keywords',
  description:
    'Suggest new SEO keywords for the Keyword Pool, focused on a topic and optionally biased toward ' +
    'a search intent. Builds its own prompt (the platform\'s one-click "Suggest Keywords" button uses ' +
    'a simpler prompt with no count/intent control, so this tool does not reuse it). Only proposes ' +
    'candidates for the admin to review — never adds them itself.',
  input_schema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'Topic or theme to focus keyword suggestions around, e.g. "Vedic Astrology".',
      },
      count: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_KEYWORD_COUNT,
        description: `How many keyword candidates to suggest (default ${DEFAULT_KEYWORD_COUNT}).`,
      },
      search_intent: {
        type: 'string',
        enum: KEYWORD_SEARCH_INTENTS,
        description: 'Bias every suggestion toward this search intent, if given.',
      },
    },
    required: ['topic'],
  },
  async execute({ topic, count, search_intent } = {}) {
    const trimmedTopic = String(topic || '').trim();
    if (!trimmedTopic) throw new Error('topic is required.');

    const n = Number.isInteger(count) && count > 0 && count <= MAX_KEYWORD_COUNT ? count : DEFAULT_KEYWORD_COUNT;
    const intent = KEYWORD_SEARCH_INTENTS.includes(search_intent) ? search_intent : null;

    const prompt = [
      'You are an SEO expert for Divinetalk, an Indian astrology and spirituality platform.',
      `Generate ${n} high-value primary SEO keywords related to: "${trimmedTopic}".`,
      intent ? `Bias every suggestion toward "${intent}" search intent.` : 'Cover a natural mix of search intent.',
      'For each keyword provide 2-4 related secondary/long-tail keywords, and classify its search',
      'intent as exactly one of: informational, transactional, navigational.',
      'Respond ONLY with JSON in this exact shape, nothing else:',
      '{"keywords": [{"primary_keyword": "string", "secondary_keywords": ["string"], "search_intent": "informational|transactional|navigational"}]}',
    ]
      .filter(Boolean)
      .join('\n');

    // Lazy require, same reasoning as propose_topics above.
    const { getTextProvider } = require('../../ai');
    const provider = getTextProvider();
    // `.complete()` matches the exact call shape controllers/keywords.controller.js's
    // existing `suggest` handler already uses for this same provider — reused
    // here rather than re-deriving a new low-level call convention.
    const raw = await provider.complete({
      operation: 'agentProposeKeywords',
      prompt,
      temperature: 0.7,
      maxTokens: 1500,
    });

    let candidates = [];
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        candidates = Array.isArray(parsed.keywords) ? parsed.keywords : [];
      }
    } catch {
      throw new Error('Failed to parse keyword suggestions from the AI provider.');
    }

    const cleaned = candidates
      .filter((k) => k && typeof k.primary_keyword === 'string' && k.primary_keyword.trim())
      .slice(0, n)
      .map((k) => ({
        primary_keyword: k.primary_keyword.trim(),
        secondary_keywords: Array.isArray(k.secondary_keywords)
          ? k.secondary_keywords.filter((s) => typeof s === 'string' && s.trim()).slice(0, 6)
          : [],
        search_intent: KEYWORD_SEARCH_INTENTS.includes(k.search_intent) ? k.search_intent : 'informational',
      }));

    if (cleaned.length === 0) {
      throw new Error('The model returned no usable keyword suggestions.');
    }

    return {
      type: 'proposed_change',
      change: {
        domain: 'keyword_pool',
        action: 'keyword_pool.create_keywords',
        key: 'keyword_pool.create_keywords',
        current_value: null,
        proposed_value: cleaned,
        revertible: false,
      },
      message: `Proposed ${cleaned.length} keyword candidate${cleaned.length === 1 ? '' : 's'} — nothing has been added yet.`,
    };
  },
};

module.exports = {
  TOOLS: [proposeTopics, proposeKeywords],
};
