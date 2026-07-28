// frontend/src/lib/constants.js
/**
 * Domain enumerations — the frontend mirror of backend/src/constants/index.js.
 *
 * These are duplicated rather than fetched because they are needed synchronously
 * during the first render (to build the wizard's dropdowns and the status
 * filters), and blocking the whole UI on a network round trip for a set of values
 * that changes once a year would be a bad trade.
 *
 * The duplication is guarded: `GET /api/v1/meta` returns the backend's live
 * values, and src/lib/__tests__/constants-parity.test.js asserts this file
 * matches. If the two drift, that test fails — which is the point.
 */

/**
 * `blogs.blog_status` — TINYINT on the existing production table.
 * 1 = published is confirmed from live data; the rest are our additions.
 */
export const BLOG_STATUS = Object.freeze({
  DRAFT: 0,
  PUBLISHED: 1,
  SCHEDULED: 2,
  ARCHIVED: 3,
});

export const BLOG_STATUS_LABELS = Object.freeze({
  0: 'draft',
  1: 'published',
  2: 'scheduled',
  3: 'archived',
});

/** Display metadata for a status. Colour is UI chrome, never a data-series hue. */
export const BLOG_STATUS_META = Object.freeze({
  0: { label: 'Draft', chip: 'bg-ink-faint/20 text-ink-secondary border-hairline' },
  1: { label: 'Published', chip: 'bg-status-good/15 text-status-good border-status-good/30' },
  2: { label: 'Scheduled', chip: 'bg-accent/15 text-accent-bright border-accent/30' },
  3: { label: 'Archived', chip: 'bg-status-serious/15 text-status-serious border-status-serious/30' },
});

export const GENERATION_STATUS = Object.freeze({
  DRAFT: 'draft',
  QUEUED: 'queued',
  GENERATING: 'generating',
  GENERATED: 'generated',
  FAILED: 'failed',
});

/** States in which the wizard should keep polling. */
export const GENERATION_IN_FLIGHT = Object.freeze(['queued', 'generating']);

export const GENERATION_STATUS_META = Object.freeze({
  draft: { label: 'Not generated', tone: 'muted' },
  queued: { label: 'Queued', tone: 'accent' },
  generating: { label: 'Generating', tone: 'accent' },
  generated: { label: 'Generated', tone: 'good' },
  failed: { label: 'Failed', tone: 'critical' },
});

export const ARTICLE_TYPES = Object.freeze([
  'how_to',
  'listicle',
  'product_review',
  'comparison',
  'case_study',
  'general',
]);

export const READABILITY_LEVELS = Object.freeze(['5th_grade', '8th_grade', 'college', 'none']);

export const BRAND_VOICE_SOURCE_TYPES = Object.freeze(['text', 'web_scrape', 'file_upload', 'none']);

export const IMAGE_STYLES = Object.freeze(['photo', 'illustration', 'minimal', 'brand_colored']);

export const LOGO_POSITIONS = Object.freeze([
  'top_left',
  'top_right',
  'bottom_left',
  'bottom_right',
  'center',
  'none',
]);

export const BLOCK_TYPES = Object.freeze([
  'heading',
  'paragraph',
  'image',
  'quote',
  'table',
  'faq_accordion',
  'cta_button',
  'list',
  'embed',
  'key_takeaway',
]);

export const POINTS_OF_VIEW = Object.freeze([
  'first_person_singular',
  'first_person_plural',
  'second_person',
  'third_person',
]);

export const DEFAULT_SEO_STRUCTURE = Object.freeze({
  h1: true,
  h2: true,
  h3: true,
  faq: true,
  tables: false,
  key_takeaways: true,
  quotes: false,
  lists: true,
  emphasis: true,
});

export const IMAGE_COUNT_MIN = 1;
export const IMAGE_COUNT_MAX = 4;

export const DEFAULT_PUBLISHED_BY = 'DivineTalk Astrology';

export const USER_ROLES = Object.freeze({ ADMIN: 'admin', EDITOR: 'editor' });

// ---------------------------------------------------------------------------
// Human-readable labels
// ---------------------------------------------------------------------------

/** Turns `how_to` into `How to`. Used for any enum without a bespoke label. */
export function humanizeEnum(value) {
  if (typeof value !== 'string' || value === '') return '';
  return value
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

export const ARTICLE_TYPE_LABELS = Object.freeze({
  how_to: 'How-to guide',
  listicle: 'Listicle',
  product_review: 'Product review',
  comparison: 'Comparison',
  case_study: 'Case study',
  general: 'General article',
});

export const READABILITY_LABELS = Object.freeze({
  '5th_grade': 'Simple (5th grade)',
  '8th_grade': 'Standard (8th grade)',
  college: 'Advanced (college)',
  none: 'No constraint',
});

export const POV_LABELS = Object.freeze({
  first_person_singular: 'First person (I)',
  first_person_plural: 'First person plural (we)',
  second_person: 'Second person (you)',
  third_person: 'Third person',
});

export const IMAGE_STYLE_LABELS = Object.freeze({
  photo: 'Photographic',
  illustration: 'Illustration',
  minimal: 'Minimal / abstract',
  brand_colored: 'Brand-coloured',
});

export const LOGO_POSITION_LABELS = Object.freeze({
  top_left: 'Top left',
  top_right: 'Top right',
  bottom_left: 'Bottom left',
  bottom_right: 'Bottom right',
  center: 'Centre',
  none: 'No logo',
});

/** Labels for the SEO structure toggles, in the order the wizard shows them. */
export const SEO_STRUCTURE_FIELDS = Object.freeze([
  { key: 'h1', label: 'H1 title', hint: 'Single top-level heading' },
  { key: 'h2', label: 'H2 sections', hint: 'Main section headings' },
  { key: 'h3', label: 'H3 sub-sections', hint: 'Nested detail headings' },
  { key: 'faq', label: 'FAQ section', hint: 'Accordion of common questions' },
  { key: 'tables', label: 'Comparison tables', hint: 'Structured data as a table' },
  { key: 'key_takeaways', label: 'Key takeaways', hint: 'Summary callout box' },
  { key: 'quotes', label: 'Pull quotes', hint: 'Highlighted quotations' },
  { key: 'lists', label: 'Bullet & numbered lists', hint: 'Scannable list blocks' },
  { key: 'emphasis', label: 'Bold & italic emphasis', hint: 'Inline emphasis on key terms' },
]);

/** Block types offered in the editor's insert menu, with display metadata. */
export const BLOCK_TYPE_META = Object.freeze({
  heading: { label: 'Heading', icon: 'H', hint: 'Section heading (H2–H4)' },
  paragraph: { label: 'Paragraph', icon: '¶', hint: 'Body copy' },
  image: { label: 'Image', icon: '▢', hint: 'Figure with caption and alt text' },
  quote: { label: 'Quote', icon: '❝', hint: 'Pull quote with attribution' },
  table: { label: 'Table', icon: '▦', hint: 'Rows and columns' },
  faq_accordion: { label: 'FAQ', icon: '?', hint: 'Expandable question list' },
  cta_button: { label: 'CTA button', icon: '▷', hint: 'Call-to-action link' },
  list: { label: 'List', icon: '•', hint: 'Bulleted or numbered' },
  embed: { label: 'Embed', icon: '⧉', hint: 'Video or external content' },
  key_takeaway: { label: 'Key takeaways', icon: '★', hint: 'Summary callout' },
});

/**
 * Chart series colours, in fixed assignment order.
 *
 * These mirror `series-1..8` in tailwind.config.js, which is a colourblind-safe
 * categorical set validated against the panel surface. Recharts needs literal
 * colour strings (it cannot read a Tailwind class), which is why they appear here
 * as hex — but they are the same values, and the rules from the config apply:
 * assign in order, never cycle, never generate a ninth.
 */
export const SERIES_COLORS = Object.freeze([
  '#3987e5', // 1 blue
  '#d95926', // 2 orange
  '#199e70', // 3 aqua
  '#c98500', // 4 yellow
  '#d55181', // 5 magenta
  '#008300', // 6 green
  '#9085e9', // 7 violet
  '#e66767', // 8 red
]);

/** Reserved status colours. Never reused as a series colour. */
export const STATUS_COLORS = Object.freeze({
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
});

/** Chart chrome, matching tailwind.config.js. */
export const CHART_CHROME = Object.freeze({
  surface: '#141221',
  grid: '#241f3a',
  axis: '#332c52',
  inkMuted: '#8f8bab',
  inkSecondary: '#c0bcd6',
});
