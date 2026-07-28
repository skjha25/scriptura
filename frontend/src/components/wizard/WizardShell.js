// frontend/src/components/wizard/WizardShell.js
/**
 * The wizard's frame: heading, step indicator, animated step body, footer nav.
 *
 * Split out of WizardPage so that page can be about state and routing and this
 * can be about layout. Two things here are load-bearing rather than cosmetic:
 *
 *   - The step body is a KEYED motion element with an entrance transition.
 *   - Next stays ENABLED when the step is incomplete, and refuses on click.
 */

import { motion } from 'framer-motion';
import clsx from 'clsx';

import Button from '../ui/Button';
import StepIndicator from './StepIndicator';
import { FIRST_STEP, LAST_STEP, WIZARD_STEPS } from './steps';

/** Reduced motion is handled globally by MotionConfig in src/index.js. */
const STEP_TRANSITION = { duration: 0.22, ease: [0.22, 1, 0.36, 1] };

export default function WizardShell({
  step,
  furthest,
  completed,
  onStepChange,
  missing,
  showMissing,
  onNext,
  onBack,
  saving,
  savedAt,
  children,
}) {
  const meta = WIZARD_STEPS.find((entry) => entry.id === step) || WIZARD_STEPS[0];
  const isLast = step === LAST_STEP;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="rounded-2xl border border-hairline bg-panel p-5 shadow-panel sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-0.5 text-[11px] font-medium text-accent">
              <span aria-hidden="true">✦</span>
              <span>Agentic AI Article Generator</span>
            </div>
            <h1 className="text-lg font-bold tracking-tight text-ink sm:text-xl">New article</h1>
          </div>
          {/* Autosave state */}
          <div className="flex items-center gap-2 rounded-lg border border-hairline bg-panel-sunken px-3 py-1.5 text-xs text-ink-muted" aria-live="polite">
            <span className={clsx('h-2 w-2 rounded-full', saving ? 'bg-status-warning animate-pulse' : 'bg-status-good')} />
            <span>
              {saving
                ? 'Saving draft…'
                : savedAt
                  ? `Saved at ${savedAt.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : 'Draft not saved'}
            </span>
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-muted sm:text-sm">
          Every step saves automatically to your draft, so you can safely leave and return anytime.
        </p>
      </header>

      <div className="rounded-2xl border border-hairline bg-panel p-4 shadow-panel sm:p-6">
        <StepIndicator
          current={step}
          furthest={furthest}
          completed={completed}
          onSelect={onStepChange}
        />

        <motion.section
          key={step}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={STEP_TRANSITION}
          aria-labelledby="wizard-step-heading"
          className="mt-6"
        >
          <h2 id="wizard-step-heading" className="sr-only">
            {`Step ${step} of ${LAST_STEP}: ${meta.label}`}
          </h2>
          {children}
        </motion.section>

        <footer className="mt-8 border-t border-hairline pt-5">
          {showMissing && missing.length > 0 ? (
            <div
              role="alert"
              id="wizard-missing"
              className="mb-4 rounded-xl border border-status-warning/40 bg-status-warning/10 px-4 py-3"
            >
              <p className="text-sm font-medium text-ink">
                {missing.length === 1
                  ? 'One thing is still needed on this step:'
                  : `${missing.length} things are still needed on this step:`}
              </p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-ink-secondary">
                {missing.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={onBack} disabled={step === FIRST_STEP}>
              Back
            </Button>
            {isLast ? (
              <p className="text-xs text-ink-muted">Last step — start the run below.</p>
            ) : (
              <Button
                variant="primary"
                onClick={onNext}
                aria-describedby={showMissing && missing.length > 0 ? 'wizard-missing' : undefined}
              >
                Next
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
