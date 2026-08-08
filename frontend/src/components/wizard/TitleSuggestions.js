// frontend/src/components/wizard/TitleSuggestions.js
/**
 * The generated-title picker.
 *
 * Radios rather than clickable cards: choosing one of five titles IS a radio
 * group, and the native control brings arrow-key navigation and correct
 * announcement ("2 of 5, selected") that a div would have to fake badly.
 *
 * Each suggestion's breakdown sits inside a native `<details>`. Five expanded
 * breakdowns at once is a wall of text, but hiding the reasoning behind a
 * JS-driven popover would put it out of reach of keyboard users — a disclosure is
 * the version that is both scannable and always available.
 */

import { Badge, ScoreMeter } from '../ui/feedback';
import SeoScoreBreakdown from './SeoScoreBreakdown';

export default function TitleSuggestions({ suggestions, selected, onSelect }) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-xs font-medium text-ink-secondary">
        {suggestions.length} suggestions, best-scoring first
      </legend>
      <ul className="space-y-2">
        {suggestions.map((suggestion, index) => {
          const isSelected = suggestion.title === selected;
          return (
            <li
              key={suggestion.title}
              className="rounded-lg border border-hairline bg-panel-sunken p-3 transition-colors focus-within:border-brand"
            >
              <label className="flex min-w-0 cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name="title-suggestion"
                  value={suggestion.title}
                  checked={isSelected}
                  onChange={() => onSelect(suggestion)}
                  className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-accent"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-snug text-ink">{suggestion.title}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2">
                    {suggestion.angle ? <Badge>{suggestion.angle}</Badge> : null}
                    <span className="text-[11px] tabular text-ink-muted">
                      {suggestion.char_count ?? suggestion.title.length} characters
                    </span>
                  </span>
                </span>
                <span className="hidden w-24 shrink-0 xs:block">
                  <ScoreMeter score={suggestion.seo?.score} size="sm" />
                </span>
              </label>

              {/* The score is useless without the reasoning, so the reasoning is
                  one keystroke away from every row rather than only the chosen one. */}
              <details className="mt-2 pl-7">
                <summary className="cursor-pointer text-[11px] text-brand-light">
                  Why {suggestion.seo?.score ?? 0}/100
                </summary>
                <SeoScoreBreakdown seo={suggestion.seo} showMeter={false} className="mt-2" />
              </details>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
