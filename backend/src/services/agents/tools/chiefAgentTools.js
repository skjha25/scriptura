'use strict';

/**
 * Tools available to the Chief Agent — Phase 1 has exactly one: delegation.
 *
 * `delegate_to_agent` recursively re-enters services/agents/runAgentTurn.js
 * for the target agent, sharing the SAME trace_id so a whole delegation chain
 * (admin message -> Chief -> N sub-agents) reconstructs as one trace on the
 * Activity page. `runAgentTurn.js` requires this file (via registry.js), so
 * this file must NOT require runAgentTurn.js at module load time — that would
 * be a require cycle. The require happens lazily, inside execute(), same
 * pattern used throughout this codebase to break cycles (see
 * services/brandVoice.js's lazy require of BaseProvider for the precedent).
 */

const { AGENT_NAMES } = require('../../../constants');

const DELEGATABLE_AGENTS = [
  AGENT_NAMES.BLOG_IMAGE,
  AGENT_NAMES.GENERATE,
  AGENT_NAMES.SEO_ANALYST,
  AGENT_NAMES.BLOG_OPS,
  AGENT_NAMES.CLUSTER,
  AGENT_NAMES.RESEARCH,
  AGENT_NAMES.AUTOPILOT,
];

const delegateToAgent = {
  name: 'delegate_to_agent',
  description:
    'Delegate one clear instruction to a specialised sub-agent: blog_image_agent (image style), ' +
    'generate_agent (article tone/content defaults/style profiles/knowledge base — what the platform ' +
    'has learned about house voice and writing style), seo_analyst_agent (dashboard analytics, ' +
    'read-only), blog_ops_agent (finding blogs, editing a block on the Editor page), cluster_agent ' +
    '(keyword clusters, scheduling, expansion), research_agent (keyword/topic suggestions), ' +
    'autopilot_agent (retry count). Split a compound admin request into multiple calls to this tool ' +
    '— one per domain — rather than one vague combined instruction. Never call this with your own ' +
    'agent name.',
  input_schema: {
    type: 'object',
    properties: {
      agent_name: {
        type: 'string',
        enum: DELEGATABLE_AGENTS,
        description: 'Which specialised agent should handle this part of the request.',
      },
      instruction: {
        type: 'string',
        description: 'The specific instruction for that agent — a clear, single-domain request, in your own words.',
      },
    },
    required: ['agent_name', 'instruction'],
  },
  async execute({ agent_name, instruction } = {}, ctx = {}) {
    if (!DELEGATABLE_AGENTS.includes(agent_name)) {
      throw new Error(`Cannot delegate to "${agent_name}" — must be one of ${DELEGATABLE_AGENTS.join(', ')}.`);
    }
    if (agent_name === ctx.agentName) {
      throw new Error(`"${ctx.agentName}" cannot delegate to itself.`);
    }
    if (!instruction || !instruction.trim()) {
      throw new Error('instruction is required.');
    }

    const { runAgentTurn } = require('../runAgentTurn');
    const subResult = await runAgentTurn({
      agentName: agent_name,
      userId: ctx.userId,
      message: instruction.trim(),
      traceId: ctx.traceId,
      fromAgent: ctx.agentName,
    });

    return {
      type: 'delegation',
      toAgent: agent_name,
      instruction: instruction.trim(),
      reply: subResult.reply,
      proposedChanges: subResult.proposedChanges,
    };
  },
};

module.exports = {
  DELEGATABLE_AGENTS,
  TOOLS: [delegateToAgent],
};
