// frontend/src/pages/__tests__/wizard.test.js
/**
 * EditorPage integration tests.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE PAGE-LEVEL AND NOT UNIT TESTS
 * ---------------------------------------------------------------------------
 * Every behaviour the spec asks for is a collaboration: undo depends on how the canvas
 * reports an edit, autosave depends on what counts as dirty, the preview depends on
 * sharing one blocks array with the canvas. Unit tests of the pieces would pass with all
 * of those wired up wrongly. So the tests drive the real screen through its real
 * controls, and the only thing faked is the network.
 *
 * ---------------------------------------------------------------------------
 * THE TWO ENVIRONMENT STUBS, AND WHY EACH IS NEEDED
 * ---------------------------------------------------------------------------
 * 1. FAKE TIMERS THROUGHOUT. The debounced autosave, Framer Motion's enter/exit
 *    animations and dnd-kit's deferred listener attachment are all timer-driven.
 *    Faking time makes each of them a deliberate step rather than a race, and
 *    user-event is given `advanceTimers` so typing still works.
 *
 * 2. A LAYOUT STUB. jsdom performs no layout: every `getBoundingClientRect` is zero.
 *    dnd-kit sorts by comparing measured rectangles, so with real jsdom rects every
 *    block occupies the same point and nothing can move. The stub gives each block card
 *    a plausible 100px-tall row in document order, which is the minimum needed for
 *    dnd-kit's collision detection to have anything to detect.
 */

import { render, screen, within, act, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import EditorPage from '../EditorPage';
import { blogsApi } from '../../lib/api';

// Note: this file previously re-configured @testing-library/dom's event/async
// wrappers by hand, to work around two copies of that package being installed
// (react@14 wanted ^9, user-event@14 resolved ^10) — which left user-event running
// against unconfigured wrappers and emitting "not wrapped in act" warnings.
//
// package.json now pins @testing-library/react ^16 + dom ^10 so all three packages
// dedupe onto one copy, and RTL configures it itself. The manual override has been
// removed: with a single copy it double-wrapped asyncWrapper in act(), which breaks
// waitFor. Keep them aligned — `npm ls @testing-library/dom` should show one version.

// A factory rather than an automock: the real module builds an axios instance and
// installs interceptors at import time, none of which a component test should exercise.
jest.mock('../../lib/api', () => ({
  blogsApi: {
    get: jest.fn(),
    update: jest.fn(),
    publish: jest.fn(),
  },
}));

const BLOG_ID = '7';

/** One of every shape the tests need: plain text, a level, a list, a configured CTA. */
function makeBlog(overrides = {}) {
  return {
    id: 7,
    blog_title: 'Shravana 2026: rituals, dates and meaning',
    slug: 'shravana-2026',
    blog_status: 0,
    generation_status: 'generated',
    seo_score: 72,
    word_count: 1180,
    content_blocks: [
      {
        id: 'b1',
        type: 'paragraph',
        data: { text: 'Shravana arrives with a shift in cosmic rhythm.', is_lead: true },
      },
      { id: 'b2', type: 'heading', data: { level: 2, text: 'The Essence of Shravana' } },
      { id: 'b3', type: 'list', data: { style: 'bullet', items: ['Offer water to Shiva'] } },
      {
        id: 'b4',
        type: 'cta_button',
        data: { text: 'Talk to an astrologer', url: 'https://divinetalk.in/astrology' },
      },
    ],
    ...overrides,
  };
}

const BLOCK_ROW_HEIGHT = 100;

/** Rectangle in the shape dnd-kit reads. */
function rectOf(left, top, width, height) {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON() {
      return this;
    },
  };
}

/**
 * Gives every block card a distinct vertical row, in document order.
 *
 * Keyed off `data-block-id` because that attribute is on exactly the element dnd-kit
 * measures — the node behind `setNodeRef`.
 */
function stubLayout() {
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function measure() {
      if (this.hasAttribute && this.hasAttribute('data-block-id')) {
        const cards = Array.from(document.querySelectorAll('[data-block-id]'));
        const index = cards.indexOf(this);
        return rectOf(0, index * BLOCK_ROW_HEIGHT, 600, BLOCK_ROW_HEIGHT - 8);
      }
      return rectOf(0, 0, 600, 800);
    });
}

function setViewportWidth(width) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
}

let user;

beforeEach(() => {
  jest.useFakeTimers();
  user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  stubLayout();
  setViewportWidth(1024);

  blogsApi.get.mockResolvedValue(makeBlog());
  blogsApi.update.mockImplementation((id, payload) =>
    Promise.resolve({ ...makeBlog(), ...payload, word_count: 1200, seo_score: 74 })
  );
  blogsApi.publish.mockResolvedValue({ ...makeBlog(), blog_status: 1 });
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

async function loadEditor() {
  const utils = render(
    <MemoryRouter initialEntries={[`/blogs/${BLOG_ID}/edit`]}>
      <Routes>
        <Route path="/blogs/:id/edit" element={<EditorPage />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByRole('button', { name: 'Save draft' });
  return utils;
}

/** Block ids in rendered order — the assertion target for reordering. */
function blockOrder(container) {
  return Array.from(container.querySelectorAll('[data-block-id]')).map((node) =>
    node.getAttribute('data-block-id')
  );
}

/**
 * Lets timer-driven work complete.
 *
 * A generous default because Framer Motion's exit animation is what keeps a deleted
 * block mounted, and its frame loop under faked `requestAnimationFrame` needs more
 * simulated time than the animation's own duration suggests.
 */
async function settle(ms = 1000) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

// ---------------------------------------------------------------------------

describe('EditorPage — loading', () => {
  it('loads the blog and renders one editable card per block', async () => {
    const { container } = await loadEditor();

    expect(blogsApi.get).toHaveBeenCalledWith(BLOG_ID);

    const cards = Array.from(container.querySelectorAll('[data-block-id]'));
    expect(cards).toHaveLength(4);
    expect(blockOrder(container)).toEqual(['b1', 'b2', 'b3', 'b4']);

    // "Editable" is the load-bearing part: every card must expose at least one real
    // text control, or the block is visible but not editable.
    cards.forEach((card) => {
      expect(within(card).getAllByRole('textbox').length).toBeGreaterThan(0);
    });

    // Each card announces what it is and where it is.
    expect(
      screen.getByRole('group', { name: 'Paragraph block, position 1 of 4' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'CTA button block, position 4 of 4' })
    ).toBeInTheDocument();

    // The preview renders from the same blocks, through the shared renderer.
    const preview = screen.getByRole('region', { name: 'Live preview' });
    expect(within(preview).getByText('The Essence of Shravana')).toBeInTheDocument();

    // Nothing has changed yet, so the save state must not claim otherwise.
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });
});

describe('EditorPage — reordering', () => {
  /**
   * Drives dnd-kit's KEYBOARD sorting path, not a pointer drag.
   *
   * This is deliberate and it is the spec's required drag-reorder test. A real pointer
   * drag cannot be simulated meaningfully in jsdom: dnd-kit's PointerSensor decides
   * where an item has moved to purely from measured geometry, and jsdom never lays
   * anything out, so a synthesised pointermove carries no information the library can
   * act on. The keyboard path runs through the *same* sensor pipeline, the same
   * collision detection and the same `onDragEnd` — `sortableKeyboardCoordinates` picks
   * the target from the identical `droppableRects` map that a pointer drag consults. So
   * asserting on it exercises the reorder machinery end to end, and it has the second
   * benefit of proving the accessibility requirement at the same time.
   */
  it('moves a block down with the keyboard and updates the order', async () => {
    const { container } = await loadEditor();

    const handle = screen.getByRole('button', {
      name: 'Reorder Paragraph block, position 1 of 4',
    });
    // Focusing the handle selects its block, which is a state update, hence the act.
    act(() => {
      handle.focus();
    });

    // Space lifts the block.
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
    // The KeyboardSensor attaches its own keydown listener in a setTimeout(0), so arrow
    // keys are only heard after the queue drains.
    await settle(1);

    // Lifting immediately reports where the block currently sits.
    expect(
      screen.getByText('Paragraph block is over position 1 of 4.')
    ).toBeInTheDocument();

    fireEvent.keyDown(handle, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(
      screen.getByText('Paragraph block is over position 2 of 4.')
    ).toBeInTheDocument();

    // Space drops it. Dropping is what commits the reorder — arrowing only previews it.
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });

    await waitFor(() => expect(blockOrder(container)).toEqual(['b2', 'b1', 'b3', 'b4']));

    // The live region says what happened, in words that name the block and both
    // positions.
    expect(
      screen.getByText('Paragraph block moved from position 1 to 2.')
    ).toBeInTheDocument();

    // Reordering is an edit, so it must mark the document unsaved.
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });
});

describe('EditorPage — editing', () => {
  it('updates the block from an inline edit and marks the state unsaved', async () => {
    await loadEditor();

    const heading = screen.getByRole('textbox', { name: 'Heading text, level 2' });
    await user.clear(heading);
    await user.type(heading, 'Why Shravana matters');

    expect(heading).toHaveValue('Why Shravana matters');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    // The preview reads the same array, so it must already show the new text.
    const preview = screen.getByRole('region', { name: 'Live preview' });
    expect(within(preview).getByRole('heading', { name: 'Why Shravana matters' })).toBeInTheDocument();
  });

  it('undoes and redoes a change, and leaves Ctrl+Z alone inside a text field', async () => {
    await loadEditor();

    const heading = screen.getByRole('textbox', { name: 'Heading text, level 2' });
    await user.clear(heading);
    await user.type(heading, 'Rewritten heading');
    expect(heading).toHaveValue('Rewritten heading');

    // Consecutive keystrokes in one field coalesce into a single history step, so one
    // undo returns the whole edit rather than one character.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('textbox', { name: 'Heading text, level 2' })).toHaveValue(
      'The Essence of Shravana'
    );

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByRole('textbox', { name: 'Heading text, level 2' })).toHaveValue(
      'Rewritten heading'
    );

    // The shortcut works when focus is not in a field...
    act(() => {
      document.activeElement?.blur();
    });
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(screen.getByRole('textbox', { name: 'Heading text, level 2' })).toHaveValue(
      'The Essence of Shravana'
    );

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('textbox', { name: 'Heading text, level 2' })).toHaveValue(
      'Rewritten heading'
    );

    // ...and is deliberately NOT taken while focus is inside a text field, so the
    // browser's own text undo keeps working mid-sentence.
    const field = screen.getByRole('textbox', { name: 'Heading text, level 2' });
    act(() => {
      field.focus();
    });
    fireEvent.keyDown(field, { key: 'z', ctrlKey: true });
    expect(field).toHaveValue('Rewritten heading');
  });
});

describe('EditorPage — block management', () => {
  it('adds a block at a chosen position, duplicates one, and deletes one undoably', async () => {
    const { container } = await loadEditor();

    // --- add, at position 2 rather than at the end ---
    await user.click(screen.getByRole('button', { name: 'Insert block at position 2' }));
    await user.click(screen.getByRole('button', { name: 'Add Quote block' }));
    await settle();

    expect(blockOrder(container)).toHaveLength(5);
    expect(blockOrder(container)[1]).not.toBe('b2');
    expect(
      screen.getByRole('group', { name: 'Quote block, position 2 of 5' })
    ).toBeInTheDocument();

    // --- duplicate ---
    await user.click(screen.getByRole('button', { name: 'Duplicate Quote block' }));
    await settle();

    expect(blockOrder(container)).toHaveLength(6);
    expect(screen.getAllByRole('group', { name: /^Quote block/ })).toHaveLength(2);
    // The copy carries its own id, so React keys and the drag identity stay unique.
    const ids = blockOrder(container);
    expect(new Set(ids).size).toBe(ids.length);

    // --- delete, with an undo offer ---
    await user.click(screen.getByRole('button', { name: 'Delete Paragraph block' }));

    // The block is dropped from state immediately; it lingers in the DOM only for the
    // length of its exit animation, so removal is awaited rather than asserted at once.
    await waitFor(() => expect(blockOrder(container)).toHaveLength(5), { timeout: 4000 });
    expect(screen.getByText('Paragraph block deleted.')).toBeInTheDocument();

    // Deletion is recoverable — the notice offers the same undo the shortcut does.
    await user.click(
      screen.getByRole('button', { name: 'Undo deleting the Paragraph block' })
    );
    await settle();
    expect(blockOrder(container)).toHaveLength(6);
    expect(screen.getByRole('group', { name: /^Paragraph block/ })).toBeInTheDocument();
  });
});

describe('EditorPage — saving', () => {
  it('autosaves after a quiet period and never sends rendered HTML', async () => {
    await loadEditor();

    const lead = screen.getByRole('textbox', { name: 'Lead paragraph text' });
    await user.type(lead, ' Truly.');

    // Still debounced.
    expect(blogsApi.update).not.toHaveBeenCalled();

    await settle(1300);
    await waitFor(() => expect(blogsApi.update).toHaveBeenCalledTimes(1));

    const [sentId, payload] = blogsApi.update.mock.calls[0];
    expect(sentId).toBe(BLOG_ID);
    expect(Object.keys(payload)).toEqual(['content_blocks']);
    // blog_content, word_count and seo_score are the server's to derive.
    expect(payload).not.toHaveProperty('blog_content');
    expect(payload.content_blocks[0].data.text).toContain('Truly.');

    expect(await screen.findByText(/^Saved at /)).toBeInTheDocument();
  });

  it('flushes immediately when Save draft is pressed', async () => {
    await loadEditor();

    const lead = screen.getByRole('textbox', { name: 'Lead paragraph text' });
    await user.type(lead, '!');
    expect(blogsApi.update).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    // No timer advance: the pending debounce was cancelled and the write issued now.
    await waitFor(() => expect(blogsApi.update).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/^Saved at /)).toBeInTheDocument();
  });

  it('surfaces a 409 GENERATION_IN_PROGRESS and keeps the edits', async () => {
    blogsApi.update.mockRejectedValue({
      message:
        'Content is being generated for this blog right now. Wait for it to finish before editing.',
      code: 'GENERATION_IN_PROGRESS',
      status: 409,
      fieldErrors: null,
    });

    await loadEditor();

    const heading = screen.getByRole('textbox', { name: 'Heading text, level 2' });
    await user.clear(heading);
    await user.type(heading, 'Edited while generating');

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Content is being generated/)
    );

    // The edit is still the author's — a refused save must not discard it.
    expect(screen.getByRole('textbox', { name: 'Heading text, level 2' })).toHaveValue(
      'Edited while generating'
    );
    expect(screen.getByText('Save failed')).toBeInTheDocument();
    expect(screen.getByText(/edits are still here and unsaved/)).toBeInTheDocument();
  });
});

describe('EditorPage — publishing', () => {
  it('publishes through the API', async () => {
    await loadEditor();

    await user.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(blogsApi.publish).toHaveBeenCalledWith(BLOG_ID));
    expect(await screen.findByText('Published. The article is now live.')).toBeInTheDocument();
  });

  it('surfaces the reason when publishing is refused with 422 NO_CONTENT', async () => {
    blogsApi.publish.mockRejectedValue({
      message: 'This blog has no content blocks. Add content before publishing.',
      code: 'NO_CONTENT',
      status: 422,
      fieldErrors: null,
    });

    await loadEditor();
    await user.click(screen.getByRole('button', { name: 'Publish' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This blog has no content blocks. Add content before publishing.'
    );
  });
});

describe('EditorPage — responsive', () => {
  /**
   * A smoke test, honestly scoped.
   *
   * jsdom applies no CSS and performs no layout, so `scrollWidth` is always 0 and an
   * assertion that "nothing overflows" would pass no matter what the styles said. What
   * *is* checkable without a browser is that the screen renders and operates at 375px,
   * and that no element pins a width wider than the viewport — which is the actual cause
   * of horizontal scroll when it happens. Real overflow was checked in a browser at
   * 375 / 768 / 1440.
   */
  it('renders and operates at 375px, with the settings panel as a bottom sheet', async () => {
    setViewportWidth(375);
    const { container } = await loadEditor();

    expect(container.querySelectorAll('[data-block-id]')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();

    const pinnedTooWide = Array.from(container.querySelectorAll('*')).filter((node) => {
      const className = typeof node.className === 'string' ? node.className : '';
      const match = className.match(/(?:^|\s)(?:min-)?w-\[(\d+)px\]/);
      return Boolean(match) && Number(match[1]) > 375;
    });
    expect(pinnedTooWide).toEqual([]);

    // Below `lg` the panel is a fixed bottom sheet rather than a side column, so it
    // does not squeeze the canvas into a scrolling strip.
    await user.click(screen.getByRole('button', { name: 'Settings for Heading block' }));
    const panel = await screen.findByRole('region', { name: /^Settings for Heading block/ });
    expect(panel.className).toMatch(/(?:^|\s)fixed(?:\s|$)/);
    expect(panel.className).toMatch(/lg:static/);
  });
});
