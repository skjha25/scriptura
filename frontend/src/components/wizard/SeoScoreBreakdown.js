// frontend/src/components/wizard/SeoScoreBreakdown.js
/**
 * The transparent half of the SEO score.
 *
 * The spec insists the scoring be explainable, and a bare "72/100" is the exact
 * opposite: it tells an author their title is wrong without telling them what to
 * change. The API returns a per-criterion `{criterion, points, max, met, detail}`
 * for precisely this, so this component renders every row verbatim rather than
 * summarising it — the detail strings are the actionable part.
 *
 * Pass/partial/fail is carried by a glyph and by the points, never by colour
 * alone.
 */

import clsx from 'clsx';

import { ScoreMeter } from '../ui/feedback';
import { humanizeEnum } from '../../lib/constants';

/**
 * Labels for the title criteria. Falls back to a humanised key, so an article
 * breakdown (or a criterion added on the server) still renders sensibly instead
 * of showing a screaming constant.
 */
const CRITERION_LABELS = Object.freeze({
  KEYWORD_PRESENCE: 'Keyword in the title',
  KEYWORD_POSITION: 'Keyword position',
  LENGTH: 'Title length',
  POWER_WORD: 'Motivating word',
  NUMBER_OR_YEAR: 'Number or year',
  READABILITY: 'Readability',
});

function labelFor(criterion) {
  return CRITERION_LABELS[criterion] || humanizeEnum(String(criterion).toLowerCase());
}

export default function SeoScoreBreakdown({ seo, className = '', showMeter = true }) {
  if (!seo || !Array.isArray(seo.breakdown)) return null;

  return (
    <div className={clsx('min-w-0', className)}>
      {showMeter ? <ScoreMeter score={seo.score} className="mb-3" /> : null}
      <ul className="space-y-2">
        {seo.breakdown.map((item) => {
          const partial = !item.met && item.points > 0;
          return (
            <li key={item.criterion} className="flex min-w-0 items-start gap-2.5">
              <span
                aria-hidden="true"
                className={clsx(
                  'mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                  item.met
                    ? 'bg-status-good/20 text-status-good'
                    : partial
                      ? 'bg-status-warning/20 text-status-warning'
                      : 'bg-status-critical/20 text-status-critical'
                )}
              >
                {item.met ? '✓' : partial ? '~' : '×'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-xs font-medium text-ink-secondary">
                    {labelFor(item.criterion)}
                  </span>
                  <span className="shrink-0 text-[11px] tabular text-ink-muted">
                    {item.points}/{item.max}
                    <span className="sr-only">
                      {' '}
                      points — {item.met ? 'met' : partial ? 'partly met' : 'not met'}
                    </span>
                  </span>
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-muted">
                  {item.detail}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
