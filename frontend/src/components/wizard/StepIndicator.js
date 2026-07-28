// frontend/src/components/wizard/StepIndicator.js
/**
 * The wizard's step indicator.
 *
 * Two presentations of one nav landmark, because six horizontal labels cannot be
 * read at 375px and shrinking them to fit produces six unreadable stubs. The
 * spec asks for a compact stepper on mobile, so below `md` this collapses to
 * "Step 3 of 6", the step's name, and a progress bar; from `md` up it is the full
 * list. Both are the same `<nav>`, and only one is ever visible.
 *
 * The list is real navigation, not decoration: a completed step is a button that
 * goes back to it. Steps ahead of the furthest reachable one are disabled rather
 * than hidden, so the author can see the shape of what is left.
 */

import clsx from 'clsx';

import { WIZARD_STEPS } from './steps';

export default function StepIndicator({ current, furthest, onSelect, completed }) {
  const total = WIZARD_STEPS.length;
  const active = WIZARD_STEPS.find((step) => step.id === current) || WIZARD_STEPS[0];
  const percent = Math.round(((current - 1) / (total - 1)) * 100);

  return (
    <nav aria-label="Wizard steps" className="mb-6">
      {/* Compact stepper — mobile. */}
      <div className="md:hidden">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-ink">
            <span className="text-ink-muted">Step {current} of {total}</span>
            <span className="mx-2 text-ink-faint" aria-hidden="true">
              ·
            </span>
            {active.label}
          </p>
          <span className="shrink-0 text-xs tabular text-ink-muted">{percent}%</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-panel-sunken"
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-label={`Wizard progress: step ${current} of ${total}, ${active.label}`}
        >
          <div
            className="h-full rounded-full bg-glow-accent transition-all duration-300"
            // Computed width — the one thing a utility class cannot express.
            style={{ width: `${Math.max(percent, 4)}%` }}
          />
        </div>
      </div>

      {/* Full list — tablet and up. */}
      <ol className="hidden items-stretch gap-1 md:flex">
        {WIZARD_STEPS.map((step, index) => {
          const isActive = step.id === current;
          const isDone = Boolean(completed?.[step.id]) && !isActive;
          const reachable = step.id <= furthest;

          return (
            <li key={step.key} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onSelect(step.id)}
                disabled={!reachable}
                aria-current={isActive ? 'step' : undefined}
                className={clsx(
                  'group flex w-full min-w-0 flex-col gap-2 rounded-lg px-2 py-2 text-left transition-colors',
                  reachable ? 'hover:bg-panel-raised' : 'cursor-not-allowed',
                  isActive && 'bg-glow-subtle'
                )}
              >
                <span
                  aria-hidden="true"
                  className={clsx(
                    'h-1 w-full rounded-full transition-colors',
                    isActive
                      ? 'bg-glow-accent'
                      : isDone
                        ? 'bg-accent/45'
                        : 'bg-panel-sunken'
                  )}
                />
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={clsx(
                      'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                      isActive
                        ? 'bg-accent text-white'
                        : isDone
                          ? 'bg-accent/20 text-accent-bright'
                          : 'bg-panel-sunken text-ink-faint'
                    )}
                  >
                    {/* A tick, not a colour, is what says "done" to everyone. */}
                    {isDone ? '✓' : index + 1}
                  </span>
                  <span
                    className={clsx(
                      'truncate text-xs',
                      isActive ? 'font-medium text-ink' : reachable ? 'text-ink-secondary' : 'text-ink-faint'
                    )}
                  >
                    {step.label}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
