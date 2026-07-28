/**
 * Debounced autosave with an honest save state.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT JUST A DEBOUNCED CALLBACK
 * ---------------------------------------------------------------------------
 * `useDebouncedCallback` (which this is built on) solves the timing. What it does
 * not solve is the bookkeeping that makes a save indicator truthful, and a dishonest
 * indicator is worse than none — an author who sees "Saved" and closes the tab has
 * lost work.
 *
 * ---------------------------------------------------------------------------
 * DIRTINESS IS DERIVED, NOT TRACKED
 * ---------------------------------------------------------------------------
 * The hook takes the current `value` and remembers the value it last persisted.
 * "Unsaved" is then `value !== savedValue` — computed during render, not stored in
 * state and not set from an effect.
 *
 * That choice matters for three reasons:
 *
 *   1. It cannot drift. A separate `isDirty` flag has to be set on every mutation
 *      path — typing, undo, redo, reorder, insert, delete — and the first path
 *      someone forgets is a silent data-loss bug.
 *
 *   2. It is correct for the edits-during-a-request case for free. A save started at
 *      value A that lands after the author has reached value B marks A as saved; B is
 *      still not equal to it, so the state stays "unsaved" and another pass is
 *      scheduled. This is exactly where a naive implementation displays "Saved" and
 *      lies.
 *
 *   3. The indicator updates in the same render as the edit. Setting a flag from an
 *      effect means the UI is one commit behind the keystroke, which is both a
 *      needless extra render and the source of the classic "not wrapped in act"
 *      noise in tests.
 *
 * Only one save is ever in flight. Two PATCHes racing on the same row is how earlier
 * keystrokes end up overwriting later ones.
 *
 * ---------------------------------------------------------------------------
 * LEAVING THE PAGE
 * ---------------------------------------------------------------------------
 * `flush()` covers deliberate exits (Save, Publish, following a link), `beforeunload`
 * warns about accidental ones, and the unmount cleanup covers an in-app route change.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebouncedCallback } from './useDebouncedValue';

export const SAVE_STATUS = Object.freeze({
  /** Nothing has changed since load. */
  IDLE: 'idle',
  /** Local edits not yet persisted. */
  UNSAVED: 'unsaved',
  /** A request is in flight. */
  SAVING: 'saving',
  /** Everything local is persisted. */
  SAVED: 'saved',
  /** The last attempt failed. The edits are still held locally. */
  FAILED: 'failed',
});

/**
 * @param {object} options
 * @param {*} options.value The current state to persist. Compared by identity, so it
 *   must be replaced rather than mutated — which is already true of the blocks array.
 * @param {(value: *) => Promise<any>} options.save Performs the write.
 * @param {number} [options.delay] Quiet period before an automatic save, in ms.
 * @param {boolean} [options.enabled] When false, changes are still tracked but never
 *   sent automatically. Used while a generation run holds the row.
 * @param {boolean} [options.warnBeforeUnload]
 * @param {boolean} [options.saveOnUnmount]
 */
export default function useAutosave({
  value,
  save,
  delay = 1500,
  enabled = true,
  warnBeforeUnload = true,
  saveOnUnmount = true,
}) {
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);

  /** The value most recently written to the server. */
  const savedValueRef = useRef(value);
  /** The newest value, read at request time so a save always sends current state. */
  const valueRef = useRef(value);

  const saveRef = useRef(save);
  const enabledRef = useRef(enabled);
  const saveOnUnmountRef = useRef(saveOnUnmount);
  const inFlightRef = useRef(false);
  const rerunRef = useRef(false);
  const scheduleRef = useRef(null);

  // Declared before the scheduling effect below so it is committed first — the timer
  // that effect starts must never fire against a stale value.
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    saveOnUnmountRef.current = saveOnUnmount;
  }, [saveOnUnmount]);

  const dirty = value !== savedValueRef.current;

  /**
   * Performs one save pass.
   * @returns {Promise<boolean|undefined>} true saved, false failed, undefined no-op.
   */
  const run = useCallback(async ({ force = false } = {}) => {
    if (inFlightRef.current) {
      // Do not race the request already on the wire; pick this up when it lands.
      rerunRef.current = true;
      return undefined;
    }

    const attempted = valueRef.current;
    if (!force && attempted === savedValueRef.current) return undefined;

    inFlightRef.current = true;
    setError(null);
    setSaving(true);

    try {
      await saveRef.current(attempted);
      // Marks *this* value as persisted. If the author has moved on since, `dirty`
      // stays true on the next render and another pass is scheduled.
      savedValueRef.current = attempted;
      setSavedAt(new Date());
      return true;
    } catch (err) {
      // The value is deliberately untouched: the edits are still the user's, and a
      // failed save must never discard them.
      setError(err);
      return false;
    } finally {
      inFlightRef.current = false;
      setSaving(false);
      if (rerunRef.current) {
        rerunRef.current = false;
        if (enabledRef.current) scheduleRef.current?.();
      }
    }
  }, []);

  const { debounced, cancel } = useDebouncedCallback(run, delay);

  useEffect(() => {
    scheduleRef.current = debounced;
  }, [debounced]);

  // The autosave trigger. It only starts a timer — it sets no state — so an edit costs
  // exactly one render.
  useEffect(() => {
    if (!dirty || !enabled) return;
    debounced();
  }, [dirty, value, enabled, debounced]);

  /**
   * Declares `nextValue` as the persisted state without issuing a request.
   *
   * Called after a load or a reload: the server just told us what it holds, so that is
   * by definition saved, and any pending write against the superseded value is
   * cancelled rather than allowed to overwrite it.
   */
  const sync = useCallback(
    (nextValue) => {
      cancel();
      savedValueRef.current = nextValue;
      valueRef.current = nextValue;
      setError(null);
      setSavedAt(null);
    },
    [cancel]
  );

  /**
   * Saves immediately, bypassing the debounce. Backs the explicit Save button, so it
   * forces a write even when nothing looks dirty — a user who presses Save expects a
   * save to have happened.
   */
  const saveNow = useCallback(() => {
    cancel();
    return run({ force: true });
  }, [cancel, run]);

  /**
   * Persists anything pending, then resolves. Called before publishing and before
   * following a link, so the last keystrokes are on the server first.
   * @returns {Promise<boolean|undefined>} false only when the save failed.
   */
  const flush = useCallback(() => {
    cancel();
    return run();
  }, [cancel, run]);

  /**
   * The single displayed state, in precedence order.
   *
   * `error` outranks `dirty` because a failed save is the more urgent fact, and it
   * outranks nothing else — a subsequent successful save clears it.
   */
  const status = saving
    ? SAVE_STATUS.SAVING
    : error
      ? SAVE_STATUS.FAILED
      : dirty
        ? SAVE_STATUS.UNSAVED
        : savedAt
          ? SAVE_STATUS.SAVED
          : SAVE_STATUS.IDLE;

  const isDirty = dirty || saving;

  // Accidental exits: the browser's own confirmation. Registered only while there is
  // something to lose, so a clean editor never shows the dialog.
  useEffect(() => {
    if (!warnBeforeUnload || !isDirty) return undefined;
    const handler = (event) => {
      event.preventDefault();
      // The legacy assignment is still what several browsers key off.
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [warnBeforeUnload, isDirty]);

  // In-app navigation. `useDebouncedCallback` cancels its pending timer on unmount
  // (rightly — firing a save from an unmounted component's stale closure is worse than
  // dropping it), so the pending write is issued here instead, from the ref that holds
  // the newest value.
  //
  // It is fire-and-forget: the screen is gone, so a failure cannot be shown. That is
  // the trade — silently dropping the last sentence the author typed is the worse of the
  // two outcomes, and `beforeunload` plus the explicit Save button cover the cases where
  // the user needs to know.
  useEffect(
    () => () => {
      if (!saveOnUnmountRef.current || !enabledRef.current) return;
      if (valueRef.current === savedValueRef.current) return;
      Promise.resolve()
        .then(() => saveRef.current(valueRef.current))
        .catch(() => {});
    },
    []
  );

  return { status, savedAt, error, sync, saveNow, flush };
}
