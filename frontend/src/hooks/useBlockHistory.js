// frontend/src/hooks/useBlockHistory.js
/**
 * Undo/redo for the block editor's `content_blocks` array.
 *
 * ---------------------------------------------------------------------------
 * WHY A DEDICATED HOOK
 * ---------------------------------------------------------------------------
 * The editor mutates one value — an array of blocks — and every mutation is a
 * whole-array replacement. That makes past/present/future the natural model, and it
 * means undo does not need to know what changed, only what the array was. Pushing
 * that into a hook keeps EditorPage as the state owner without also making it the
 * history bookkeeper.
 *
 * ---------------------------------------------------------------------------
 * TWO DECISIONS WORTH EXPLAINING
 * ---------------------------------------------------------------------------
 * 1. THE STACK IS BOUNDED (50 entries). Each entry is a full copy of the blocks
 *    array, and a long editing session on a 60-block article would otherwise grow
 *    without limit. 50 steps is far more than anyone reaches for, and the oldest
 *    entry is dropped rather than the newest.
 *
 * 2. CONSECUTIVE EDITS COALESCE VIA `mergeKey`. Typing a sentence fires a state
 *    update per keystroke. Without coalescing, undo would step backwards one
 *    character at a time and be useless. Callers pass a key identifying the field
 *    being edited (`"<blockId>:text"`); while the key is unchanged the top of the
 *    past stack is reused, so one field-editing session is one undo step. Structural
 *    changes (insert, delete, reorder) pass no key and therefore always push.
 *
 * Native text undo inside a focused textarea is a separate mechanism and is left
 * alone — see the keyboard handler in EditorPage.
 */

import { useReducer, useCallback, useMemo } from 'react';

/** Maximum entries kept in either direction. */
export const HISTORY_LIMIT = 50;

function initialState(blocks) {
  return { past: [], present: Array.isArray(blocks) ? blocks : [], future: [], mergeKey: null };
}

function reducer(state, action) {
  switch (action.type) {
    case 'set': {
      const next =
        typeof action.blocks === 'function' ? action.blocks(state.present) : action.blocks;

      // A no-op update must not consume an undo step. Reference equality is the
      // right test: every real mutation builds a new array.
      if (next === state.present) return state;

      const coalesce = action.mergeKey != null && action.mergeKey === state.mergeKey;
      const past = coalesce
        ? state.past
        : [...state.past, state.present].slice(-action.limit);

      // Any new edit invalidates the redo branch — the same rule every editor uses.
      return { past, present: next, future: [], mergeKey: action.mergeKey ?? null };
    }

    case 'undo': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future].slice(0, action.limit),
        // Cleared so the next edit always starts a fresh step rather than merging
        // into the entry we just restored.
        mergeKey: null,
      };
    }

    case 'redo': {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return {
        past: [...state.past, state.present].slice(-action.limit),
        present: next,
        future: rest,
        mergeKey: null,
      };
    }

    case 'reset':
      return initialState(action.blocks);

    default:
      return state;
  }
}

/**
 * @param {Array} [initialBlocks]
 * @param {{limit?: number}} [options]
 * @returns {{
 *   blocks: Array,
 *   setBlocks: (blocksOrUpdater: Array|Function, options?: {mergeKey?: string}) => void,
 *   undo: () => void,
 *   redo: () => void,
 *   canUndo: boolean,
 *   canRedo: boolean,
 *   reset: (blocks: Array) => void,
 *   depth: {past: number, future: number}
 * }}
 */
export default function useBlockHistory(initialBlocks = [], { limit = HISTORY_LIMIT } = {}) {
  const [state, dispatch] = useReducer(reducer, initialBlocks, initialState);

  const setBlocks = useCallback(
    (blocks, { mergeKey = null } = {}) => dispatch({ type: 'set', blocks, mergeKey, limit }),
    [limit]
  );

  const undo = useCallback(() => dispatch({ type: 'undo', limit }), [limit]);
  const redo = useCallback(() => dispatch({ type: 'redo', limit }), [limit]);

  /** Discards history. Used after a load, so undo cannot reach a previous blog. */
  const reset = useCallback((blocks) => dispatch({ type: 'reset', blocks }), []);

  const depth = useMemo(
    () => ({ past: state.past.length, future: state.future.length }),
    [state.past.length, state.future.length]
  );

  return {
    blocks: state.present,
    setBlocks,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    reset,
    depth,
  };
}
