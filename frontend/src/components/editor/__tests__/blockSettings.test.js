/**
 * Settings-panel tests.
 *
 * These are unit tests rather than page tests because a settings panel is a pure
 * function of a block: given `block.data`, it renders controls, and each control hands
 * back a complete replacement `data`. That contract is what EditorPage relies on, so it
 * is what is asserted here — the panel is rendered directly and the `onChange` payload
 * is inspected.
 *
 * The structural operations (add/remove a table column, add/remove an FAQ item) get the
 * most attention. They are the ones that can corrupt a block rather than merely set a
 * field wrongly: a column added to the headers but not to the rows renders as a broken
 * grid, and no styling recovers from that.
 */

import { render, screen } from '@testing-library/react';
import { configure as configureDom } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { act } from '@testing-library/react';
import '@testing-library/jest-dom';

import BlockSettingsPanel from '../BlockSettingsPanel';

// See the note in src/pages/__tests__/editor.test.js: two copies of
// @testing-library/dom are installed, and user-event reads the one RTL did not
// configure.
configureDom({
  eventWrapper: (callback) => {
    let result;
    act(() => {
      result = callback();
    });
    return result;
  },
  asyncWrapper: async (callback) => {
    let result;
    await act(async () => {
      result = await callback();
    });
    return result;
  },
});

const user = userEvent.setup();

/**
 * Renders the panel for one block and returns the change spy.
 * The panel is always given a position so its region label is realistic.
 */
function renderPanel(block) {
  const onChange = jest.fn();
  render(
    <BlockSettingsPanel
      block={block}
      index={1}
      total={4}
      readOnly={false}
      onChange={onChange}
      onClose={() => {}}
      onDuplicate={() => {}}
      onDelete={() => {}}
    />
  );
  return onChange;
}

/** The `data` object from the most recent onChange call. */
const lastData = (onChange) => onChange.mock.calls[onChange.mock.calls.length - 1][0];

describe('BlockSettingsPanel', () => {
  it('is a labelled region naming the block and its position', () => {
    renderPanel({ id: 'x', type: 'heading', data: { level: 2, text: 'Hi' } });
    expect(
      screen.getByRole('region', { name: 'Settings for Heading block, position 2 of 4' })
    ).toBeInTheDocument();
  });

  it('sets the heading level as a number, not a string', async () => {
    const onChange = renderPanel({ id: 'x', type: 'heading', data: { level: 2, text: 'Hi' } });

    await user.selectOptions(screen.getByLabelText('Heading level'), '3');

    // A string level would still render (the renderer parses it) but would break the
    // `data.level === 3` comparisons the canvas uses to pick a type scale.
    expect(lastData(onChange)).toEqual({ level: 3, text: 'Hi' });
  });

  it('switches a list between bulleted and numbered', async () => {
    const onChange = renderPanel({
      id: 'x',
      type: 'list',
      data: { style: 'bullet', items: ['a', 'b'] },
    });

    await user.selectOptions(screen.getByLabelText('List style'), 'numbered');
    expect(lastData(onChange)).toEqual({ style: 'numbered', items: ['a', 'b'] });
  });

  it('edits image alt text and pairs the logo toggle with a position', async () => {
    const block = {
      id: 'x',
      type: 'image',
      data: { url: 'blogs/a.png', alt_text: '', has_logo_overlay: false, logo_position: 'none' },
    };
    const onChange = renderPanel(block);

    await user.type(screen.getByLabelText(/Alt text/), 'A');
    expect(lastData(onChange).alt_text).toBe('A');

    await user.click(screen.getByRole('checkbox', { name: /Logo overlay/ }));
    // Enabling the overlay must also choose a position: an overlay at "none" is a
    // contradiction the compositor cannot act on.
    expect(lastData(onChange)).toMatchObject({
      has_logo_overlay: true,
      logo_position: 'bottom_right',
    });
  });

  it('clears the logo position when the overlay is switched off', async () => {
    const onChange = renderPanel({
      id: 'x',
      type: 'image',
      data: { url: 'a.png', alt_text: 'A', has_logo_overlay: true, logo_position: 'top_left' },
    });

    await user.click(screen.getByRole('checkbox', { name: /Logo overlay/ }));
    expect(lastData(onChange)).toMatchObject({
      has_logo_overlay: false,
      logo_position: 'none',
    });
  });

  describe('table structure', () => {
    const tableBlock = () => ({
      id: 'x',
      type: 'table',
      data: {
        caption: 'Auspicious days',
        headers: ['Day', 'Ritual'],
        rows: [
          ['Monday', 'Rudrabhishek'],
          ['Saturday', 'Deep daan'],
        ],
      },
    });

    it('reports the current dimensions in words', () => {
      renderPanel(tableBlock());
      expect(screen.getByText(/2 columns/)).toBeInTheDocument();
      expect(screen.getByText(/2 rows/)).toBeInTheDocument();
    });

    it('adds a column to the headers and to every row', async () => {
      const onChange = renderPanel(tableBlock());

      await user.click(screen.getByRole('button', { name: 'Add column' }));

      const data = lastData(onChange);
      expect(data.headers).toEqual(['Day', 'Ritual', 'Column 3']);
      // The rows must grow with it, or the table renders ragged.
      expect(data.rows).toEqual([
        ['Monday', 'Rudrabhishek', ''],
        ['Saturday', 'Deep daan', ''],
      ]);
    });

    it('removes a column from the headers and from every row', async () => {
      const onChange = renderPanel(tableBlock());

      await user.click(screen.getByRole('button', { name: 'Remove column' }));

      const data = lastData(onChange);
      expect(data.headers).toEqual(['Day']);
      expect(data.rows).toEqual([['Monday'], ['Saturday']]);
    });

    it('adds a row at the current column width', async () => {
      const onChange = renderPanel(tableBlock());

      await user.click(screen.getByRole('button', { name: 'Add row' }));

      const data = lastData(onChange);
      expect(data.rows).toHaveLength(3);
      expect(data.rows[2]).toEqual(['', '']);
    });

    it('removes the last row', async () => {
      const onChange = renderPanel(tableBlock());

      await user.click(screen.getByRole('button', { name: 'Remove row' }));

      expect(lastData(onChange).rows).toEqual([['Monday', 'Rudrabhishek']]);
    });

    it('squares off a ragged table when its structure is changed', async () => {
      // Generated tables are sometimes ragged. Any structural edit is the point at which
      // that gets repaired — and the widest row wins, so repairing never deletes a cell
      // that already held content.
      const onChange = renderPanel({
        id: 'x',
        type: 'table',
        data: { headers: ['A', 'B'], rows: [['1'], ['1', '2', '3']] },
      });

      await user.click(screen.getByRole('button', { name: 'Add row' }));

      const data = lastData(onChange);
      expect(data.headers).toEqual(['A', 'B', 'Column 3']);
      expect(data.rows).toEqual([
        ['1', '', ''],
        ['1', '2', '3'],
        ['', '', ''],
      ]);
    });
  });

  describe('FAQ items', () => {
    const faqBlock = () => ({
      id: 'x',
      type: 'faq_accordion',
      data: {
        items: [
          { question: 'When?', answer: 'July.' },
          { question: 'Who?', answer: 'Anyone.' },
        ],
      },
    });

    it('adds an empty question/answer pair', async () => {
      const onChange = renderPanel(faqBlock());

      await user.click(screen.getByRole('button', { name: 'Add question' }));

      expect(lastData(onChange).items).toHaveLength(3);
      expect(lastData(onChange).items[2]).toEqual({ question: '', answer: '' });
    });

    it('removes the last pair, and refuses to remove the only one', async () => {
      const onChange = renderPanel(faqBlock());

      await user.click(screen.getByRole('button', { name: 'Remove question' }));
      expect(lastData(onChange).items).toEqual([{ question: 'When?', answer: 'July.' }]);

      // A FAQ block with no items renders as nothing at all, so the floor is one.
      renderPanel({ id: 'y', type: 'faq_accordion', data: { items: [{ question: '', answer: '' }] } });
      const removeButtons = screen.getAllByRole('button', { name: 'Remove question' });
      expect(removeButtons[removeButtons.length - 1]).toBeDisabled();
    });
  });

  it('disables every control while the row is locked by a generation run', () => {
    render(
      <BlockSettingsPanel
        block={{ id: 'x', type: 'cta_button', data: { text: 'Go', url: 'https://x.test' } }}
        index={0}
        total={1}
        readOnly
        onChange={() => {}}
        onClose={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
      />
    );

    // Text inputs go read-only rather than disabled, so their content stays selectable
    // and copyable while the row is locked.
    expect(screen.getByLabelText(/Button label/)).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});
