// frontend/src/components/wizard/WizardShell.js
/**
 * The wizard's frame: heading, step indicator, animated step body, footer nav.
 *
 * Split out of WizardPage so that page can be about state and routing and this
 * can be about layout. Two things here are load-bearing rather than cosmetic:
 *
 *   - The step body is a KEYED motion element with an entrance transition, and
 *     deliberately not an `<AnimatePresence mode="wait">` cross-fade. Two reasons.
 *     Without `mode="wait"` both steps are mounted at once, which for two full
 *     forms means duplicated labels and duplicated ids for the length of the
 *     transition. With it, a Back/Next pressed while the previous exit is still
 *     running can leave the presence machine holding an outgoing child that never
 *     leaves, and the wizard shows no step at all — a stuck form is a far worse
 *     outcome than a missing 200ms fade. An enter-only transition cannot wedge:
 *     the key changes, React swaps the subtree, the new step animates in.
 *
 *   - Next stays ENABLED when the step is incomplete, and refuses on click.
 *     A disabled button is unfocusable and so cannot explain itself; this way the
 *     author is told what is missing, in an alert, at the moment they ask to move
 *     on. `aria-describedby` ties the button to that list.
 */

import { motion } from 'framer-motion';

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
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">New article</h1>
          {/* Autosave state, announced politely — it must never steal focus or
              interrupt what the author is typing. */}
          <p className="text-xs text-ink-muted" aria-live="polite">
            {saving
              ? 'Saving…'
              : savedAt
                ? `Draft saved at ${savedAt.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : 'Not saved yet'}
          </p>
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Every step saves to the draft as you go, so you can leave and come back.
        </p>
      </header>

      <StepIndicator
        current={step}
        furthest={furthest}
        completed={completed}
        onSelect={onStepChange}
      />

      <motion.section
        key={step}
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={STEP_TRANSITION}
        aria-labelledby="wizard-step-heading"
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
            className="mb-4 rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3"
          >
            <p className="text-sm text-ink">
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
            // Step 6 owns its own submit control; a second "Next" here would
            // imply there is somewhere left to go.
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
  );
}
