// frontend/src/components/wizard/Step6Generate.js
/**
 * Step 6 — start the run, then watch it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS POLLS
 * ---------------------------------------------------------------------------
 * POST /generate/article returns 202 and keeps working; the article takes tens of
 * seconds to a couple of minutes. So the request cannot be awaited — it is
 * accepted, and `GET /blogs/:id/generation-status` is the only view of what
 * happens next. Polling stops the moment the status leaves GENERATION_IN_FLIGHT,
 * which matters: the status endpoint is deliberately not rate-limited, and a poll
 * that never stops would hammer it for the life of the tab.
 *
 * The progress indicator reports STAGES, not a percentage. The API exposes
 * queued → generating → generated and nothing finer, so a percentage would be a
 * number this screen invented. The elapsed clock next to it is real, and between
 * them the author can tell "working" from "stuck" — which is the actual question.
 *
 * On success this navigates to the editor. It never publishes: the human review
 * pass is the entire point of ending at `generated` with `blog_status` untouched.
 */

import { useCallback, useState } from 'react';

import { blogsApi, generateApi } from '../../lib/api';
import {
  ARTICLE_TYPE_LABELS,
  GENERATION_IN_FLIGHT,
  GENERATION_STATUS,
  IMAGE_STYLE_LABELS,
  LOGO_POSITION_LABELS,
  OPTIMIZATION_PROFILE_META,
  READABILITY_LABELS,
} from '../../lib/constants';
import { useInterval } from '../../hooks/useDebouncedValue';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';
import {
  Card,
  CardHeader,
  ErrorBanner,
  GenerationBadge,
  InfoBanner,
} from '../ui/feedback';
import TriScoreBadge from '../shared/TriScoreBadge';
import { publishModeOf, PUBLISH_MODES } from './steps';

/** Two seconds. Fast enough to feel live, slow enough to be a rounding error. */
const POLL_MS = 2000;

/** The stages the author is shown, in order. */
const STAGES = Object.freeze([
  { status: GENERATION_STATUS.QUEUED, label: 'Queued' },
  { status: GENERATION_STATUS.GENERATING, label: 'Writing the article' },
  { status: GENERATION_STATUS.GENERATED, label: 'Done' },
]);

/**
 * Builds the `config` half of the /generate/article body from wizard state.
 *
 * Three deliberate omissions, each with a reason:
 *
 *   - `outline`. The generation schema caps a heading at level 3, but
 *     `blogs.outline` allows 4 and the builder in step 3 offers 4. The service
 *     falls back to the row's outline when the config supplies none, so leaving it
 *     out is what preserves the author's H4 rows instead of silently flattening
 *     them. The row is written by the wizard's own autosave, so it is never stale.
 *
 *   - `target_word_count`. There is no column for it, so a value set here could
 *     not survive a refresh — and a setting that quietly resets is worse than one
 *     that was never offered. The server's 1200-word default applies.
 *
 *   - `meta_title` / `meta_description`. Written by the generator and refined in
 *     the editor, where the score for them is visible.
 *
 * Enum fields are omitted rather than sent empty: the schema is strict, and `''`
 * is not a member of any of these enums.
 *
 * @param {object} config Wizard state.
 * @returns {object} A body matching generationConfigSchema.
 */
export function buildGenerationConfig(config) {
  const keyword = (config.seo_keywords || config.topic || '').trim();
  const sourceType = config.brand_voice_source_type || 'none';

  const brandVoice = { source_type: sourceType, confirmed: config.brand_voice_confirmed === true };
  if (sourceType !== 'none') {
    if (config.brand_voice_source_ref) brandVoice.source_ref = config.brand_voice_source_ref;
    if (config.brand_voice_tone) brandVoice.tone = config.brand_voice_tone;
    if (config.brand_voice_pov) brandVoice.pov = config.brand_voice_pov;
    brandVoice.traits = config.brand_voice_traits || [];
  }

  const built = {
    topic: (config.topic || '').trim(),
    title: (config.blog_title || '').trim() || undefined,
    keyword: keyword || undefined,
    secondary_keywords: config.secondary_keywords || [],

    article_type: config.article_type || 'general',
    readability_level: config.readability_level || '8th_grade',
    language: (config.language || 'en').trim(),
    ai_content_cleaning: Boolean(config.ai_content_cleaning),

    seo_structure_config: config.seo_structure_config || {},
    internal_linking: Boolean(config.internal_linking),
    internal_link_targets: config.internal_linking ? config.internal_link_targets || [] : [],
    external_web_grounding: Boolean(config.external_web_grounding),

    brand_voice: brandVoice,

    include_images: config.include_images !== false,
    image_count: Number(config.image_count) || 1,
    image_style: config.image_style || 'photo',
    logo_overlay: Boolean(config.logo_overlay),
    logo_position: config.logo_position || 'none',

    // Which score this run should lean on — read by prompts.js to add
    // AEO/GEO-specific generation directives. Omitted-as-'balanced' rather than
    // required: a config saved before this field existed should not fail to
    // generate.
    optimization_profile: config.optimization_profile || 'balanced',
  };

  if (config.tone_of_voice) built.tone_of_voice = config.tone_of_voice;
  if (config.point_of_view) built.point_of_view = config.point_of_view;
  if (config.target_country) built.target_country = config.target_country;

  return built;
}

/** Whole seconds, as "1m 24s" once a minute has passed. */
function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export default function Step6Generate({ config, blogId, initialStatus, onGenerated, onGoToStep, onBeforeSubmit }) {
  const [status, setStatus] = useState(initialStatus || GENERATION_STATUS.DRAFT);
  const [generationError, setGenerationError] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [startedAt, setStartedAt] = useState(() =>
    GENERATION_IN_FLIGHT.includes(initialStatus) ? Date.now() : null
  );
  const [elapsed, setElapsed] = useState(0);
  const [lastResult, setLastResult] = useState(null);

  const inFlight = GENERATION_IN_FLIGHT.includes(status);
  const failed = status === GENERATION_STATUS.FAILED;
  const done = status === GENERATION_STATUS.GENERATED;

  const poll = useCallback(async () => {
    try {
      const next = await blogsApi.generationStatus(blogId);
      if (!next?.generation_status) return;

      setStatus(next.generation_status);
      setGenerationError(next.generation_error || null);
      setError(null);
      if (next.generation_status === GENERATION_STATUS.GENERATED) {
        setLastResult(next);
        onGenerated(next);
      }
    } catch (err) {
      // A failed poll is not a failed generation — the run continues server-side.
      // Surfacing it without stopping the poll is the honest reading, so the next
      // tick can clear it.
      setError(err);
    }
  }, [blogId, onGenerated]);

  useInterval(poll, inFlight ? POLL_MS : null);
  useInterval(
    () => setElapsed(startedAt === null ? 0 : Date.now() - startedAt),
    inFlight ? 1000 : null
  );

  async function handleSubmit() {
    if (submitting || inFlight) return;

    setSubmitting(true);
    setError(null);
    setGenerationError(null);
    try {
      // Flush any debounced edits first: the server generates from the row, so a
      // pending autosave would mean generating from one keystroke ago.
      await onBeforeSubmit?.();

      const result = await generateApi.article({
        blog_id: Number(blogId),
        config: buildGenerationConfig(config),
      });

      setStartedAt(Date.now());
      setElapsed(0);
      setStatus(result?.generation_status || GENERATION_STATUS.QUEUED);
    } catch (err) {
      if (err?.code === 'GENERATION_IN_PROGRESS') {
        // Not really an error: a run is already going, most likely started in
        // another tab. Attach to it rather than telling the author to try again.
        setStartedAt(Date.now());
        setElapsed(0);
        setStatus(GENERATION_STATUS.GENERATING);
        setError(err);
      } else {
        setError(err);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const stageIndex = STAGES.findIndex((stage) => stage.status === status);
  const publishMode = PUBLISH_MODES.find((entry) => entry.value === publishModeOf(config));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Ready to generate"
          subtitle="Check the summary, then start the run. Nothing is published."
        />
        <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-2">
          <Summary label="Title" value={config.blog_title} />
          <Summary label="Primary keyword" value={config.seo_keywords || config.topic} />
          <Summary
            label="Optimisation profile"
            value={OPTIMIZATION_PROFILE_META[config.optimization_profile || 'balanced']?.label}
          />
          <Summary label="Article type" value={ARTICLE_TYPE_LABELS[config.article_type]} />
          <Summary label="Readability" value={READABILITY_LABELS[config.readability_level]} />
          <Summary
            label="Brand voice"
            value={
              !config.brand_voice_source_type || config.brand_voice_source_type === 'none'
                ? 'None'
                : `${config.brand_voice_tone || 'Analysed'} — confirmed`
            }
          />
          <Summary
            label="Outline"
            value={
              (config.outline || []).length > 0
                ? `${config.outline.length} sections`
                : 'The generator decides'
            }
          />
          <Summary
            label="Images"
            value={
              config.include_images === false
                ? 'None'
                : `${config.image_count} × ${IMAGE_STYLE_LABELS[config.image_style] || config.image_style}` +
                  (config.logo_overlay
                    ? `, logo ${(LOGO_POSITION_LABELS[config.logo_position] || '').toLowerCase()}`
                    : '')
            }
          />
          <Summary
            label="Internal links"
            value={
              config.internal_linking
                ? `${(config.internal_link_targets || []).length} articles`
                : 'Off'
            }
          />
          <Summary label="Web grounding" value={config.external_web_grounding ? 'On' : 'Off'} />
          <Summary label="After review" value={publishMode?.label} />
        </dl>
      </Card>

      <ErrorBanner
        error={error && error.code !== 'GENERATION_IN_PROGRESS' ? error : null}
        onRetry={failed || !inFlight ? handleSubmit : undefined}
        onDismiss={() => setError(null)}
      />

      {error?.code === 'BRAND_VOICE_NOT_CONFIRMED' ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-ink">
            The brand voice on this draft is not confirmed, so the run was refused.
          </p>
          <Button variant="secondary" size="sm" onClick={() => onGoToStep(2)}>
            Back to brand voice
          </Button>
        </div>
      ) : null}

      {error?.code === 'GENERATION_IN_PROGRESS' ? (
        <InfoBanner tone="warning">
          A run was already under way for this article — probably from another tab. Watching that one
          instead of starting a second.
        </InfoBanner>
      ) : null}

      <Card glow={inFlight}>
        <CardHeader
          title="Generation"
          action={<GenerationBadge status={status} />}
        />
        <div className="space-y-4 p-5">
          {status === GENERATION_STATUS.DRAFT ? (
            <>
              <p className="text-sm text-ink-secondary">
                The run writes the article, generates the images, scores the result and stops. You
                review it in the editor and publish from there.
              </p>
              <Button variant="primary" size="lg" onClick={handleSubmit} loading={submitting}>
                {submitting ? 'Starting' : 'Generate article'}
              </Button>
            </>
          ) : null}

          {inFlight ? (
            <>
              <div className="flex items-center gap-3">
                <Spinner size={18} className="text-brand" label="Generating" />
                <p className="text-sm text-ink">
                  {STAGES[stageIndex]?.label || 'Working'}
                  <span className="ml-2 tabular text-ink-muted">{formatElapsed(elapsed)}</span>
                </p>
              </div>

              <ol
                className="flex gap-1"
                role="progressbar"
                aria-valuenow={stageIndex + 1}
                aria-valuemin={1}
                aria-valuemax={STAGES.length}
                aria-label={`Generation stage ${stageIndex + 1} of ${STAGES.length}: ${
                  STAGES[stageIndex]?.label || 'working'
                }`}
              >
                {STAGES.map((stage, index) => (
                  <li
                    key={stage.status}
                    className={
                      index <= stageIndex
                        ? 'h-1.5 flex-1 rounded-full bg-brand'
                        : 'h-1.5 flex-1 rounded-full bg-panel-sunken'
                    }
                  >
                    <span className="sr-only">{stage.label}</span>
                  </li>
                ))}
              </ol>

              <p className="text-xs text-ink-muted">
                A full article usually takes 40–90 seconds
                {config.external_web_grounding ? ', longer with web grounding' : ''}. You can leave
                this page — the run continues, and the blog list shows its state.
              </p>
            </>
          ) : null}

          {done ? (
            <div className="space-y-3">
              <p className="text-sm text-ink">
                Generated in {formatElapsed(elapsed)}. Opening the editor for review…
              </p>
              {lastResult ? (
                <TriScoreBadge
                  seo={{ score: lastResult.seo_score }}
                  aeo={{ score: lastResult.aeo_score }}
                  geo={{ score: lastResult.geo_score }}
                  variant="compact"
                />
              ) : null}
            </div>
          ) : null}

          {failed ? (
            <>
              <ErrorBanner
                error={{
                  message: generationError || 'The generation run failed without giving a reason.',
                  code: 'GENERATION_FAILED',
                }}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={handleSubmit} loading={submitting}>
                  {submitting ? 'Retrying' : 'Retry generation'}
                </Button>
                <p className="text-xs text-ink-muted">
                  Nothing was written to the article, so a retry starts clean.
                </p>
              </div>
            </>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

/** One row of the pre-flight summary. */
function Summary({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-ink">{value || '—'}</dd>
    </div>
  );
}
