// frontend/src/components/shared/TriScoreBadge.js
/**
 * The three-score dashboard: SEO / AEO / GEO side by side.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE COMPONENT FOR THREE SCORES
 * ---------------------------------------------------------------------------
 * Section 17.4 of the roadmap calls for the wizard and the editor to show all
 * three scores wherever the old single `ScoreMeter` appeared. Rather than
 * hand-place three `ScoreMeter`s plus three `<details>` breakdowns at every call
 * site (Step 1, Step 6, EditorPage header), this component owns the layout once
 * so every surface renders identically and a future fourth score is a one-file
 * change.
 *
 * ---------------------------------------------------------------------------
 * NULL SCORES ARE A REAL STATE, NOT A LOADING STATE
 * ---------------------------------------------------------------------------
 * `aeo_score`/`geo_score` are `null` until there is enough content to measure —
 * an empty draft, or (in the wizard) a title-only step where no article body
 * exists yet. That is shown as "Not yet available" rather than a skeleton or a
 * 0, for the same reason ScoreMeter already treats null specially: 0 would be a
 * quiet lie about content that has not been written, and a skeleton implies a
 * network request is in flight when none is.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT
 * ---------------------------------------------------------------------------
 * `variant="compact"` (default) — three narrow meters in a row, each behind its
 * own `<details>` for the breakdown. Used in the editor header and Step 6's
 * summary, where space is tight.
 *
 * `variant="full"` — three full-width cards stacked, breakdown always visible.
 * Used in Step 1, where the score IS the content of the panel.
 */

import clsx from 'clsx';

import { ScoreMeter } from '../ui/feedback';
import ScoreBreakdown from './ScoreBreakdown';
import { AEO_CRITERION_LABELS, GEO_CRITERION_LABELS } from '../../lib/constants';

/** Label shown for SEO's breakdown criteria — same map SeoScoreBreakdown.js uses. */
const SEO_CRITERION_LABELS = Object.freeze({
  KEYWORD_PRESENCE: 'Keyword in the title',
  KEYWORD_POSITION: 'Keyword position',
  LENGTH: 'Title length',
  POWER_WORD: 'Motivating word',
  NUMBER_OR_YEAR: 'Number or year',
  READABILITY: 'Readability',
  WORD_COUNT: 'Word count',
  KEYWORD_DENSITY: 'Keyword density',
  HEADING_STRUCTURE: 'Heading structure',
  SECONDARY_KEYWORDS: 'Secondary keywords',
  LINKS: 'Links',
  IMAGE_ALT: 'Image alt text',
  META_DESCRIPTION: 'Meta description',
  FAQ: 'FAQ section',
});

const LANES = Object.freeze([
  { key: 'seo', label: 'SEO', hint: 'Search ranking', labels: SEO_CRITERION_LABELS },
  { key: 'aeo', label: 'AEO', hint: 'AI Overviews & snippets', labels: AEO_CRITERION_LABELS },
  { key: 'geo', label: 'GEO', hint: 'ChatGPT / Perplexity citations', labels: GEO_CRITERION_LABELS },
]);

/**
 * @param {object} props
 * @param {{score: number|null, breakdown?: Array}} [props.seo]
 * @param {{score: number|null, breakdown?: Array}} [props.aeo]
 * @param {{score: number|null, breakdown?: Array}} [props.geo]
 * @param {'compact'|'full'} [props.variant]
 * @param {string} [props.className]
 */
export default function TriScoreBadge({ seo, aeo, geo, variant = 'compact', className = '' }) {
  const results = { seo, aeo, geo };

  if (variant === 'full') {
    return (
      <div className={clsx('grid gap-4 sm:grid-cols-3', className)}>
        {LANES.map((lane) => (
          <FullLane key={lane.key} lane={lane} result={results[lane.key]} />
        ))}
      </div>
    );
  }

  return (
    <div className={clsx('flex min-w-0 flex-wrap items-start gap-3', className)}>
      {LANES.map((lane) => (
        <CompactLane key={lane.key} lane={lane} result={results[lane.key]} />
      ))}
    </div>
  );
}

function ScoreOrNA({ score }) {
  if (score === null || score === undefined) {
    return <span className="text-xs text-ink-faint">Not yet available</span>;
  }
  return <ScoreMeter score={score} size="sm" />;
}

function CompactLane({ lane, result }) {
  const hasBreakdown = Array.isArray(result?.breakdown) && result.breakdown.length > 0;

  return (
    <div className="relative w-28 min-w-0 shrink-0">
      <p className="mb-1 flex items-baseline gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
          {lane.label}
        </span>
      </p>
      <ScoreOrNA score={result?.score} />
      {hasBreakdown ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[10px] text-accent-bright">Why?</summary>
          <div className="absolute left-0 top-full z-20 mt-2 w-64 rounded-lg border border-hairline bg-panel p-3 shadow-panel">
            <ScoreBreakdown result={result} labels={lane.labels} showMeter={false} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function FullLane({ lane, result }) {
  const hasBreakdown = Array.isArray(result?.breakdown) && result.breakdown.length > 0;

  return (
    <div className="min-w-0 rounded-lg border border-hairline bg-panel-sunken p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
          {lane.label}
        </span>
        <span className="text-[11px] text-ink-muted">{lane.hint}</span>
      </div>
      <ScoreOrNA score={result?.score} />
      {hasBreakdown ? (
        <ScoreBreakdown result={result} labels={lane.labels} showMeter={false} className="mt-3" />
      ) : result?.score === null || result?.score === undefined ? (
        <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">
          {lane.key === 'seo'
            ? 'Scored from the title alone until the article has content.'
            : 'Needs article content to measure — appears once the article is generated or written.'}
        </p>
      ) : null}
    </div>
  );
}
