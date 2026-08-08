// frontend/src/components/wizard/OptimizationProfilePicker.js
/**
 * Optimisation profile preset picker — Section 17.4/17.6 of the roadmap.
 *
 * Rather than exposing four separate AEO/GEO toggles ("Optimise for featured
 * snippets", "Include PAA questions", "Add citations", "E-E-A-T optimisation")
 * as the original roadmap sketch suggested, this is a single choice among named
 * presets. Most authors do not have a mental model of what "E-E-A-T" means; a
 * preset labelled "AI-First (Featured snippets)" with a one-line description of
 * what it actually changes is something they can act on without a glossary.
 *
 * Built from real radio inputs in a fieldset (see LogoPositionGrid.js for the
 * same reasoning) so focus, Space-to-select, arrow-key movement between options
 * and correct "N of 4, selected" announcement come from the browser rather than
 * being reimplemented on clickable divs.
 */

import clsx from 'clsx';

import { OPTIMIZATION_PROFILE_META, OPTIMIZATION_PROFILE_ORDER } from '../../lib/constants';

export default function OptimizationProfilePicker({ value, onChange, disabled = false }) {
  const current = value || 'balanced';

  return (
    <fieldset disabled={disabled} className={clsx(disabled && 'opacity-50')}>
      <legend className="mb-2 text-xs font-medium text-ink-secondary">Optimisation profile</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {OPTIMIZATION_PROFILE_ORDER.map((profile) => {
          const meta = OPTIMIZATION_PROFILE_META[profile];
          const selected = current === profile;
          return (
            <label
              key={profile}
              className={clsx(
                'min-w-0 cursor-pointer rounded-lg border p-3 transition-colors',
                selected
                  ? 'border-brand/60 bg-brand/10'
                  : 'border-hairline bg-panel-sunken hover:border-hairline-strong'
              )}
            >
              <span className="flex items-start gap-2.5">
                <input
                  type="radio"
                  name="optimization-profile"
                  value={profile}
                  checked={selected}
                  onChange={() => onChange(profile)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-accent"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{meta.label}</span>
                  <span className="mt-0.5 block text-[11px] font-medium text-brand-light">
                    {meta.focus}
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-ink-muted">
                    {meta.description}
                  </span>
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
