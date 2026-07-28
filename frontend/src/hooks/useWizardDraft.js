// frontend/src/hooks/useWizardDraft.js
/**
 * Draft persistence for the wizard.
 *
 * ---------------------------------------------------------------------------
 * WHY THE WIZARD HAS NO CLIENT-SIDE DRAFT STORE
 * ---------------------------------------------------------------------------
 * The whole configuration lives on the single `blogs` row, so this hook writes
 * straight through to the API instead of keeping a parallel copy in localStorage.
 * A second store would need reconciling with the server on every load, and the
 * failure mode of getting that wrong — a stale local draft silently overwriting a
 * newer row — is worse than the failure mode of not having one.
 *
 * Three problems it does solve, none of which a bare `blogsApi.update` call at
 * each step would:
 *
 * 1. THE FIRST SAVE HAS NO ROW TO SAVE TO. `blogsApi.create` needs a
 *    `blog_title`, which the author may not have typed yet. Patches accumulate
 *    until a title exists and are then included in the create call, so the topic
 *    typed before the title is not lost.
 *
 * 2. WRITES MUST NOT OVERLAP. Two concurrent creates would produce two blogs;
 *    two concurrent patches could land out of order. A single in-flight write at
 *    a time, draining a pending patch, avoids both without a queue library.
 *
 * 3. A FAILED WRITE MUST NOT LOSE EDITS. On failure the patch goes back into
 *    pending, so the next keystroke retries it rather than silently dropping the
 *    author's work.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { blogsApi } from '../lib/api';
import { useDebouncedCallback } from './useDebouncedValue';

/**
 * @param {object} options
 * @param {number|string|null} options.blogId Existing row, or null before create.
 * @param {(blog: object) => void} [options.onCreated] Called once, with the new row.
 * @param {number} [options.delay] Autosave debounce, ms.
 */
export function useWizardDraft({ blogId, onCreated, delay = 900 } = {}) {
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);

  /** Fields changed but not yet written. Merged, so the last value per key wins. */
  const pendingRef = useRef({});
  const busyRef = useRef(false);
  const blogIdRef = useRef(blogId ? Number(blogId) : null);
  const onCreatedRef = useRef(onCreated);
  const mountedRef = useRef(true);

  useEffect(() => {
    onCreatedRef.current = onCreated;
  }, [onCreated]);

  useEffect(() => {
    if (blogId) blogIdRef.current = Number(blogId);
  }, [blogId]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  /**
   * Drains `pendingRef` to the server.
   *
   * Loops rather than writing once: an edit made while a request was in flight
   * lands in pending, and a single-shot commit would leave it there until the
   * next keystroke — which, for the last keystroke before navigating away, never
   * comes.
   */
  const commit = useCallback(async () => {
    if (busyRef.current) return;
    if (Object.keys(pendingRef.current).length === 0) return;

    busyRef.current = true;
    setSaving(true);
    try {
      while (Object.keys(pendingRef.current).length > 0) {
        const patch = pendingRef.current;
        const id = blogIdRef.current;

        // A row cannot be created without a title. Hold everything until one
        // arrives; this is not a lost write, it is a deferred create.
        if (!id && !patch.blog_title) return;

        pendingRef.current = {};
        try {
          const blog = id ? await blogsApi.update(id, patch) : await blogsApi.create(patch);
          if (!id && blog?.id) {
            blogIdRef.current = Number(blog.id);
            onCreatedRef.current?.(blog);
          }
          if (mountedRef.current) {
            setError(null);
            setSavedAt(new Date());
          }
        } catch (err) {
          // Anything the author changed while this request was failing must win
          // over the values that just failed, hence the ordering.
          pendingRef.current = { ...patch, ...pendingRef.current };
          if (mountedRef.current) setError(err);
          return;
        }
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }, []);

  const { debounced, cancel } = useDebouncedCallback(commit, delay);

  /** Queues a patch and schedules a write. */
  const save = useCallback(
    (patch) => {
      if (!patch || Object.keys(patch).length === 0) return;
      pendingRef.current = { ...pendingRef.current, ...patch };
      debounced();
    },
    [debounced]
  );

  /**
   * Writes everything outstanding now.
   *
   * Called before advancing a step and before submitting the generation run: the
   * server reads the row, so a debounce timer still counting down would mean
   * generating from a configuration one keystroke behind what the author sees.
   */
  const saveNow = useCallback(
    async (patch) => {
      if (patch && Object.keys(patch).length > 0) {
        pendingRef.current = { ...pendingRef.current, ...patch };
      }
      cancel();
      await commit();
      return blogIdRef.current;
    },
    [cancel, commit]
  );

  return {
    save,
    saveNow,
    saving,
    savedAt,
    error,
    /** True while edits exist that the server has not accepted. */
    hasPending: () => Object.keys(pendingRef.current).length > 0,
    dismissError: useCallback(() => setError(null), []),
  };
}

export default useWizardDraft;
