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
const { IMAGE_STYLES, DEFAULT_IMAGE_STYLE, IMAGE_COUNT_MIN, IMAGE_COUNT_MAX, LOGO_POSITIONS } = require('../constants');
const { compositeLogo, DEFAULT_SIZE_RATIO, DEFAULT_OPACITY } = require('./logoComposite');
const { saveImage } = require('./storage');

/** Square by default: it is the one aspect every downstream surface crops well. */
const DEFAULT_SIZE = '1024x1024';

/**
 * The provider canvases we choose between (gpt-image-1 supports exactly these;
 * 1792x1024 is dall-e-3 only). There is no native 16:9, so the configured
 * output is reached by a blur fill (see resizeToConfiguredDefault) — picking
 * the canvas closest to the target's aspect keeps the filled strips narrow.
 * The old square request + `cover` crop threw away ~44% of a 16:9 image's
 * height (heads and faces cut off).
 */
const PROVIDER_CANVASES = Object.freeze([
  { size: '1536x1024', width: 1536, height: 1024 },
  { size: '1024x1024', width: 1024, height: 1024 },
  { size: '1024x1536', width: 1024, height: 1536 },
]);

/** Parses a configured `{width, height}` into its aspect ratio, or null when unusable. */
function aspectOf(target) {
  const width = Number(target?.width);
  const height = Number(target?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width / height;
}

/**
 * Picks the provider canvas whose aspect is closest to the configured output
 * (compared in log space, so 3:2 vs 1:1 and 1:1 vs 2:3 are equally far).
 *
 * @param {{width: number, height: number}} target
 * @returns {{size: string, width: number, height: number}}
 */
function providerCanvasForTarget(target) {
  const ratio = aspectOf(target);
  if (!ratio) return PROVIDER_CANVASES.find((c) => c.size === DEFAULT_SIZE);
  const distance = (c) => Math.abs(Math.log(c.width / c.height) - Math.log(ratio));
  return PROVIDER_CANVASES.reduce((best, c) => (distance(c) < distance(best) ? c : best));
}


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
 * These constraints are non-negotiable for this brand and are therefore not
 * caller-overridable:
 *
 *   - No text in the image. Image models render text badly, and a misspelt
 *     Sanskrit word on a Divinetalk asset is worse than no word at all.
 *   - Respectful depiction. The subject matter is Hindu religious practice, and
 *     an image that reads as kitsch or as parody is unpublishable.
 *   - Hopeful mood. "Dignity" alone made the model render solemn, worried
 *     faces — especially for topics like Sade Sati or doshas — so the mood is
 *     stated explicitly, and symbols are preferred over portraits.
 */
const BASE_DIRECTIVES =
  'Editorial header image for an article on a respected Indian astrology and ' +
  'spirituality publication. Treat the subject matter with dignity and cultural ' +
  'accuracy; avoid caricature, kitsch and religious parody. Do not render any ' +
  'words, letters, numerals or watermarks in the image. ' +
  'Mood: serene, hopeful, calm and uplifting — the feeling of guidance and ' +
  'reassurance, never fear. Any person shown looks peaceful or gently smiling; ' +
  'never sad, worried, crying or distressed. Prefer symbolic imagery over ' +
  'portraits: planets, the night sky, diyas, lotus flowers, yantras, temple ' +
  'silhouettes and sacred geometry. Show people only when the topic truly needs them.';

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
 * The style directive itself may be overridden by an admin via the Blog Image
 * Agent (stored in ScripturaSettings under `agents.image.style_overrides`,
 * one directive per style) — this is the ONLY thing an agent can change here.
 * `BASE_DIRECTIVES` below is never looked up from settings and is always
 * appended after whatever directive is chosen; that is the entire enforcement
 * mechanism for the dignity/no-text/no-watermark constraints staying locked.
 *
 * @param {object} args
 * @param {string} [args.prompt] Author-written subject description.
 * @param {string} [args.topic] The blog's topic/seed keyword.
 * @param {string} [args.style] One of constants.IMAGE_STYLES.
 * @param {number} [args.index] 0-based position in a multi-image run.
 * @param {number} [args.count] Total images in the run.
 * @returns {Promise<string>}
 */
async function buildImagePrompt({ prompt, topic, style = DEFAULT_IMAGE_STYLE, index = 0, count = 1 } = {}) {
  const subject = tidy(prompt) || tidy(topic);
  if (!subject) {
    throw ApiError.unprocessable('An image needs either a prompt or a topic to work from.', {
      code: 'IMAGE_PROMPT_EMPTY',
    });
  }

  // Lazy require: keeps this module loadable (and unit-testable) without
  // pulling in the full model registry for callers that never hit this path,
  // matching the lazy-require convention already used for `./ai` below.
  const { ScripturaSettings } = require('../models');
  const overrides = (await ScripturaSettings.getValue('agents.image.style_overrides', { fallback: {} })) || {};
  const directive = overrides[style]?.directive_text || STYLE_DIRECTIVES[style] || STYLE_DIRECTIVES[DEFAULT_IMAGE_STYLE];
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
function buildAltText({ topic, prompt, style = DEFAULT_IMAGE_STYLE, index = 0, count = 1 } = {}) {
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

/** Background for the blur fill is built at 1/BLUR_DOWNSCALE size, then scaled up — this is what keeps its gradients smooth (a full-size blur bands visibly). */
const BLUR_DOWNSCALE = 12;

/**
 * Fits the provider's raw output to the org's configured global default
 * WITHOUT cropping anything: the whole image is scaled to fit inside the
 * target and centred, and any leftover strips are filled with a blurred,
 * slightly darkened copy of the same image. Never a crop, never a distorting
 * stretch — a generated header image must never lose a head, face or symbol
 * (the old `cover` crop did, visibly, on the live site). When the aspects
 * already match, it is a plain resize.
 *
 * Applied to every image this file produces (featured image and block-level
 * regeneration both go through `generateBlogImage`). Best-effort: a resize
 * failure returns the original buffer rather than failing the whole
 * generation, same posture as `compositeLogo`'s own fail-open contract.
 *
 * @param {Buffer} buffer
 * @param {{width: number, height: number}} target
 * @returns {Promise<Buffer>}
 */
async function resizeToConfiguredDefault(buffer, target) {
  const { width: rawWidth, height: rawHeight } = target || {};
  const width = Math.round(Number(rawWidth));
  const height = Math.round(Number(rawHeight));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return buffer;

  try {
    const source = await sharp(buffer).metadata();
    const foreground = await sharp(buffer).resize(width, height, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
    const { width: fgWidth, height: fgHeight } = foreground.info;

    // Aspects match (within a pixel of rounding): nothing to fill.
    if (width - fgWidth <= 1 && height - fgHeight <= 1) {
      return await sharp(buffer).resize(width, height, { fit: 'fill' }).toFormat(source.format || 'png').toBuffer();
    }

    // Background: the image mirrored outwards into the empty strips, then
    // blurred — so a strip continues that side's own edge colours instead of
    // pulling centre content (a lit diya, a face) into the margin, and is not
    // darkened (dark bars stood out on light, flat illustrations). Built small
    // and scaled up so the gradients stay smooth. Separate pipelines on
    // purpose: sharp applies only the LAST resize in a chain, and extend/blur
    // ordering within one chain is not ours to choose.
    const smallWidth = Math.max(1, Math.round(width / BLUR_DOWNSCALE));
    const smallHeight = Math.max(1, Math.round(height / BLUR_DOWNSCALE));
    const small = await sharp(buffer).resize(smallWidth, smallHeight, { fit: 'inside' }).toBuffer({ resolveWithObject: true });
    const padX = Math.max(0, smallWidth - small.info.width);
    const padY = Math.max(0, smallHeight - small.info.height);
    // Mirroring cannot reach further than the image itself; extreme aspects fall back to repeating the edge.
    const canMirror = Math.ceil(padX / 2) <= small.info.width && Math.ceil(padY / 2) <= small.info.height;
    const smallExtended = await sharp(small.data)
      .extend({
        left: Math.floor(padX / 2),
        right: Math.ceil(padX / 2),
        top: Math.floor(padY / 2),
        bottom: Math.ceil(padY / 2),
        extendWith: canMirror ? 'mirror' : 'copy',
      })
      .toBuffer();
    const smallBlurred = await sharp(smallExtended).blur(3).toBuffer();
    const background = await sharp(smallBlurred).resize(width, height, { fit: 'fill', kernel: 'cubic' }).toBuffer();

    return await sharp(background)
      .composite([
        {
          input: foreground.data,
          left: Math.round((width - fgWidth) / 2),
          top: Math.round((height - fgHeight) / 2),
        },
      ])
      .toFormat(source.format || 'png')
      .toBuffer();
  } catch (err) {
    logger.warn("Image resize to the configured default size failed — using the provider's original output instead.", {
      message: err.message,
      target: { width, height },
    });
    return buffer;
  }
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
 * @param {string} [args.style] One of constants.IMAGE_STYLES. Default constants.DEFAULT_IMAGE_STYLE.
 * @param {boolean} [args.logoOverlay] Burn the brand logo in. Default false.
 * @param {string} [args.logoPosition] One of constants.LOGO_POSITIONS.
 * @param {number} [args.count] IMAGE_COUNT_MIN..IMAGE_COUNT_MAX. Default min.
 * @param {string} [args.size] Provider size hint, e.g. '1024x1024'. Omit to pick
 *   the canvas closest to the configured output aspect (what every caller does).
 * @param {number} [args.sizeRatio] Logo width / image width.
 * @param {number} [args.opacity] Logo opacity, 0..1.
 * @returns {Promise<Array<{relativePath: string, publicUrl: string, alt_text: string,
 *   has_logo_overlay: boolean, logo_position: string, width: number, height: number,
 *   bytes: number, prompt: string}>>}
 */
async function generateBlogImage({
  prompt,
  topic,
  style = DEFAULT_IMAGE_STYLE,
  logoOverlay = false,
  logoPosition = 'none',
  count,
  size,
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

  // P6-A: the org's configured global output size, read once per run (it
  // cannot change mid-run) — every image below is cropped to this via
  // `resizeToConfiguredDefault`, regardless of what `size` was requested
  // from the provider. Lazy require, same reasoning as `getImageProvider` above.
  const { ScripturaSettings } = require('../models');
  const { IMAGE_DEFAULTS_SETTINGS_KEY, IMAGE_DEFAULTS_FALLBACK } = require('../constants');
  const targetDimensions = await ScripturaSettings.getValue(IMAGE_DEFAULTS_SETTINGS_KEY, {
    fallback: IMAGE_DEFAULTS_FALLBACK,
  });

  // Ask the provider for the canvas closest to the configured aspect so the
  // blur-filled strips stay narrow. An explicit `size` still wins.
  const providerSize = size || providerCanvasForTarget(targetDimensions).size;

  const results = [];

  // Sequential, not Promise.all: image providers rate-limit aggressively and a
  // burst of 4 concurrent calls is the fastest way to get a 429 for the whole
  // set. Four sequential calls is also easier to attribute in the logs.
  for (let index = 0; index < total; index += 1) {
    /* eslint-disable-next-line no-await-in-loop */
    const imagePrompt = await buildImagePrompt({ prompt, topic, style, index, count: total });

    let generated;
    try {
      /* eslint-disable-next-line no-await-in-loop */
      generated = await provider.generateImage({ prompt: imagePrompt, size: providerSize, style });
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

    // P6-A: crop to the configured global default BEFORE the logo overlay,
    // so the logo is positioned against the final, served dimensions —
    // never the provider's raw (often square) output.
    /* eslint-disable-next-line no-await-in-loop */
    let buffer = await resizeToConfiguredDefault(generated.buffer, targetDimensions);
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
  resizeToConfiguredDefault,
  providerCanvasForTarget,
  STYLE_DIRECTIVES,
  BASE_DIRECTIVES,
  DEFAULT_SIZE,
};
