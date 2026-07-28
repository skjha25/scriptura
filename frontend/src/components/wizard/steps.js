// frontend/src/components/wizard/steps.js
/**
 * Step definitions and the per-step "may I advance?" rules.
 *
 * The rules live here rather than inside each step component because two callers
 * need them without rendering a step: WizardPage gates its Next button, and
 * StepIndicator decides which steps are reachable. A rule buried in a step's JSX
 * would be invisible to both, and would end up reimplemented — differently — in
 * each of them.
 *
 * Each rule returns the list of things still missing, not a boolean. The spec
 * requires the wizard to say WHAT is missing, and a function that only answers
 * yes/no cannot be made to do that later without being rewritten.
 */

import {
  BLOG_STATUS,
  IMAGE_COUNT_MAX,
  IMAGE_COUNT_MIN,
  DEFAULT_PUBLISHED_BY,
  DEFAULT_SEO_STRUCTURE,
} from '../../lib/constants';

/** Publish intent, as offered in step 5. See PUBLISH_MODES below. */
export const PUBLISH_MODE = Object.freeze({
  DRAFT: 'draft',
  SCHEDULE: 'schedule',
  NOW: 'now',
});

/**
 * The six steps.
 *
 * `label` is the full name used on wide screens and announced to assistive tech;
 * `short` is what fits a 375px stepper.
 */
export const WIZARD_STEPS = Object.freeze([
  { id: 1, key: 'topic', label: 'Topic & title', short: 'Topic' },
  { id: 2, key: 'voice', label: 'Brand voice', short: 'Voice' },
  { id: 3, key: 'content', label: 'Content setup', short: 'Content' },
  { id: 4, key: 'images', label: 'Images', short: 'Images' },
  { id: 5, key: 'publish', label: 'Publish settings', short: 'Publish' },
  { id: 6, key: 'generate', label: 'Generate', short: 'Generate' },
]);

export const FIRST_STEP = 1;
export const LAST_STEP = WIZARD_STEPS.length;

/** Blank wizard state. Every field the wizard can write starts here. */
export const INITIAL_CONFIG = Object.freeze({
  blog_title: '',
  topic: '',
  seo_keywords: '',
  secondary_keywords: [],

  // null rather than 'none': "the author has not chosen yet" and "the author
  // chose to work without a brand voice" are different facts, and step 2's gate
  // turns on exactly that difference.
  brand_voice_source_type: null,
  brand_voice_source_ref: '',
  brand_voice_tone: '',
  brand_voice_pov: '',
  brand_voice_traits: [],
  brand_voice_confirmed: false,

  article_type: 'general',
  tone_of_voice: '',
  point_of_view: 'second_person',
  target_country: 'IN',
  language: 'en',
  readability_level: '8th_grade',
  ai_content_cleaning: false,

  seo_structure_config: { ...DEFAULT_SEO_STRUCTURE },
  internal_linking: false,
  internal_link_targets: [],
  external_web_grounding: false,
  outline: [],

  include_images: true,
  image_count: IMAGE_COUNT_MIN,
  image_style: 'photo',
  logo_overlay: false,
  logo_position: 'none',

  blog_status: BLOG_STATUS.DRAFT,
  publish_date: null,
  category: '',
  tags: [],
  published_by: DEFAULT_PUBLISHED_BY,
});

/** Trimmed length of a possibly-null string field. */
function filled(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * What is still missing before this step may be left.
 *
 * @param {number} step 1-based step id.
 * @param {object} config Wizard state.
 * @returns {string[]} Human-readable requirements, empty when the step is done.
 */
export function missingForStep(step, config = {}) {
  const missing = [];

  if (step === 1) {
    if (!filled(config.topic)) missing.push('Enter the primary keyword or topic.');
    if (!filled(config.blog_title)) {
      missing.push('Choose or write a title — the blog is saved under it.');
    } else if (config.blog_title.trim().length > 255) {
      missing.push('The title must be 255 characters or fewer.');
    }
    return missing;
  }

  if (step === 2) {
    if (config.brand_voice_source_type === null || config.brand_voice_source_type === undefined) {
      missing.push('Analyse a brand voice, or choose to continue without one.');
    } else if (config.brand_voice_source_type !== 'none' && config.brand_voice_confirmed !== true) {
      // The strictest gate in the wizard, and the reason it is strict is on the
      // server: services/generation.js refuses the run with 422
      // BRAND_VOICE_NOT_CONFIRMED, so letting the author past here would only
      // move the failure to step 6.
      missing.push('Review the analysed voice and confirm it before continuing.');
    }
    return missing;
  }

  if (step === 3) {
    if (!filled(config.article_type)) missing.push('Pick an article type.');
    if (!filled(config.readability_level)) missing.push('Pick a readability level.');
    if (!filled(config.language) || config.language.trim().length < 2) {
      missing.push('Enter a language code, such as "en" or "hi".');
    }
    if (config.internal_linking && (config.internal_link_targets || []).length === 0) {
      missing.push('Pick at least one article to link to, or turn internal linking off.');
    }
    return missing;
  }

  if (step === 4) {
    if (config.include_images) {
      const count = Number(config.image_count);
      if (!Number.isInteger(count) || count < IMAGE_COUNT_MIN || count > IMAGE_COUNT_MAX) {
        missing.push(`Choose between ${IMAGE_COUNT_MIN} and ${IMAGE_COUNT_MAX} images.`);
      }
      if (!filled(config.image_style)) missing.push('Pick an image style.');
      if (config.logo_overlay && (!filled(config.logo_position) || config.logo_position === 'none')) {
        missing.push('Pick where the logo sits on the image.');
      }
    }
    return missing;
  }

  if (step === 5) {
    if (!filled(config.published_by)) missing.push('Enter who the article is published by.');
    if (publishModeOf(config) === PUBLISH_MODE.SCHEDULE && !filled(config.publish_date)) {
      missing.push('Pick the date to publish on.');
    }
    return missing;
  }

  return missing;
}

/** True when nothing is outstanding on that step. */
export function isStepComplete(step, config) {
  return missingForStep(step, config).length === 0;
}

/**
 * The furthest step the author may jump to.
 *
 * Every earlier step must be complete: allowing a jump to step 6 with no title
 * would only produce a 422 from the server, and a stepper that offers a step it
 * cannot honour is worse than one that greys it out.
 */
export function furthestReachableStep(config) {
  let reachable = FIRST_STEP;
  for (const step of WIZARD_STEPS) {
    if (step.id === LAST_STEP) break;
    if (!isStepComplete(step.id, config)) break;
    reachable = step.id + 1;
  }
  return reachable;
}

// ---------------------------------------------------------------------------
// Publish intent
// ---------------------------------------------------------------------------

/**
 * Step 5's three choices, and how they map onto the `blogs` row.
 *
 * There is no "publish intent" column, and inventing one is not an option — the
 * table is shared with the live site. So the intent is encoded in the two columns
 * that already exist, and it round-trips through a refresh:
 *
 *   draft     → blog_status = DRAFT,     publish_date = null
 *   schedule  → blog_status = SCHEDULED, publish_date = the chosen date
 *   publish   → blog_status = DRAFT,     publish_date = today
 *
 * The wizard NEVER writes blog_status = PUBLISHED. PATCH /blogs/:id would accept
 * it, which is exactly the danger: it bypasses assertPublishable() and would put
 * an empty article on the public site before the article had even been generated.
 * "Publish now" therefore records the date and defers the act to
 * POST /blogs/:id/publish from the editor, after the human review pass the spec
 * requires.
 */
export const PUBLISH_MODES = Object.freeze([
  {
    value: PUBLISH_MODE.DRAFT,
    label: 'Save as draft',
    hint: 'Nothing goes live. Publish by hand once the article reads well.',
  },
  {
    value: PUBLISH_MODE.SCHEDULE,
    label: 'Schedule for a date',
    hint: 'Marks the article scheduled and records the date.',
  },
  {
    value: PUBLISH_MODE.NOW,
    label: 'Publish as soon as it is reviewed',
    hint: "Dates it today. You still confirm the publish in the editor — generation never publishes on its own.",
  },
]);

/** Reads step 5's choice back out of the persisted columns. */
export function publishModeOf(config = {}) {
  if (Number(config.blog_status) === BLOG_STATUS.SCHEDULED) return PUBLISH_MODE.SCHEDULE;
  if (filled(config.publish_date)) return PUBLISH_MODE.NOW;
  return PUBLISH_MODE.DRAFT;
}

/** Today as YYYY-MM-DD, matching the DATEONLY columns without timezone drift. */
export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/** The column patch for a chosen publish mode. */
export function patchForPublishMode(mode, currentDate) {
  if (mode === PUBLISH_MODE.SCHEDULE) {
    return {
      blog_status: BLOG_STATUS.SCHEDULED,
      publish_date: filled(currentDate) ? currentDate : todayIsoDate(),
    };
  }
  if (mode === PUBLISH_MODE.NOW) {
    return { blog_status: BLOG_STATUS.DRAFT, publish_date: todayIsoDate() };
  }
  return { blog_status: BLOG_STATUS.DRAFT, publish_date: null };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Builds `<Select>` options from an enum list and its label map. */
export function optionsFrom(values, labels) {
  return values.map((value) => ({ value, label: labels[value] || value }));
}
