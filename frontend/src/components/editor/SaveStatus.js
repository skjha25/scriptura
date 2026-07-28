// frontend/src/components/editor/SaveStatus.js
/**
 * The save indicator.
 *
 * ---------------------------------------------------------------------------
 * WHY IT SAYS THE TIME
 * ---------------------------------------------------------------------------
 * "Saved" with no timestamp is unfalsifiable — an author cannot tell whether it refers
 * to the sentence they just typed or to something five minutes ago. Naming the minute
 * makes the claim checkable, which is the whole point of showing a save state at all.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A LIVE REGION, POLITELY
 * ---------------------------------------------------------------------------
 * `role="status"` announces the change without stealing focus, and `polite` means it
 * waits for a gap in the user's typing. An assertive region here would interrupt
 * dictation and read "Saving" over the author's own words every couple of seconds.
 *
 * Every state carries a word, never a colour alone: the dot is reinforcement.
 */

import clsx from 'clsx';

import Spinner from '../ui/Spinner';
import { SAVE_STATUS } from '../../hooks/useAutosave';

/** Locale-aware hour and minute. Seconds would imply a precision nobody needs. */
function formatTime(date) {
  if (!date) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function SaveStatus({ status, savedAt, className = '' }) {
  const view = {
    [SAVE_STATUS.IDLE]: { text: 'No changes', dot: 'bg-ink-faint', tone: 'text-ink-muted' },
    [SAVE_STATUS.UNSAVED]: {
      text: 'Unsaved changes',
      dot: 'bg-status-warning',
      tone: 'text-status-warning',
    },
    [SAVE_STATUS.SAVING]: { text: 'Saving…', dot: null, tone: 'text-ink-secondary' },
    [SAVE_STATUS.SAVED]: {
      text: savedAt ? `Saved at ${formatTime(savedAt)}` : 'Saved',
      dot: 'bg-status-good',
      tone: 'text-status-good',
    },
    [SAVE_STATUS.FAILED]: {
      text: 'Save failed',
      dot: 'bg-status-critical',
      tone: 'text-status-critical',
    },
  }[status] || { text: '', dot: null, tone: 'text-ink-muted' };

  return (
    <p
      role="status"
      aria-live="polite"
      className={clsx('flex items-center gap-1.5 text-xs', view.tone, className)}
    >
      {view.dot ? (
        <span aria-hidden="true" className={clsx('h-1.5 w-1.5 rounded-full', view.dot)} />
      ) : (
        <Spinner size={12} label="Saving" />
      )}
      {view.text}
    </p>
  );
}
