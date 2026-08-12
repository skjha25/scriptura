'use strict';

/**
 * Agent registry — maps an agent name to its persona and tool set.
 *
 * services/agents/runAgentTurn.js is the only reader of this file; it never
 * hardcodes an agent's prompt or tools, so adding an agent (or a tool to an
 * existing one) never requires touching the orchestrator loop itself.
 */

const { AGENT_NAMES } = require('../../constants');
const systemPrompts = require('./systemPrompts');
const imageAgentTools = require('./tools/imageAgentTools');
const generateAgentTools = require('./tools/generateAgentTools');
const chiefAgentTools = require('./tools/chiefAgentTools');
const researchAgentTools = require('./tools/researchAgentTools');
const seoAnalystAgentTools = require('./tools/seoAnalystAgentTools');
const autopilotAgentTools = require('./tools/autopilotAgentTools');
const clusterAgentTools = require('./tools/clusterAgentTools');
const blogOpsAgentTools = require('./tools/blogOpsAgentTools');
const { makeKnowledgeTools } = require('./tools/sharedKnowledgeTools');

const registry = {
  [AGENT_NAMES.BLOG_IMAGE]: {
    name: AGENT_NAMES.BLOG_IMAGE,
    systemPrompt: systemPrompts.BLOG_IMAGE_AGENT_PROMPT,
    tools: [...imageAgentTools.TOOLS, ...makeKnowledgeTools(AGENT_NAMES.BLOG_IMAGE)],
  },
  [AGENT_NAMES.GENERATE]: {
    name: AGENT_NAMES.GENERATE,
    systemPrompt: systemPrompts.GENERATE_AGENT_PROMPT,
    // No makeKnowledgeTools here on purpose — Generate Agent already has its
    // own equivalent (get_current_style_profile) pointed at the separate
    // agents.generate.style_profile mechanism. See sharedKnowledgeTools.js's
    // header comment.
    tools: generateAgentTools.TOOLS,
  },
  [AGENT_NAMES.CHIEF]: {
    name: AGENT_NAMES.CHIEF,
    systemPrompt: systemPrompts.CHIEF_AGENT_PROMPT,
    tools: [...chiefAgentTools.TOOLS, ...makeKnowledgeTools(AGENT_NAMES.CHIEF)],
  },
  [AGENT_NAMES.RESEARCH]: {
    name: AGENT_NAMES.RESEARCH,
    systemPrompt: systemPrompts.RESEARCH_AGENT_PROMPT,
    tools: [...researchAgentTools.TOOLS, ...makeKnowledgeTools(AGENT_NAMES.RESEARCH)],
  },
  [AGENT_NAMES.SEO_ANALYST]: {
    name: AGENT_NAMES.SEO_ANALYST,
    systemPrompt: systemPrompts.SEO_ANALYST_AGENT_PROMPT,
    tools: [...seoAnalystAgentTools.TOOLS, ...makeKnowledgeTools(AGENT_NAMES.SEO_ANALYST)],
  },
  [AGENT_NAMES.AUTOPILOT]: {
    name: AGENT_NAMES.AUTOPILOT,
    systemPrompt: systemPrompts.AUTOPILOT_AGENT_PROMPT,
    tools: [...autopilotAgentTools.TOOLS, ...makeKnowledgeTools(AGENT_NAMES.AUTOPILOT)],
  },
  [AGENT_NAMES.CLUSTER]: {
    name: AGENT_NAMES.CLUSTER,
    systemPrompt: systemPrompts.CLUSTER_AGENT_PROMPT,
    tools: [...clusterAgentTools.TOOLS, ...makeKnowledgeTools(AGENT_NAMES.CLUSTER)],
  },
  [AGENT_NAMES.BLOG_OPS]: {
    name: AGENT_NAMES.BLOG_OPS,
    systemPrompt: systemPrompts.BLOG_OPS_AGENT_PROMPT,
    // Block-edit tools are appended once the Editor page's local-apply wiring exists.
    tools: [...blogOpsAgentTools.TOOLS, ...makeKnowledgeTools(AGENT_NAMES.BLOG_OPS)],
  },
};

module.exports = registry;
