'use strict';

/**
 * AI image generation for blog posts.
 *
 * Orchestration only, in a fixed order:
 *
 *   prompt  ->  provider.generateImage()  ->  optional logo overlay  ->  storage
 *
 * Each step lives in its own module (`./ai`, `./logoComposite`, `./storage`) so
 * this file stays readable and none of them has to know about the others. The
 * return value is deliberately shaped to drop straight into
 * `blogs.extra_images` — `{ url, alt_text, has_logo_overlay, logo_position }` —
 * plus the storage/display fields the wizard needs, so the caller never has to
 * reshape it.
 *
 * WHAT IS STORED: `relativePath`, never `publicUrl`. The URL is derived at
 * serialisation time; see services/storage for why that matters.
 *
 * COST: every call here spends real money at OpenAI, so the route that reaches
 * it carries `generationLimiter` and `count` is hard-bounded by
 * IMAGE_COUNT_MIN..IMAGE_COUNT_MAX.
 */

const sharp = require('sharp');

const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { IMAGE_STYLES, IMAGE_COUNT_MIN, IMAGE_COUNT_MAX, LOGO_POSITIONS } = require('../constants');
const { compositeLogo, DEFAULT_SIZE_RATIO, DEFAULT_OPACITY } = require('./logoComposite');
const { saveImage } = require('./storage');

/** Square by default: it is the one aspect every downstream surface crops well. */
const DEFAULT_SIZE = '1024x1024';

/**
 * Style directives, in one place.
 *
 * These are the only prose in the app that shapes what an image looks like, so
 * they live here rather than being scattered across callers or hidden in the
 * provider. Each is written as a directive the model can act on rather than an
 * adjective it can ignore.
 *
 * `brand_colored` encodes Divinetalk's palette explicitly, because "on brand" is
 * not something an image model can infer.
 */
const STYLE_DIRECTIVES = Object.freeze({
  photo:
    'Editorial photograph. Natural available light, shallow depth of field, ' +
    'realistic textures and skin tones, no visible text or lettering.',
  illustration:
    'Hand-drawn digital illustration. Confident linework, flat layered colour ' +
    'with subtle paper texture, warm and inviting, no visible text or lettering.',
  minimal:
    'Minimal composition. One clear subject, generous negative space, muted ' +
    'two- or three-tone palette, soft even lighting, no visible text or lettering.',
  brand_colored:
    'Illustration in the Divinetalk brand palette: deep indigo (#2B1B4A) ' +
    'background, saffron (#E4761B) and gold (#F2B23E) accents. Serene, ' +
    'devotional, contemporary Indian spiritual aesthetic. No visible text or lettering.',
});

/**
 * Framing shared by every prompt.
 *
 * Two constraints are non-negotiable for this brand and are therefore not
 * caller-overridable:
 *
 *   - No text in the image. Image models render text badly, and a misspelt
 *     Sanskrit word on a Divinetalk asset is worse than no word at all.
 *   - Respectful depiction. The subject matter is Hindu religious practice, and
 *     an image that reads as kitsch or as parody is unpublishable.
 */
const BASE_DIRECTIVES =
  'Editorial header image for an article on a respected Indian astrology and ' +
  'spirituality publication. Treat the subject matter with dignity and cultural ' +
  'accuracy; avoid caricature, kitsch and religious parody. Do not render any ' +
  'words, letters, numerals or watermarks in the image.';

/** Longest topic/prompt fragment we forward, so one field cannot dominate. */
const MAX_PROMPT_FRAGMENT = 400;

/** Collapses whitespace and trims to a bound. */
function tidy(value, maxLength = MAX_PROMPT_FRAGMENT) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Builds the prompt sent to the image provider.
 *
 * THE ONE PLACE prompt text is assembled — deliberately, so tuning image quality
 * is a single-file change and so the exact prompt can be logged and reviewed.
 *
 * Precedence: an explicit `prompt` describes the subject, `topic` is the
 * fallback subject, and `style` always appends its directive. When both are
 * supplied the explicit prompt wins on subject and the topic is retained as
 * context, because an author who typed a prompt still wants it to be about the
 * article.
 *
 * @param {object} args
 * @param {string} [args.prompt] Author-written subject description.
 * @param {string} [args.topic] The blog's topic/seed keyword.
 * @param {string} [args.style] One of constants.IMAGE_STYLES.
 * @param {number} [args.index] 0-based position in a multi-image run.
 * @param {number} [args.count] Total images in the run.
 * @returns {string}
 */
function buildImagePrompt({ prompt, topic, style = 'photo', index = 0, count = 1 } = {}) {
  const subject = tidy(prompt) || tidy(topic);
  if (!subject) {
    throw ApiError.unprocessable('An image needs either a prompt or a topic to work from.', {
      code: 'IMAGE_PROMPT_EMPTY',
    });
  }

  const directive = STYLE_DIRECTIVES[style] || STYLE_DIRECTIVES.photo;
  const parts = [`Subject: ${subject}.`];

  // Keep the article's topic as context when the author supplied both.
  const topicText = tidy(topic);
  if (prompt && topicText && topicText !== subject) {
    parts.push(`Article topic: ${topicText}.`);
  }

  parts.push(directive, BASE_DIRECTIVES);

  // Asking for a distinct angle is what stops a 4-image run coming back as four
  // near-identical frames, which is the usual failure mode of a repeated prompt.
  if (count > 1) {
    parts.push(
      `This is image ${index + 1} of ${count} for the same article — vary the ` +
        'composition, camera angle and focal subject so the set does not repeat itself.'
    );
  }

  return parts.join(' ');
}

/**
 * Default alt text for a generated image.
 *
 * Not optional decoration: alt text is an accessibility requirement for the
 * public site and a ranking signal, and an author who skips the field must still
 * end up with something usable. Kept short and descriptive rather than
 * keyword-stuffed, which screen-reader users and search engines both penalise.
 *
 * @param {object} args
 * @param {string} [args.topic]
 * @param {string} [args.prompt]
 * @param {string} [args.style]
 * @param {number} [args.index]
 * @param {number} [args.count]
 * @returns {string}
 */
function buildAltText({ topic, prompt, style = 'photo', index = 0, count = 1 } = {}) {
  const subject = tidy(topic, 120) || tidy(prompt, 120) || 'the article topic';
  const noun = style === 'photo' ? 'Photograph' : 'Illustration';
  const suffix = count > 1 ? ` (${index + 1} of ${count})` : '';
  return `${noun} illustrating ${subject}${suffix}`;
}

/**
 * Clamps `count` into the configured bounds.
 *
 * Throws rather than silently clamping: a wizard asking for 10 images has a bug
 * or a tampered request, and quietly billing for 4 is the wrong answer to both.
 *
 * @param {*} count
 * @returns {number}
 */
function normaliseCount(count) {
  const requested = count === undefined || count === null ? IMAGE_COUNT_MIN : Number(count);
  if (!Number.isInteger(requested) || requested < IMAGE_COUNT_MIN || requested > IMAGE_COUNT_MAX) {
    throw ApiError.unprocessable(
      `count must be an integer between ${IMAGE_COUNT_MIN} and ${IMAGE_COUNT_MAX}.`,
      { code: 'IMAGE_COUNT_OUT_OF_RANGE', details: { requested: count } }
    );
  }
  return requested;
}

/** Extension for the bytes the provider actually returned. */
function extensionFor(mimeType, format) {
  if (format === 'jpeg' || /jpe?g/i.test(String(mimeType))) return 'jpg';
  if (format === 'webp' || /webp/i.test(String(mimeType))) return 'webp';
  return 'png';
}

/**
 * Generates, optionally watermarks, and stores one or more blog images.
 *
 * Failure policy: a provider error aborts the whole run (the caller asked for a
 * set and half a set is not useful), but a missing logo file does not — see
 * services/logoComposite for why.
 *
 * @param {object} args
 * @param {string} [args.prompt] Author-written subject description.
 * @param {string} [args.topic] The blog's topic; used when `prompt` is absent.
 * @param {string} [args.style] One of constants.IMAGE_STYLES. Default 'photo'.
 * @param {boolean} [args.logoOverlay] Burn the brand logo in. Default false.
 * @param {string} [args.logoPosition] One of constants.LOGO_POSITIONS.
 * @param {number} [args.count] IMAGE_COUNT_MIN..IMAGE_COUNT_MAX. Default min.
 * @param {string} [args.size] Provider size hint, e.g. '1024x1024'.
 * @param {number} [args.sizeRatio] Logo width / image width.
 * @param {number} [args.opacity] Logo opacity, 0..1.
 * @returns {Promise<Array<{relativePath: string, publicUrl: string, alt_text: string,
 *   has_logo_overlay: boolean, logo_position: string, width: number, height: number,
 *   bytes: number, prompt: string}>>}
 */
async function generateBlogImage({
  prompt,
  topic,
  style = 'photo',
  logoOverlay = false,
  logoPosition = 'none',
  count,
  size = DEFAULT_SIZE,
  sizeRatio = DEFAULT_SIZE_RATIO,
  opacity = DEFAULT_OPACITY,
} = {}) {
  if (!IMAGE_STYLES.includes(style)) {
    throw ApiError.unprocessable(`style must be one of ${IMAGE_STYLES.join(', ')}.`, {
      code: 'IMAGE_STYLE_INVALID',
    });
  }
  if (!LOGO_POSITIONS.includes(logoPosition)) {
    throw ApiError.unprocessable(`logo_position must be one of ${LOGO_POSITIONS.join(', ')}.`, {
      code: 'LOGO_POSITION_INVALID',
    });
  }

  const total = normaliseCount(count);

  // `logo_overlay: true` with `logo_position: 'none'` is a contradiction the
  // wizard can produce by toggling the switch without picking a corner. Resolve
  // it to the house default rather than silently skipping the overlay the user
  // just asked for.
  const effectivePosition = logoOverlay
    ? (logoPosition === 'none' ? 'bottom_right' : logoPosition)
    : 'none';

  // Required lazily: this keeps the media routes loadable (and this module unit
  // testable) while services/ai is still being built out in parallel, and matches
  // the lazy-require pattern used in middleware/auth.js.
  const { getImageProvider } = require('./ai');
  const provider = getImageProvider();

  const results = [];

  // Sequential, not Promise.all: image providers rate-limit aggressively and a
  // burst of 4 concurrent calls is the fastest way to get a 429 for the whole
  // set. Four sequential calls is also easier to attribute in the logs.
  for (let index = 0; index < total; index += 1) {
    const imagePrompt = buildImagePrompt({ prompt, topic, style, index, count: total });

    let generated;
    try {
      /* eslint-disable-next-line no-await-in-loop */
      generated = await provider.generateImage({ prompt: imagePrompt, size, style });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw ApiError.upstream(
        `Image generation failed on image ${index + 1} of ${total}: ${err.message}`,
        { cause: err }
      );
    }

    if (!generated || !Buffer.isBuffer(generated.buffer) || generated.buffer.length === 0) {
      throw ApiError.upstream('The image provider returned no image data.', {
        code: 'IMAGE_PROVIDER_EMPTY_RESPONSE',
      });
    }

    let buffer = generated.buffer;
    let hasLogo = false;

    if (effectivePosition !== 'none') {
      /* eslint-disable-next-line no-await-in-loop */
      const composited = await compositeLogo(buffer, {
        position: effectivePosition,
        sizeRatio,
        opacity,
      });
      // compositeLogo returns the input by identity when no logo file exists, so
      // this comparison is how we know whether the overlay actually happened —
      // and `has_logo_overlay` must not claim a watermark that is not there.
      hasLogo = composited !== buffer;
      buffer = composited;
    }

    /* eslint-disable-next-line no-await-in-loop */
    const meta = await sharp(buffer).metadata();
    const ext = extensionFor(generated.mimeType, meta.format);

    /* eslint-disable-next-line no-await-in-loop */
    const stored = await saveImage(buffer, { ext, contentType: generated.mimeType });

    results.push({
      relativePath: stored.relativePath,
      publicUrl: stored.publicUrl,
      alt_text: buildAltText({ topic, prompt, style, index, count: total }),
      has_logo_overlay: hasLogo,
      logo_position: hasLogo ? effectivePosition : 'none',
      width: meta.width,
      height: meta.height,
      bytes: stored.bytes,
      prompt: imagePrompt,
    });
  }

  logger.info(`Generated ${results.length} blog image(s).`, {
    style,
    logoPosition: effectivePosition,
    paths: results.map((r) => r.relativePath),
  });

  return results;
}

module.exports = {
  generateBlogImage,
  buildImagePrompt,
  buildAltText,
  normaliseCount,
  extensionFor,
  STYLE_DIRECTIVES,
  BASE_DIRECTIVES,
  DEFAULT_SIZE,
};
