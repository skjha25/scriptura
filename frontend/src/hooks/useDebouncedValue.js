// frontend/src/hooks/useDebouncedValue.js
/**
 * Debounce and interval helpers shared by the search box, the editor's autosave,
 * and the generation-status poller.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Returns `value` after it has stopped changing for `delay` ms.
 *
 * Used for the blog-list search box, so typing "mercury retrograde" issues one
 * request instead of eighteen.
 *
 * @param {*} value
 * @param {number} [delay]
 */
export function useDebouncedValue(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/**
 * Returns a debounced version of a callback, plus `flush` and `cancel`.
 *
 * The editor's autosave needs all three: debounce while typing, `flush` when the
 * user hits Save or navigates away (so the last keystrokes are not lost), and
 * `cancel` on unmount.
 *
 * The callback is held in a ref so a re-render does not reset the pending timer —
 * without that, a component that re-renders on every keystroke would never
 * actually fire.
 *
 * @param {Function} callback
 * @param {number} delay
 */
export function useDebouncedCallback(callback, delay = 800) {
  const timerRef = useRef(null);
  const callbackRef = useRef(callback);
  const pendingArgsRef = useRef(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingArgsRef.current = null;
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const args = pendingArgsRef.current || [];
      pendingArgsRef.current = null;
      return callbackRef.current(...args);
    }
    return undefined;
  }, []);

  const debounced = useCallback(
    (...args) => {
      pendingArgsRef.current = args;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        pendingArgsRef.current = null;
        callbackRef.current(...args);
      }, delay);
    },
    [delay]
  );

  // Cancel rather than flush on unmount: firing a save against an unmounted
  // component's stale state is worse than dropping it, and callers that care call
  // flush() explicitly before navigating.
  useEffect(() => cancel, [cancel]);

  return { debounced, flush, cancel, isPending: () => timerRef.current !== null };
}

/**
 * Runs `callback` every `delay` ms. Pass `null` to stop.
 *
 * Used to poll generation status. The callback lives in a ref so the interval is
 * not torn down and recreated on every render, which would reset the clock and
 * (with a short delay) fire far more often than intended.
 *
 * @param {Function} callback
 * @param {number|null} delay
 */
export function useInterval(callback, delay) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null || delay === undefined) return undefined;
    const id = setInterval(() => callbackRef.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

export default useDebouncedValue;
