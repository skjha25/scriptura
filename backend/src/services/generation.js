'use strict';

/**
 * The article generation pipeline.
 *
 * ---------------------------------------------------------------------------
 * WHY IT RUNS IN-PROCESS AND NOT ON A QUEUE
 * ---------------------------------------------------------------------------
 * `startGeneration` validates, claims the row, returns 202, and lets the actual
 * work continue on the event loop after the response has been sent. There is no
 * Redis and no BullMQ.
 *
 * That is a deliberate MVP choice, not an oversight. Scriptura is an internal tool
 * for one small team on a single instance; a queue would add a second service to
 * operate, a second failure mode to debug, and a deployment story, in exchange
 * for durability that a team of five editors does not yet need.
 *
 * The costs are real and are paid for explicitly:
 *
 *   - A process restart mid-generation orphans the row in `generating`. That is
 *     what `reapStaleGenerations` is for; call it on boot and periodically.
 *   - Work is not distributed, so two instances behind a load balancer would
 *     each accept generations for the same row. The `generation_status` check is
 *     check-then-write and is NOT a distributed lock.
 *   - There is no retry-with-backoff at the job level. The provider layer retries
 *     transient upstream failures; anything past that surfaces as `failed` and
 *     the user retries from the wizard.
 *
 * The upgrade path, when a second instance or a durability requirement appears:
 * replace the body of `startGeneration` with a `queue.add()` and move
 * `runGeneration` into a BullMQ worker. Everything else — validation, the state
 * machine, the gate, the persistence — is already outside the "how it is
 * scheduled" concern, so that change stays local to this file.
 *
 * ---------------------------------------------------------------------------
 * THE STATE MACHINE
 * ---------------------------------------------------------------------------
 *   draft | generated | failed   --startGeneration-->  queued
 *   queued                       --runGeneration-->    generating
 *   generating                   --success-->          generated
 *   generating                   --failure-->          failed
 *
 * `queued` and `generating` are `GENERATION_IN_FLIGHT`: a start request against
 * either is a 409, because a second concurrent run would race the first one's
 * writes and the loser's content would vanish with no error anywhere.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SERVICE WILL NOT DO
 * ---------------------------------------------------------------------------
 * It never sets `blog_status` to published. Section 4 Step 6 requires a human
 * review pass in the block editor, and an automated publish would make that step
 * optional in practice. Generation ends at `generation_status = 'generated'`,
 * with `blog_status` untouched.
 */

const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { validateValue } = require('../middleware/validate');

const { AutomatedTopic } = require('../models');
const { getTextProvider } = require('./ai');
const { blocksToHtml, countWords } = require('./blocksToHtml');
const { sanitizeInline, toPlainText } = require('./sanitize');
const { scoreArticle, scoreTitle } = require('./seoScore');
const serp = require('./serp');
const {
  generationConfigSchema,
  generateTitleBody,
  generateOutlineBody,
} = require('../validators/generation.validators');
const { GENERATION_STATUS, GENERATION_IN_FLIGHT, GENERATION_RETRYABLE_FROM } = require('../constants');

/**
 * Rows stuck in `generating` for longer than this are assumed dead.
 *
 * Comfortably above the provider request timeout times the retry count, so a
 * legitimately slow run is never reaped out from under itself.
 */
const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;

/** Meta description target, matching the band services/seoScore.js rewards. */
const META_DESCRIPTION_TARGET = 155;

/**
 * Promises for runs started by this process, keyed by blog id.
 *
 * Two jobs, both of which a queue would otherwise do for us:
 *   1. Tests await a generation deterministically instead of polling.
 *   2. `reapStaleGenerations` can tell "this process is still working on it"
 *      from "some previous process died holding it".
 */
const inFlight = new Map();

/**
 * Validates a generation configuration.
 *
 * Exported so a unit test can assert the rules without an HTTP request, and so a
 * future re-generate action can re-validate a stored snapshot before replaying
 * it — a config that was valid in March may not satisfy today's schema.
 *
 * @param {object} input Raw configuration object.
 * @returns {object} Parsed, defaulted, stripped configuration.
 * @throws {ApiError} 422 VALIDATION_ERROR with per-field messages.
 */
function validateGenerationConfig(input) {
  return validateValue(generationConfigSchema, input, 'config');
}

/**
 * Resolves the effective brand voice and enforces the human-confirmation gate.
 *
 * The gate is the single most important rule in this file. Section 4 Step 2
 * requires that an AI-derived brand voice is reviewed by a person before it can
 * shape published content — a voice inferred from a scraped page can be wrong in
 * ways that are embarrassing rather than merely inaccurate, and once an article
 * is generated in the wrong voice the cost is a rewrite.
 *
 * The config wins over the stored row when it names a source, because the wizard
 * submission is the more recent statement of intent. When it does not, the row's
 * previously confirmed voice is used — that is what makes a re-generate of an
 * existing blog work without re-confirming.
 *
 * @param {object} blog Sequelize Blog instance.
 * @param {object} cfg Validated configuration.
 * @returns {{sourceType: string, sourceRef: string|null, tone: string|null, pov: string|null, traits: string[], summary: string|null}|null}
 * @throws {ApiError} 422 BRAND_VOICE_NOT_CONFIRMED
 */
function resolveBrandVoice(blog, cfg) {
  const supplied = cfg.brand_voice || {};
  const configSource = supplied.source_type || 'none';
  const rowSource = blog.brand_voice_source_type || 'none';

  const fromConfig = configSource !== 'none';
  const sourceType = fromConfig ? configSource : rowSource;
  const confirmed = fromConfig ? supplied.confirmed === true : blog.brand_voice_confirmed === true;

  if (sourceType !== 'none' && !confirmed) {
    throw ApiError.unprocessable(
      'The brand voice has not been confirmed. Review the analysed tone, point of view and ' +
        'style rules and confirm them before generating the article.',
      {
        code: 'BRAND_VOICE_NOT_CONFIRMED',
        details: { brand_voice_source_type: sourceType, confirmed_from: fromConfig ? 'config' : 'blog' },
      }
    );
  }

  if (sourceType === 'none') return null;

  return fromConfig
    ? {
        sourceType,
        sourceRef: supplied.source_ref ?? null,
        tone: supplied.tone ?? null,
        pov: supplied.pov ?? null,
        traits: supplied.traits || [],
        summary: supplied.summary ?? null,
      }
    : {
        sourceType,
        sourceRef: blog.brand_voice_source_ref ?? null,
        tone: blog.brand_voice_tone ?? null,
        pov: blog.brand_voice_pov ?? null,
        traits: blog.brand_voice_traits || [],
        summary: null,
      };
}

/**
 * Turns `internal_link_targets` (ids and/or slugs) into `{slug, title}` pairs.
 *
 * Only published, non-deleted rows are eligible — linking a reader to a draft is
 * a 404 for them and a wasted internal link for us. Silently drops targets that
 * no longer qualify rather than failing the run, because a target being
 * unpublished between wizard submission and generation is normal.
 *
 * @param {object} cfg Validated configuration.
 * @returns {Promise<Array<{slug: string, title: string}>>}
 */
async function resolveInternalLinks(cfg) {
  if (!cfg.internal_linking) return [];
  const targets = cfg.internal_link_targets || [];
  if (targets.length === 0) return [];

  const { Op } = require('sequelize');
  const { Blog } = require('../models');

  const ids = targets.filter((t) => typeof t === 'number').map(Number);
  const slugs = targets.filter((t) => typeof t === 'string');

  const rows = await Blog.scope('linkable').findAll({
    where: {
      [Op.or]: [...(ids.length ? [{ id: { [Op.in]: ids } }] : []), ...(slugs.length ? [{ slug: { [Op.in]: slugs } }] : [])],
    },
    limit: 20,
  });

  return rows
    .filter((row) => row.slug)
    .map((row) => ({ slug: row.slug, title: row.blog_title }));
}

/**
 * Derives a meta description from the article's own opening.
 *
 * Used only when neither the wizard nor the model supplied one. Built from the
 * lead paragraph rather than from a separate model call: it is the copy the
 * author already approved, it costs nothing, and a paid round trip to rewrite
 * 155 characters is poor value.
 *
 * @param {Array} blocks
 * @returns {string}
 */
function deriveMetaDescription(blocks) {
  const lead = (Array.isArray(blocks) ? blocks : []).find(
    (block) => block?.type === 'paragraph' && (block.data?.text || block.data?.html)
  );
  const text = toPlainText(lead?.data?.html || '') || String(lead?.data?.text || '');
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= META_DESCRIPTION_TARGET) return cleaned;

  // Cut at the last sentence end inside the budget, falling back to a word
  // boundary, so the description never stops mid-word with an ellipsis.
  const window = cleaned.slice(0, META_DESCRIPTION_TARGET);
  const sentenceEnd = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
  if (sentenceEnd > META_DESCRIPTION_TARGET * 0.5) return window.slice(0, sentenceEnd + 1).trim();
  const wordEnd = window.lastIndexOf(' ');
  return `${window.slice(0, wordEnd > 0 ? wordEnd : window.length).trim()}...`;
}

/**
 * Reads an outline back out of the generated blocks.
 *
 * Used when the wizard supplied no outline. Deriving it from the article that
 * actually exists is better than a second provider call in two ways: it costs
 * nothing, and it cannot disagree with the content — `blogs.outline` is what the
 * editor renders as the document map, so an outline describing sections the
 * article does not have would be worse than none.
 *
 * @param {Array} blocks
 * @returns {Array<{level: number, text: string}>}
 */
function outlineFromBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block?.type === 'heading')
    .map((block) => {
      const level = Number.parseInt(block.data?.level, 10);
      const text = toPlainText(block.data?.html || '') || String(block.data?.text || '').trim();
      return { level: level === 3 ? 3 : 2, text };
    })
    .filter((section) => section.text !== '');
}

/**
 * Builds the provider-facing options object from a validated config.
 * @private
 */
function providerOptionsFor({ cfg, blog, brandVoice, internalLinks, groundingBrief }) {
  return {
    topic: cfg.topic || blog.topic || blog.blog_title,
    title: cfg.title || blog.blog_title,
    keyword: cfg.keyword || blog.seo_keywords || undefined,
    secondaryKeywords: cfg.secondary_keywords || [],
    outline: cfg.outline && cfg.outline.length ? cfg.outline : blog.outline || [],
    targetWordCount: cfg.target_word_count,
    articleType: cfg.article_type,
    toneOfVoice: cfg.tone_of_voice || brandVoice?.tone || undefined,
    pointOfView: cfg.point_of_view || brandVoice?.pov || undefined,
    readabilityLevel: cfg.readability_level,
    language: cfg.language,
    targetCountry: cfg.target_country,
    aiContentCleaning: cfg.ai_content_cleaning,
    seoStructure: cfg.seo_structure_config,
    brandVoice: brandVoice
      ? { tone: brandVoice.tone, pov: brandVoice.pov, traits: brandVoice.traits, summary: brandVoice.summary }
      : undefined,
    internalLinks,
    imageCount: cfg.include_images ? cfg.image_count : 0,
    groundingFacts: groundingBrief || undefined,
  };
}

/**
 * Performs one generation run against an already-claimed row.
 *
 * Exported because integration tests need to await a run deterministically, and
 * because a future BullMQ worker's processor is exactly this function. Not called
 * directly by any controller — `startGeneration` owns the claim.
 *
 * @param {number|string} blogId
 * @param {object} cfg Validated configuration.
 * @param {object} [options]
 * @param {object} [options.provider] Text provider override, for tests.
 * @returns {Promise<{status: string, blogId: number, seo_score?: number, word_count?: number, error?: string}>}
 */
async function runGeneration(blogId, cfg, { provider } = {}) {
  const { Blog } = require('../models');
  const blog = await Blog.findByPk(blogId);

  if (!blog) {
    // The row was deleted between claim and run. Nothing to fail against.
    logger.warn('Generation target disappeared before the run started.', { blogId });
    return { status: 'abandoned', blogId: Number(blogId) };
  }

  try {
    blog.generation_status = GENERATION_STATUS.GENERATING;
    blog.generation_error = null;
    await blog.save();

    const brandVoice = resolveBrandVoice(blog, cfg);
    const internalLinks = await resolveInternalLinks(cfg);

    // Grounding is best-effort by design: safeGroundFacts returns null both when
    // the feature is off (the normal case) and when SerpAPI failed. Either way
    // the article is written without it, which is exactly how every deployment
    // that never enabled SERP behaves.
    const grounding = cfg.external_web_grounding
      ? await serp.safeGroundFacts({
          topic: cfg.topic,
          keyword: cfg.keyword,
          country: cfg.target_country,
        })
      : null;

    const textProvider = provider || getTextProvider();
    const options = providerOptionsFor({
      cfg,
      blog,
      brandVoice,
      internalLinks,
      groundingBrief: grounding?.brief,
    });

    const result = await textProvider.generateArticle(options);
    const blocks = result.blocks;

    // blog_content is DERIVED, never hand-built. The renderer is the only thing
    // that may produce the HTML the public site reads — see the model's header.
    const html = blocksToHtml(blocks);
    const wordCount = countWords(blocks);

    const metaDescription =
      cfg.meta_description ||
      blog.meta_description ||
      (result.meta_description ? sanitizeInline(result.meta_description) : '') ||
      deriveMetaDescription(blocks);

    const metaTitle =
      cfg.meta_title ||
      blog.meta_title ||
      (result.meta_title ? sanitizeInline(result.meta_title) : '') ||
      String(blog.blog_title || '').slice(0, 60);

    const { score } = scoreArticle({
      title: blog.blog_title,
      blocks,
      keyword: cfg.keyword || blog.seo_keywords,
      secondaryKeywords: cfg.secondary_keywords,
      metaDescription,
    });

    // These four are written explicitly even though models/blog.js has a
    // beforeSave hook that derives blog_content, word_count and seo_score from
    // content_blocks. Both paths call the same functions on the same inputs, so
    // they agree — and writing them here keeps this service correct on its own
    // terms rather than depending on a hook it does not own. The metadata below
    // is assigned before the save so the hook's re-score sees the same keyword
    // and meta description this service scored against.
    blog.content_blocks = blocks;
    blog.blog_content = html;
    blog.word_count = wordCount;
    blog.seo_score = score;
    blog.meta_title = metaTitle || null;
    blog.meta_description = metaDescription || null;

    // Prefer the approved outline — it is the human artifact the article was
    // written against. With none, read one back off the generated headings so the
    // editor always has a document map.
    const usedOutline =
      options.outline && options.outline.length ? options.outline : outlineFromBlocks(blocks);
    if (usedOutline.length > 0) blog.outline = usedOutline;

    // Wizard settings that describe the article are mirrored onto the row so the
    // editor and the public page reflect what was actually generated.
    blog.article_type = cfg.article_type;
    blog.readability_level = cfg.readability_level;
    blog.language = cfg.language;
    if (cfg.tone_of_voice || brandVoice?.tone) blog.tone_of_voice = cfg.tone_of_voice || brandVoice.tone;
    if (cfg.point_of_view || brandVoice?.pov) blog.point_of_view = cfg.point_of_view || brandVoice.pov;
    if (cfg.target_country) blog.target_country = cfg.target_country;
    blog.ai_content_cleaning = cfg.ai_content_cleaning;
    blog.internal_linking = cfg.internal_linking;
    blog.external_web_grounding = cfg.external_web_grounding;
    blog.seo_structure_config = cfg.seo_structure_config;
    if (cfg.secondary_keywords?.length) blog.secondary_keywords = cfg.secondary_keywords;
    if (cfg.keyword) blog.seo_keywords = cfg.keyword;
    if (cfg.topic) blog.topic = cfg.topic;

    if (brandVoice) {
      blog.brand_voice_source_type = brandVoice.sourceType;
      blog.brand_voice_source_ref = brandVoice.sourceRef;
      blog.brand_voice_tone = brandVoice.tone;
      blog.brand_voice_pov = brandVoice.pov;
      blog.brand_voice_traits = brandVoice.traits;
      // Only reachable when the gate above passed, i.e. a human confirmed it.
      blog.brand_voice_confirmed = true;
    }

    blog.generation_status = GENERATION_STATUS.GENERATED;
    blog.generation_error = null;

    // Record what the run actually did alongside the submitted config, so an
    // article's sourcing and provider are auditable months later. The queued
    // snapshot's `_run` is merged rather than replaced, because that is where
    // `requested_by` lives — losing who asked for an article would defeat the
    // point of keeping the snapshot at all.
    const queuedRun = blog.generation_config?._run || {};
    blog.generation_config = {
      ...cfg,
      _run: {
        ...queuedRun,
        completed_at: new Date().toISOString(),
        provider: textProvider.name,
        serp_enabled: serp.isEnabled(),
        grounding_used: Boolean(grounding),
        grounding_sources: (grounding?.sources || []).map((s) => s.url).filter(Boolean),
        internal_links_used: internalLinks.map((l) => l.slug),
        outline_source: options.outline && options.outline.length ? 'approved' : 'derived',
        block_count: blocks.length,
        word_count: wordCount,
        seo_score: score,
      },
    };

    // NOTE: blog_status is deliberately untouched. See the file header.
    await blog.save();

    if (blog.keyword_pool_id) {
      try {
        const { ScripturaKeyword } = require('../models');
        const keywordPoolRow = await ScripturaKeyword.findByPk(blog.keyword_pool_id);
        if (keywordPoolRow) {
          keywordPoolRow.status = 'used';
          keywordPoolRow.used_in_blog_id = blog.id;
          await keywordPoolRow.save();
        }
      } catch (poolErr) {
        logger.error('Failed to update keyword pool status', { blogId: blog.id, keywordPoolId: blog.keyword_pool_id, error: poolErr.message });
      }
    }

    logger.info('Generation completed', {
      blogId: blog.id,
      words: wordCount,
      score,
      blocks: blocks.length,
      provider: textProvider.name,
    });

    return { status: GENERATION_STATUS.GENERATED, blogId: Number(blog.id), seo_score: score, word_count: wordCount };
  } catch (err) {
    // The message is shown in the wizard, so it has to be actionable. ApiError
    // messages already are (they name the provider and the status); anything else
    // gets a generic wrapper rather than leaking a stack trace into a column that
    // the frontend renders.
    const message =
      err instanceof ApiError
        ? err.message
        : `Generation failed unexpectedly: ${err?.message || 'unknown error'}`;

    logger.error('Generation failed', { blogId, code: err?.code, message: err?.message, stack: err?.stack });

    try {
      const failed = await Blog.findByPk(blogId);
      if (failed) {
        failed.generation_status = GENERATION_STATUS.FAILED;
        // Truncated: generation_error is TEXT, but a multi-kilobyte provider dump
        // in a UI field is unreadable and the full detail is already in the log.
        failed.generation_error = message.slice(0, 2000);
        await failed.save();
      }
    } catch (saveErr) {
      // If we cannot even record the failure the row stays in `generating` and
      // reapStaleGenerations will recover it. Nothing better is available here.
      logger.error('Could not record the generation failure.', {
        blogId,
        message: saveErr?.message,
      });
    }

    return { status: GENERATION_STATUS.FAILED, blogId: Number(blogId), error: message };
  }
}

/**
 * Claims a blog row and starts a generation run.
 *
 * Returns as soon as the row is claimed; the run continues on the event loop.
 * The caller should respond 202 and let the client poll
 * `GET /generate/status/:blogId`.
 *
 * @param {object} input
 * @param {number|string} input.blogId
 * @param {object} input.config Raw configuration; validated here.
 * @param {{id: number, name: string, email: string}} input.user Who asked.
 * @param {object} [options]
 * @param {object} [options.provider] Text provider override, for tests.
 * @returns {Promise<{blog_id: number, generation_status: string, queued_at: string}>}
 * @throws {ApiError} 404 when the blog is missing, 409 GENERATION_IN_PROGRESS,
 *   422 VALIDATION_ERROR or BRAND_VOICE_NOT_CONFIRMED.
 */
async function startGeneration({ blogId, config: rawConfig, user } = {}, options = {}) {
  const { Blog } = require('../models');

  const cfg = validateGenerationConfig(rawConfig);

  const blog = await Blog.findByPk(blogId);
  if (!blog) throw ApiError.notFound(`Blog ${blogId} was not found.`);

  const current = blog.generation_status || GENERATION_STATUS.DRAFT;

  if (GENERATION_IN_FLIGHT.includes(current)) {
    throw ApiError.conflict(
      `A generation run is already ${current} for this blog. Wait for it to finish, or retry once it has failed.`,
      {
        code: 'GENERATION_IN_PROGRESS',
        details: { blog_id: Number(blog.id), generation_status: current },
      }
    );
  }

  if (!GENERATION_RETRYABLE_FROM.includes(current)) {
    // Defensive: today the two sets partition the enum, so this is unreachable.
    // It stays because adding a sixth status without revisiting this file is a
    // plausible future mistake, and silently allowing it would be worse.
    throw ApiError.conflict(`Generation cannot start from status "${current}".`, {
      code: 'GENERATION_NOT_ALLOWED',
      details: { generation_status: current, allowed_from: GENERATION_RETRYABLE_FROM },
    });
  }

  // Gate BEFORE claiming the row: a refused request must leave the blog exactly
  // as it was, not parked in `queued` with nothing coming.
  resolveBrandVoice(blog, cfg);

  const queuedAt = new Date();
  blog.generation_status = GENERATION_STATUS.QUEUED;
  blog.generation_error = null;
  blog.generation_config = {
    ...cfg,
    _run: {
      queued_at: queuedAt.toISOString(),
      requested_by: user ? { id: user.id, email: user.email } : null,
      serp_enabled: serp.isEnabled(),
    },
  };
  await blog.save();

  // Fire and forget. `.finally` clears the registry entry so a long-lived process
  // does not accumulate resolved promises.
  const run = runGeneration(blog.id, cfg, options).finally(() => {
    inFlight.delete(Number(blog.id));
  });
  inFlight.set(Number(blog.id), run);

  // The rejection path is already handled inside runGeneration, which never
  // rejects — but an unhandled rejection here would take the process down, so the
  // guard stays.
  run.catch((err) => logger.error('Generation promise rejected', { blogId: blog.id, message: err?.message }));

  return {
    blog_id: Number(blog.id),
    generation_status: GENERATION_STATUS.QUEUED,
    queued_at: queuedAt.toISOString(),
  };
}

/**
 * Awaits every run this process started.
 *
 * For tests, and for a graceful shutdown that would rather finish an in-flight
 * article than orphan it. Resolves immediately when nothing is running.
 *
 * @returns {Promise<void>}
 */
async function awaitGenerations() {
  while (inFlight.size > 0) {
    // Re-read each pass: a run may start another (it does not today, but
    // awaiting a snapshot would silently miss it if one ever did).
    await Promise.allSettled([...inFlight.values()]);
  }
}

/** Blog ids this process is currently generating. */
function inFlightBlogIds() {
  return [...inFlight.keys()];
}

/**
 * Recovers rows abandoned in an in-flight state.
 *
 * This is the price of running in-process: a deploy or a crash during a
 * generation leaves `generation_status = 'generating'` with nothing working on
 * it, and the wizard would poll that forever. Marking them `failed` puts them
 * back in `GENERATION_RETRYABLE_FROM` so the user can simply retry.
 *
 * Rows this process is actively generating are excluded even if they are old,
 * because a slow-but-live run is not stale.
 *
 * Call on boot, and on an interval if the process is long-lived.
 *
 * @param {object} [input]
 * @param {number} [input.olderThanMs] Age threshold, default 30 minutes.
 * @returns {Promise<{reaped: number, blog_ids: number[]}>}
 */
async function reapStaleGenerations({ olderThanMs = DEFAULT_STALE_AFTER_MS } = {}) {
  const { Op } = require('sequelize');
  const { Blog } = require('../models');

  const cutoff = new Date(Date.now() - Math.max(0, olderThanMs));
  const active = inFlightBlogIds();

  const stale = await Blog.findAll({
    where: {
      generation_status: { [Op.in]: [...GENERATION_IN_FLIGHT] },
      updated_at: { [Op.lt]: cutoff },
      ...(active.length ? { id: { [Op.notIn]: active } } : {}),
    },
  });

  const ids = [];
  for (const blog of stale) {
    blog.generation_status = GENERATION_STATUS.FAILED;
    blog.generation_error =
      `Generation was interrupted (the server restarted or the run exceeded ` +
      `${Math.round(olderThanMs / 60000)} minutes). The saved configuration is unchanged — retry from the wizard.`;
    await blog.save();
    ids.push(Number(blog.id));
  }

  if (ids.length > 0) {
    logger.warn(`Recovered ${ids.length} interrupted generation(s) to failed.`, { blogIds: ids });
  }

  return { reaped: ids.length, blog_ids: ids };
}

/**
 * The polling payload for one blog.
 *
 * Deliberately narrow: the wizard polls this every couple of seconds while a run
 * is in flight, and returning the whole row (including `content_blocks`, which is
 * the largest column in the table) would make that poll expensive for no benefit.
 *
 * @param {number|string} blogId
 * @returns {Promise<{blog_id: number, generation_status: string, generation_error: string|null, seo_score: number|null, word_count: number|null, updated_at: string}>}
 * @throws {ApiError} 404 when the blog does not exist.
 */
async function getGenerationStatus(blogId) {
  const { Blog } = require('../models');

  const blog = await Blog.findByPk(blogId, {
    attributes: ['id', 'generation_status', 'generation_error', 'seo_score', 'word_count', 'updated_at'],
  });
  if (!blog) throw ApiError.notFound(`Blog ${blogId} was not found.`);

  return {
    blog_id: Number(blog.id),
    generation_status: blog.generation_status || GENERATION_STATUS.DRAFT,
    generation_error: blog.generation_error || null,
    seo_score: blog.seo_score === null || blog.seo_score === undefined ? null : Number(blog.seo_score),
    word_count: blog.word_count === null || blog.word_count === undefined ? null : Number(blog.word_count),
    updated_at: blog.updated_at instanceof Date ? blog.updated_at.toISOString() : blog.updated_at,
    is_in_flight: GENERATION_IN_FLIGHT.includes(blog.generation_status),
  };
}

/**
 * Suggests titles and scores each one.
 *
 * Scoring here rather than in the frontend means the wizard's "SEO score" column
 * and the article's stored `seo_score` come from the same code — a title that
 * shows 82 in the picker cannot score differently once chosen.
 *
 * @param {object} input Raw request body; validated against generateTitleBody.
 * @param {object} [options]
 * @param {object} [options.provider]
 * @returns {Promise<{titles: Array<{title: string, angle: string|null, char_count: number, seo: object}>, provider: string}>}
 */
async function generateTitles(input, { provider } = {}) {
  const body = validateValue(generateTitleBody, input, 'body');
  const textProvider = provider || getTextProvider();

  const { titles } = await textProvider.generateTitles({
    topic: body.topic,
    keyword: body.keyword,
    secondaryKeywords: body.secondary_keywords,
    articleType: body.article_type,
    count: body.count,
    toneOfVoice: body.tone_of_voice,
    pointOfView: body.point_of_view,
    readabilityLevel: body.readability_level,
    language: body.language,
    targetCountry: body.target_country,
    brandVoice:
      body.brand_voice && body.brand_voice.source_type !== 'none'
        ? {
            tone: body.brand_voice.tone,
            pov: body.brand_voice.pov,
            traits: body.brand_voice.traits,
            summary: body.brand_voice.summary,
          }
        : undefined,
  });

  const keyword = body.keyword || body.topic;

  return {
    provider: textProvider.name,
    titles: titles.map((entry) => {
      // Titles come back from a model, so they are untrusted text that will be
      // rendered in the picker. sanitizeInline strips anything that is not plain
      // inline formatting.
      const safe = sanitizeInline(entry.title) || entry.title;
      const plain = toPlainText(safe) || safe;
      return {
        title: plain,
        angle: entry.angle,
        char_count: plain.length,
        seo: scoreTitle(plain, { keyword }),
      };
    }),
  };
}

/**
 * Generates an outline, optionally persisting it to a blog.
 *
 * Persisting when `blog_id` is present is what makes the wizard's two-step flow
 * work: the outline is generated, edited by hand in step 3, and read back by the
 * article run from `blogs.outline`. Refused while a run is in flight, because
 * overwriting the outline mid-article would produce content that does not match
 * the stored plan.
 *
 * @param {object} input Raw request body; validated against generateOutlineBody.
 * @param {object} [options]
 * @param {object} [options.provider]
 * @returns {Promise<{outline: Array<{level: number, text: string}>, provider: string, saved_to_blog_id: number|null, grounding_used: boolean}>}
 */
async function generateOutline(input, { provider } = {}) {
  const body = validateValue(generateOutlineBody, input, 'body');
  const textProvider = provider || getTextProvider();

  const grounding = body.external_web_grounding
    ? await serp.safeGroundFacts({ topic: body.topic, keyword: body.keyword, country: body.target_country })
    : null;

  const { outline } = await textProvider.generateOutline({
    topic: body.topic,
    title: body.title,
    keyword: body.keyword,
    secondaryKeywords: body.secondary_keywords,
    articleType: body.article_type,
    targetWordCount: body.target_word_count,
    seoStructure: body.seo_structure_config,
    toneOfVoice: body.tone_of_voice,
    pointOfView: body.point_of_view,
    readabilityLevel: body.readability_level,
    language: body.language,
    targetCountry: body.target_country,
    groundingFacts: grounding?.brief,
    brandVoice:
      body.brand_voice && body.brand_voice.source_type !== 'none'
        ? {
            tone: body.brand_voice.tone,
            pov: body.brand_voice.pov,
            traits: body.brand_voice.traits,
            summary: body.brand_voice.summary,
          }
        : undefined,
  });

  const safeOutline = outline.map((section) => ({
    level: section.level,
    text: toPlainText(sanitizeInline(section.text)) || section.text,
  }));

  let savedTo = null;
  if (body.blog_id !== undefined) {
    const { Blog } = require('../models');
    const blog = await Blog.findByPk(body.blog_id);
    if (!blog) throw ApiError.notFound(`Blog ${body.blog_id} was not found.`);
    if (GENERATION_IN_FLIGHT.includes(blog.generation_status)) {
      throw ApiError.conflict('Cannot replace the outline while a generation run is in flight.', {
        code: 'GENERATION_IN_PROGRESS',
        details: { blog_id: Number(blog.id), generation_status: blog.generation_status },
      });
    }
    blog.outline = safeOutline;
    await blog.save();
    savedTo = Number(blog.id);
  }

  return {
    provider: textProvider.name,
    outline: safeOutline,
    saved_to_blog_id: savedTo,
    grounding_used: Boolean(grounding),
  };
}

/**
 * Auto-generates a trending astrology topic, keywords, and title suggestions.
 *
 * Used by the fully automated blog page: the user clicks one button and the
 * system picks a topic, generates a title, and runs the full pipeline.
 *
 * @param {object} [options]
 * @param {object} [options.provider] Text provider override, for tests.
 * @returns {Promise<{topic: string, seo_keywords: string, secondary_keywords: string[], titles: Array<{title: string, char_count: number, seo: object}>}>}
 */
async function generateAutoTopic({ provider } = {}) {
  const textProvider = provider || getTextProvider();
  const { ScripturaKeyword } = require('../models');

  let keywordRow = await ScripturaKeyword.findOne({
    where: { status: 'not_used' },
    order: [['created_at', 'ASC']],
  });

  let primaryKeyword;
  let secondaryKeywords = [];
  let serpData = null;

  if (!keywordRow) {
    // Fallback: Generate keyword from Claude if none found
    const dbTopics = await AutomatedTopic.findAll();
    let astrologyTopics = [];
    
    if (dbTopics && dbTopics.length > 0) {
      astrologyTopics = dbTopics.map((t) => t.topic);
    } else {
      astrologyTopics = [
        'Mercury Retrograde effects', 'Full Moon astrology', 'Zodiac compatibility',
        'Saturn Return meaning', 'Jupiter transit horoscope', 'Venus retrograde love',
        'Solar eclipse astrology', 'Lunar nodes karma', 'Pisces season predictions',
        'Aries season energy', 'Natal chart reading', 'Moon sign personality',
        'Horoscope weekly predictions', 'Astrology birth chart', 'Planetary alignment effects',
      ];
    }
  
    const randomTopic = astrologyTopics[Math.floor(Math.random() * astrologyTopics.length)];
    primaryKeyword = randomTopic.toLowerCase();
    
    keywordRow = await ScripturaKeyword.create({
      primary_keyword: primaryKeyword,
      status: 'in_progress'
    });
  } else {
    primaryKeyword = keywordRow.primary_keyword;
    secondaryKeywords = keywordRow.secondary_keywords || [];
    keywordRow.status = 'in_progress';
    await keywordRow.save();
  }

  if (serp.isEnabled()) {
    try {
      serpData = await serp.fetchSerpDataForKeyword(primaryKeyword);
      keywordRow.serp_data = serpData;
      await keywordRow.save();
    } catch (err) {
      logger.warn('Failed to fetch SERP data for keyword-first autopilot', { error: err.message });
    }
  }

  // Suggest topics, injecting SERP data
  const { titles, topic, suggested_secondary_keywords } = await textProvider.generateAutoTopicFromKeyword({
    keyword: primaryKeyword,
    secondaryKeywords,
    serpData
  });

  return {
    provider: textProvider.name,
    topic: topic || primaryKeyword,
    seo_keywords: primaryKeyword,
    secondary_keywords: suggested_secondary_keywords || secondaryKeywords,
    titles: titles.map((entry) => {
      const safe = sanitizeInline(entry.title) || entry.title;
      const plain = toPlainText(safe) || safe;
      return {
        title: plain,
        char_count: plain.length,
        seo: scoreTitle(plain, { keyword: primaryKeyword }),
      };
    }),
  };
}

module.exports = {
  validateGenerationConfig,
  startGeneration,
  runGeneration,
  reapStaleGenerations,
  getGenerationStatus,
  generateTitles,
  generateOutline,
  generateAutoTopic,
  resolveBrandVoice,
  resolveInternalLinks,
  deriveMetaDescription,
  outlineFromBlocks,
  awaitGenerations,
  inFlightBlogIds,
  DEFAULT_STALE_AFTER_MS,
  META_DESCRIPTION_TARGET,
};
