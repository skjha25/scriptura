// frontend/src/components/shared/ScoreBreakdown.js
/**
 * Generic per-criterion score breakdown — the AEO/GEO sibling of
 * wizard/SeoScoreBreakdown.js.
 *
 * SEO's breakdown component was written first and is title/article specific
 * (it special-cases wizard styling and lives under components/wizard/). AEO and
 * GEO scores share the exact same wire shape — an array of
 * `{criterion, points, max, met, detail}` rows — so rather than fork
 * SeoScoreBreakdown.js twice with two new hard-coded label maps, this is the one
 * generic renderer both take a `labels` map as a prop. SeoScoreBreakdown itself
 * is left alone: it is heavily used already and a mechanical refactor onto this
 * component is a separate, lower-value change.
 *
 * Same accessibility rules as the component it mirrors: pass/partial/fail is
 * carried by a glyph AND the point count, never by colour alone.
 */

import clsx from 'clsx';

import { ScoreMeter } from '../ui/feedback';
import { humanizeEnum } from '../../lib/constants';

export default function ScoreBreakdown({ result, labels = {}, className = '', showMeter = true }) {
  if (!result || !Array.isArray(result.breakdown) || result.breakdown.length === 0) return null;

  return (
    <div className={clsx('min-w-0', className)}>
      {showMeter ? <ScoreMeter score={result.score} className="mb-3" /> : null}
      <ul className="space-y-2">
        {result.breakdown.map((item) => {
          const partial = !item.met && item.points > 0;
          const label = labels[item.criterion] || humanizeEnum(String(item.criterion).toLowerCase());
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
                  <span className="text-xs font-medium text-ink-secondary">{label}</span>
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
