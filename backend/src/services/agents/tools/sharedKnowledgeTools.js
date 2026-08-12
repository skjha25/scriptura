'use strict';

/**
 * Shared read-only tools that let an agent honestly answer "what do you
 * know" and "what have you learned" — see
 * /home/shivam/.claude/plans/zazzy-doodling-wadler.md §6/§11.
 *
 * Added to every agent's tool array EXCEPT generate_agent, which already has
 * its own equivalent (`get_current_style_profile` in generateAgentTools.js)
 * pointed at its own separate `agents.generate.style_profile` mechanism —
 * adding a second, differently-shaped "knowledge" tool to it would just give
 * the model two tools to choose between for the same kind of question.
 *
 * `agentName` is always taken from the closure (baked in when `registry.js`
 * calls `makeKnowledgeTools(AGENT_NAMES.X)`), never from model-supplied tool
 * input — otherwise a crafted prompt could trick one agent into reading
 * another agent's scoped knowledge across the tool boundary.
 */

const knowledgeStore = require('../knowledge/knowledgeStore');

const CURRENT_KNOWLEDGE_LIMIT = 30;
const RECENT_LEARNING_DEFAULT_LIMIT = 5;
const RECENT_LEARNING_MAX_LIMIT = 20;

const KNOWLEDGE_TYPES = [
  'fact',
  'strategy',
  'procedure',
  'observation',
  'hypothesis',
  'opinion',
  'guideline',
  'terminology',
  'pattern',
  'source_reliability',
];

/**
 * `created_at` is stored/returned in UTC (standard, correct). Left as a raw
 * Date/ISO string, a model reading it has no reason to know it needs a
 * +05:30 conversion before presenting it as a time of day — same bug class
 * as the cluster-scheduling one fixed earlier (backend/src/services/agents/tools/clusterAgentTools.js's
 * withIstOffset): a timezone-naive value crossing into the model's hands
 * reads back wrong. Fixed the same way — convert here, in code, before it
 * ever reaches the model, so the model only ever relays an already-correct
 * string instead of doing timezone math itself.
 */
const IST_DATETIME_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function formatIst(date) {
  return `${IST_DATETIME_FORMATTER.format(new Date(date))} IST`;
}

function makeKnowledgeTools(agentName) {
  const getCurrentKnowledge = {
    name: 'get_current_knowledge',
    description:
      "Read this agent's current confirmed knowledge (global + its own) — what it has learned from " +
      'admin-taught sources and how confident it is in each claim. Use this whenever asked "what do you ' +
      'know about X" or to justify a recommendation with something specific it has learned, rather than guessing.',
    input_schema: { type: 'object', properties: {} },
    async execute() {
      const rows = await knowledgeStore.retrieveKnowledge(agentName, { limit: CURRENT_KNOWLEDGE_LIMIT });
      return {
        type: 'read',
        knowledge: rows.map((r) => ({
          id: r.id,
          scope: r.scope,
          category: r.category,
          topic: r.topic,
          claim: r.claim,
          confidence: r.confidence,
          status: r.status,
          source_type: r.source_type,
        })),
      };
    },
  };

  const getRecentLearning = {
    name: 'get_recent_learning',
    description:
      'List the most recent times an admin taught this agent something new — what changed and when. Use ' +
      'this for questions like "what did you learn today" or "what\'s your recent learning progress."',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: RECENT_LEARNING_MAX_LIMIT },
      },
    },
    async execute({ limit = RECENT_LEARNING_DEFAULT_LIMIT } = {}) {
      const { AgentActivity } = require('../../../models');
      const boundedLimit = Math.min(RECENT_LEARNING_MAX_LIMIT, Math.max(1, Number(limit) || RECENT_LEARNING_DEFAULT_LIMIT));

      const rows = await AgentActivity.findAll({
        where: {
          agent_name: agentName,
          event_type: 'setting_applied',
          setting_key: `agents.${agentName}.knowledge_base`,
        },
        order: [['created_at', 'DESC']],
        limit: boundedLimit,
      });

      return {
        type: 'read',
        // agentActivityLogger.settingApplied stores { diff: { current_value, proposed_value } }.
        updates: rows.map((row) => ({
          applied_at: formatIst(row.created_at),
          summary: row.payload?.diff?.proposed_value || null,
        })),
      };
    },
  };

  /**
   * Conversational counterpart to the file-upload "Teach" panel — lets an
   * agent propose a single knowledge item directly from the chat (e.g. when
   * the admin states a fact/preference mid-conversation) without requiring a
   * separate teach-panel submission. Same non-negotiable rule as every other
   * tool in this codebase: it only ever returns a `{type:'proposed_change'}`
   * diff. It NEVER calls knowledgeStore/AgentKnowledge directly — the only
   * writer remains POST /agents/:agentName/knowledge-base/confirm (via
   * knowledgeBase.confirmKnowledgeBatch), reached here through the exact same
   * Apply button and endpoint the Teach panel's draft review uses. Was
   * planned in Phase 4 but never built — see the audit's Part 11 finding.
   */
  const proposeKnowledgeUpdate = {
    name: 'propose_knowledge_update',
    description:
      'Propose a new piece of knowledge to remember, based on something the admin just told you in this ' +
      'conversation. This only proposes a diff for the admin to review and Apply — it never saves anything ' +
      'by itself. Use this when the admin states a fact, preference, strategy, or correction worth ' +
      'remembering for future conversations, not for routine chit-chat.',
    input_schema: {
      type: 'object',
      properties: {
        claim: {
          type: 'string',
          description: 'The knowledge claim itself, stated as a clear, standalone sentence.',
        },
        category: {
          type: 'string',
          description: 'Short domain label for this claim, e.g. "seo_strategy", "brand_voice", "scheduling".',
        },
        topic: {
          type: 'string',
          description: 'Optional narrower topic within the category. Defaults to the category if omitted.',
        },
        evidence: {
          type: 'string',
          description: 'Optional: the admin\'s own words, or the reasoning, that this claim is based on.',
        },
        knowledge_type: {
          type: 'string',
          enum: KNOWLEDGE_TYPES,
          description: 'What kind of knowledge this is — defaults to "fact" if omitted.',
        },
        scope: {
          type: 'string',
          enum: ['agent', 'global'],
          description:
            'Whether this should apply to every agent ("global") or only this one ("agent", the default). ' +
            'Use "global" only when the admin is clearly stating something true platform-wide.',
        },
      },
      required: ['claim', 'category'],
    },
    async execute({ claim, category, topic, evidence, knowledge_type: knowledgeType, scope } = {}) {
      const trimmedClaim = String(claim || '').trim();
      const trimmedCategory = String(category || '').trim();
      if (!trimmedClaim) throw new Error('claim is required.');
      if (!trimmedCategory) throw new Error('category is required.');

      const resolvedType = KNOWLEDGE_TYPES.includes(knowledgeType) ? knowledgeType : 'fact';
      const resolvedScope = scope === 'global' ? 'global' : 'agent';
      const resolvedTopic = topic ? String(topic).trim() : trimmedCategory;
      const resolvedEvidence = evidence ? String(evidence).trim() : null;

      return {
        type: 'proposed_change',
        change: {
          domain: 'knowledge',
          agent_name: agentName,
          scope: resolvedScope,
          // current_value/proposed_value mirror every other proposed_change
          // shape in this codebase (see imageAgentTools.js etc.) so
          // ProposedChangeCard's generic ValuePreview renders this the same
          // way as any other diff card, with no domain-specific UI branch.
          current_value: null,
          proposed_value: {
            category: trimmedCategory,
            topic: resolvedTopic,
            claim: trimmedClaim,
            evidence: resolvedEvidence,
            knowledge_type: resolvedType,
            scope: resolvedScope,
          },
          category: trimmedCategory,
          topic: resolvedTopic,
          claim: trimmedClaim,
          evidence: resolvedEvidence,
          knowledge_type: resolvedType,
          source_type: 'manual_text',
        },
        message: `Proposed new ${resolvedScope === 'global' ? 'global' : 'agent'} knowledge — nothing has been saved yet. The admin needs to hit Apply.`,
      };
    },
  };

  return [getCurrentKnowledge, getRecentLearning, proposeKnowledgeUpdate];
}

module.exports = { makeKnowledgeTools };
