/**
 * useBlockHistory tests.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE LIVES UNDER components/editor
 * ---------------------------------------------------------------------------
 * The hook itself is at src/hooks/useBlockHistory.js. Its test sits here because this is
 * the editor's own test directory and the hook exists solely for the editor; keeping the
 * two together also means one `--testPathPattern=editor` run covers both.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS WORTH TESTING
 * ---------------------------------------------------------------------------
 * Not "undo reverses a change" — the page test already proves that through the UI. What
 * needs a unit test is the behaviour that is invisible from the outside and easy to get
 * silently wrong: the coalescing rule and the bound on the stack. A history that quietly
 * stops coalescing makes undo step per keystroke; one that quietly stops bounding grows
 * until the tab is slow. Neither shows up in a feature test.
 *
 * A minimal harness component is used rather than `renderHook`, because the hook's
 * contract includes being usable with React's normal batching.
 */

import { render, screen, act } from '@testing-library/react';
import { useRef } from 'react';
import '@testing-library/jest-dom';

import useBlockHistory, { HISTORY_LIMIT } from '../../../hooks/useBlockHistory';

/** Captured on each render so a test can drive the hook directly. */
let api;

function Harness({ initial, limit }) {
  const history = useBlockHistory(initial, limit ? { limit } : undefined);
  const renders = useRef(0);
  renders.current += 1;
  api = history;

  return (
    <div>
      <span data-testid="text">{history.blocks.map((block) => block.data.text).join('|')}</span>
      <span data-testid="undo">{String(history.canUndo)}</span>
      <span data-testid="redo">{String(history.canRedo)}</span>
      <span data-testid="past">{history.depth.past}</span>
    </div>
  );
}

const INITIAL = [
  { id: 'a', type: 'paragraph', data: { text: 'one' } },
  { id: 'b', type: 'paragraph', data: { text: 'two' } },
];

/** Replaces the text of block `id`. */
function setText(id, text, options) {
  act(() => {
    api.setBlocks(
      (previous) =>
        previous.map((block) => (block.id === id ? { ...block, data: { text } } : block)),
      options
    );
  });
}

const text = () => screen.getByTestId('text').textContent;
const pastDepth = () => Number(screen.getByTestId('past').textContent);

beforeEach(() => {
  render(<Harness initial={INITIAL} />);
});

describe('useBlockHistory', () => {
  it('starts with no history to undo or redo', () => {
    expect(text()).toBe('one|two');
    expect(screen.getByTestId('undo')).toHaveTextContent('false');
    expect(screen.getByTestId('redo')).toHaveTextContent('false');
  });

  it('coalesces consecutive edits that share a mergeKey into one step', () => {
    // Simulating a word being typed: one state update per character, all in one field.
    'hello'.split('').forEach((_, index) => {
      setText('a', 'hello'.slice(0, index + 1), { mergeKey: 'a:text' });
    });

    expect(text()).toBe('hello|two');
    // Five updates, one undo step — otherwise undo walks back character by character.
    expect(pastDepth()).toBe(1);

    act(() => api.undo());
    expect(text()).toBe('one|two');
  });

  it('starts a new step when the mergeKey changes', () => {
    setText('a', 'first', { mergeKey: 'a:text' });
    setText('b', 'second', { mergeKey: 'b:text' });

    expect(pastDepth()).toBe(2);

    act(() => api.undo());
    expect(text()).toBe('first|two');
    act(() => api.undo());
    expect(text()).toBe('one|two');
  });

  it('always pushes a step for a structural change (no mergeKey)', () => {
    act(() => api.setBlocks((previous) => previous.slice(1)));
    act(() => api.setBlocks((previous) => previous.slice(1)));

    expect(text()).toBe('');
    expect(pastDepth()).toBe(2);
  });

  it('discards the redo branch once a new edit is made', () => {
    setText('a', 'edited', { mergeKey: 'a:text' });
    act(() => api.undo());
    expect(screen.getByTestId('redo')).toHaveTextContent('true');

    setText('b', 'diverged', { mergeKey: 'b:text' });
    expect(screen.getByTestId('redo')).toHaveTextContent('false');
  });

  it('redoes what it undid', () => {
    setText('a', 'edited', { mergeKey: 'a:text' });
    act(() => api.undo());
    act(() => api.redo());
    expect(text()).toBe('edited|two');
  });

  it('does not consume a step for a no-op update', () => {
    act(() => api.setBlocks((previous) => previous));
    expect(pastDepth()).toBe(0);
    expect(screen.getByTestId('undo')).toHaveTextContent('false');
  });

  it('bounds the stack, dropping the oldest step rather than the newest', () => {
    // Each entry is a full copy of the blocks array, so an unbounded stack grows with the
    // length of the editing session.
    const total = HISTORY_LIMIT + 10;
    for (let i = 0; i < total; i += 1) {
      setText('a', `v${i}`, { mergeKey: `step-${i}` });
    }

    expect(pastDepth()).toBe(HISTORY_LIMIT);
    expect(text()).toBe(`v${total - 1}|two`);

    // The most recent HISTORY_LIMIT steps are still reachable...
    for (let i = 0; i < HISTORY_LIMIT; i += 1) {
      act(() => api.undo());
    }
    expect(screen.getByTestId('undo')).toHaveTextContent('false');
    // ...and the oldest reachable state is the one HISTORY_LIMIT steps back, not the
    // original — the earliest entries were dropped, which is the intended trade.
    expect(text()).toBe(`v${total - 1 - HISTORY_LIMIT}|two`);
  });

  it('reset discards history so undo cannot reach a previous document', () => {
    setText('a', 'edited', { mergeKey: 'a:text' });
    expect(screen.getByTestId('undo')).toHaveTextContent('true');

    act(() => api.reset([{ id: 'z', type: 'paragraph', data: { text: 'fresh' } }]));

    expect(text()).toBe('fresh');
    expect(screen.getByTestId('undo')).toHaveTextContent('false');
    expect(screen.getByTestId('redo')).toHaveTextContent('false');
  });
});
