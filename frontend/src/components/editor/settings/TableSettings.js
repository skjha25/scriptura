// frontend/src/components/editor/settings/TableSettings.js
/**
 * Table block settings: caption, and the row/column structure.
 *
 * ---------------------------------------------------------------------------
 * WHY STRUCTURE IS EDITED HERE AND CELLS ON THE CANVAS
 * ---------------------------------------------------------------------------
 * Typing into a cell is content; adding a column changes the shape of every row. Put
 * an "add column" button in the table itself and it has to live in a header cell,
 * where it competes with the header text and is unreachable once the table scrolls
 * horizontally. The panel is stable, always visible, and can state the current
 * dimensions in words.
 *
 * ---------------------------------------------------------------------------
 * THE RAGGED-ROW PROBLEM
 * ---------------------------------------------------------------------------
 * `rows` is an array of arrays and nothing stops the rows from having different
 * lengths — a generated table sometimes does. Every operation below normalises to the
 * header count, because a ragged table renders as a broken grid and no amount of CSS
 * fixes missing `<td>`s.
 */

import { Input } from '../../ui/form';
import { CountControl, SettingsNote } from './shared';

/** Pads or truncates every row to `width` cells. */
function normalizeRows(rows, width) {
  return rows.map((row) => {
    const cells = Array.isArray(row) ? row : [row];
    const next = cells.slice(0, width).map((cell) => (cell === null || cell === undefined ? '' : cell));
    while (next.length < width) next.push('');
    return next;
  });
}

/**
 * Squares the whole table off at `width` columns.
 *
 * Applied on every structural change, not just on add-column: a table whose headers and
 * rows disagree renders with missing cells, and the widest row is taken as the truth so
 * that repairing the shape never silently deletes content.
 */
function normalizeTable(headers, rows, width) {
  const nextHeaders = headers
    .slice(0, width)
    .map((header) => (header === null || header === undefined ? '' : header));
  while (nextHeaders.length < width) nextHeaders.push(`Column ${nextHeaders.length + 1}`);
  return { headers: nextHeaders, rows: normalizeRows(rows, width) };
}

export default function TableSettings({ block, readOnly, onChange }) {
  const { data } = block;
  const headers = Array.isArray(data.headers) ? data.headers : [];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const columnCount = Math.max(headers.length, ...rows.map((row) => (Array.isArray(row) ? row.length : 1)), 0);

  function commit(next) {
    onChange({ ...data, ...next }, null);
  }

  function addColumn() {
    commit(normalizeTable(headers, rows, columnCount + 1));
  }

  function removeColumn() {
    commit(normalizeTable(headers, rows, Math.max(1, columnCount - 1)));
  }

  function addRow() {
    commit(normalizeTable(headers, [...rows, []], columnCount));
  }

  function removeRow() {
    commit(normalizeTable(headers, rows.slice(0, -1), columnCount));
  }

  return (
    <div className="space-y-4">
      <Input
        label="Caption"
        value={data.caption || ''}
        readOnly={readOnly}
        hint="Describes what the table compares. Read out before the data."
        onChange={(event) =>
          onChange({ ...data, caption: event.target.value }, `${block.id}:settings:caption`)
        }
      />

      <div className="space-y-2 border-t border-hairline pt-4">
        <CountControl
          label="Columns"
          unit="column"
          count={columnCount}
          onAdd={addColumn}
          onRemove={removeColumn}
          disabled={readOnly}
        />
        <CountControl
          label="Rows"
          unit="row"
          count={rows.length}
          onAdd={addRow}
          onRemove={removeRow}
          min={0}
          disabled={readOnly}
        />
        <SettingsNote>
          Removing a column or row drops its content and cannot be recovered except with
          undo.
        </SettingsNote>
      </div>
    </div>
  );
}
