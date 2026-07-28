// frontend/src/components/wizard/StepIndicator.js
/**
 * The wizard's step indicator.
 *
 * Two presentations of one nav landmark, because six horizontal labels cannot be
 * read at 375px and shrinking them to fit produces six unreadable stubs. The
 * spec asks for a compact stepper on mobile, so below `md` this collapses to
 * "Step 3 of 6" and the step's name; from `md` up it is the full list.
 * Both are the same `<nav>`, and only one is ever visible.
 */

import clsx from 'clsx';

import { WIZARD_STEPS } from './steps';

export default function StepIndicator({ current, furthest, onSelect, completed }) {
  const total = WIZARD_STEPS.length;
  const active = WIZARD_STEPS.find((step) => step.id === current) || WIZARD_STEPS[0];

  return (
    <nav aria-label="Wizard steps" className="mb-6">
      {/* Compact stepper — mobile. */}
      <div className="md:hidden">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-ink">
            <span className="text-ink-muted">Step {current} of {total}</span>
            <span className="mx-2 text-ink-faint" aria-hidden="true">
              ·
            </span>
            {active.label}
          </p>
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
                  'group flex w-full min-w-0 flex-col gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                  reachable ? 'hover:bg-panel-raised' : 'cursor-not-allowed',
                  isActive && 'bg-glow-subtle'
                )}
              >
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
