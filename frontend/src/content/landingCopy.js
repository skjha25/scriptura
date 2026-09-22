// frontend/src/content/landingCopy.js
/**
 * Landing page copy — kept separate from the section components so it can be
 * reviewed and edited without touching layout/animation code.
 *
 * Every claim here is grounded in the real system: the 8 named agents in
 * backend/src/services/agents/registry.js, the P0–P5 recommendation lifecycle,
 * the knowledge/learning pipeline, and the verified Anthropic/OpenAI/Mock
 * provider abstraction. No invented metrics, customer logos, or testimonials.
 */

export const hero = {
  eyebrow: 'The intelligence layer for SEO content',
  headline: 'Content intelligence that has to prove itself.',
  subhead:
    "Eight specialized agents research, write, and recommend — but every action waits for your approval, and every outcome is measured for real before the system treats it as something it learned.",
  primaryCta: { label: 'Sign in', to: '/login' },
  secondaryCta: { label: 'See how it works', href: '#how-it-works' },
};

export const productOverview = [
  {
    title: '8 specialized agents',
    description:
      'Chief, SEO Analyst, Research, Cluster, Blog Ops, Generate, Blog Image, and Autopilot Scheduler — each with a narrow job. None of them can act alone.',
  },
  {
    title: 'A human approves everything',
    description:
      'Every proposal becomes a durable, reviewable record. Only two narrowly whitelisted action types can ever execute automatically — and only after a human starts tracking them.',
  },
  {
    title: '14-day outcome tracking',
    description:
      'Before/after evidence comes from the same real search-ranking and Search Console data, checked again after a two-week window and classified deterministically — never an LLM’s opinion of its own success.',
  },
  {
    title: 'Bring your own model',
    description:
      'Anthropic or OpenAI, swappable by configuration. The orchestration layer that proposes, tracks, and learns doesn’t care which model is doing the thinking.',
  },
];

export const agents = [
  {
    name: 'Chief Agent',
    role: 'Reads your request, splits it by domain, and delegates to the right specialist.',
    icon: 'Network',
  },
  {
    name: 'SEO Analyst Agent',
    role: 'Explains dashboard trends and ranking shifts using real stored SERP and Search Console data — the only agent that can recommend an SEO action.',
    icon: 'LineChart',
  },
  {
    name: 'Research Agent',
    role: 'Surfaces new keyword and topic candidates for the content pipeline.',
    icon: 'Search',
  },
  {
    name: 'Cluster Agent',
    role: 'Manages keyword clusters — status, cadence, scheduling, cannibalization checks.',
    icon: 'Boxes',
  },
  {
    name: 'Blog Ops Agent',
    role: 'Finds and filters posts, and proposes edits to a specific block on the page you’re editing.',
    icon: 'FileEdit',
  },
  {
    name: 'Generate Agent',
    role: 'Tunes tone, point of view, and readability, and learns your house style from examples you approve.',
    icon: 'Wand2',
  },
  {
    name: 'Blog Image Agent',
    role: 'Proposes style direction — lighting, palette, composition — for every image style the generator uses.',
    icon: 'Image',
  },
  {
    name: 'Autopilot Scheduler Agent',
    role: 'Controls retry limits and context window size for the automation that runs while you’re away.',
    icon: 'Timer',
  },
];

export const lifecycle = {
  eyebrow: 'How it works',
  heading: 'Nothing ships on a hunch.',
  subhead:
    'Every recommendation moves through the same five stages, whether it came from an agent watching your rankings or one drafting your next post.',
  stages: [
    {
      label: 'Propose',
      description: 'An agent notices something worth acting on and files a recommendation.',
      icon: 'Lightbulb',
    },
    {
      label: 'Approve',
      description: 'A human reviews it. Nothing changes without a yes.',
      icon: 'CheckCircle2',
    },
    {
      label: 'Act',
      description: 'The action is tracked — and for two whitelisted types, executed automatically once approved.',
      icon: 'Play',
    },
    {
      label: 'Outcome',
      description: 'After a 14-day window, the same real data is checked again and the result is classified, not guessed.',
      icon: 'TrendingUp',
    },
    {
      label: 'Learn',
      description: 'Patterns that hold up across enough outcomes get proposed as knowledge — and still need a human to confirm them.',
      icon: 'Brain',
    },
  ],
};

export const knowledgeLayer = {
  eyebrow: 'Knowledge & learning',
  heading: 'It only remembers what held up.',
  paragraph:
    "Every source — text, a link, an image, a video — is fully stored before any model reads it. Claims pulled from it are checked against what the system already knows: new, supporting, duplicate, or contradicting. Contradictions are never auto-resolved — they're flagged, linked, and left for a human to settle. Only then does anything get retrieved and used, and its confidence only ever moves in response to a real, measured outcome.",
  stages: ['Ingestion', 'Extraction', 'Validation', 'Confirmation', 'Retrieval', 'Reinforcement'],
};

export const footer = {
  heading: 'See what it proposes for you.',
  cta: { label: 'Sign in', to: '/login' },
};
