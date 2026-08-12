// frontend/src/lib/agentMeta.js
/**
 * Single source of truth for the 8 admin chat agents' display metadata
 * (icon/label/description) — shared by AgentChatWidget.js and
 * AgentActivityPage.js so the two can't drift out of sync with each other
 * or with constants.AGENT_NAMES (backend/src/constants/index.js) the way
 * AgentActivityPage.js's own copy once did, silently missing every agent
 * added after Phase 1.
 */
export const AGENT_META = {
  blog_image_agent: {
    label: 'Blog Image Agent',
    icon: '🎨',
    description: 'Proposes image style directives used when generating blog artwork.',
  },
  generate_agent: {
    label: 'Generate Agent',
    icon: '✍️',
    description: 'Tunes tone, point of view, and readability, and learns your writing style.',
  },
  chief_agent: {
    label: 'Chief Agent',
    icon: '🧭',
    description: 'Routes a request to the right specialist agent(s) on your behalf.',
  },
  seo_analyst_agent: {
    label: 'SEO Analyst Agent',
    icon: '📊',
    description: 'Reads dashboard analytics and in-flight generations — read-only.',
  },
  blog_ops_agent: {
    label: 'Blog Ops Agent',
    icon: '📝',
    description: 'Finds blogs and proposes edits to a block on the Editor page.',
  },
  cluster_agent: {
    label: 'Cluster Agent',
    icon: '🗂️',
    description: 'Manages keyword clusters — status, scheduling, and expansion.',
  },
  research_agent: {
    label: 'Research Agent',
    icon: '🔍',
    description: 'Suggests new topics and keywords worth targeting.',
  },
  autopilot_agent: {
    label: 'Autopilot Scheduler Agent',
    icon: '⚙️',
    description: 'Adjusts the autopilot retry count.',
  },
};

export const AGENT_ORDER = Object.keys(AGENT_META);
