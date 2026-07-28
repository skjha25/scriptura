// frontend/src/components/editor/BlockBody.js
/**
 * The editable body of a block, on the canvas.
 *
 * ---------------------------------------------------------------------------
 * WHY ALL TEN LIVE IN ONE FILE
 * ---------------------------------------------------------------------------
 * These are ten variations on one idea: show the block's content at roughly the size
 * the preview will show it, and let the author type straight into it. They are small,
 * they share the same props contract and the same helpers, and the thing a reader
 * most often wants is to compare two of them. Ten files of thirty lines would make
 * that comparison a navigation exercise. The per-type *settings* panels are split
 * (see ./settings) because those are genuinely independent forms.
 *
 * ---------------------------------------------------------------------------
 * WHAT BELONGS HERE VS IN THE SETTINGS PANEL
 * ---------------------------------------------------------------------------
 * The canvas holds content — the words a reader will read. The settings panel holds
 * configuration — a heading's level, an image's alt text, a CTA's target. The split
 * is what keeps the canvas readable as an article rather than as a form.
 *
 * Every body renders at least one focusable control, so every block is reachable and
 * editable by keyboard alone.
 */

import clsx from 'clsx';

import { resolveImageUrl } from '../../lib/media';
import InlineEditable from './InlineEditable';
import { plainTextOf, isRichText, setBlockText } from './blockModel';

/** Type scale per heading level, matching `.prose-scriptura h2|h3|h4` in index.css. */
const HEADING_CLASS = {
  2: 'text-2xl font-semibold leading-snug',
  3: 'text-xl font-semibold',
  4: 'text-lg font-semibold',
};

/** Shared chrome for the small single-line inputs used by tables and FAQ items. */
const CELL_CLASS =
  'w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm ' +
  'text-ink placeholder:text-ink-faint hover:border-hairline focus:border-accent/60 focus:outline-none';

/** Small ghost button used for the add/remove affordances inside a body. */
function MiniButton({ onClick, children, label, tone = 'neutral' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={clsx(
        'rounded-md border border-hairline px-2 py-1 text-xs transition-colors',
        tone === 'danger'
          ? 'text-status-critical hover:bg-status-critical/15'
          : 'text-ink-muted hover:bg-panel-raised hover:text-ink'
      )}
    >
      {children}
    </button>
  );
}

/**
 * Warning shown above a block whose text arrived as inline HTML.
 *
 * The canvas edits plain text, so the first keystroke drops the formatting. Saying so
 * before it happens is the difference between a decision and a surprise.
 */
function RichTextNotice() {
  return (
    <p className="mb-1.5 text-[11px] text-status-warning">
      Formatted text — editing here keeps the words and drops the bold, italics and
      links.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Per-type bodies
// ---------------------------------------------------------------------------

function HeadingBody({ block, readOnly, onChange }) {
  const { data } = block;
  const level = Number(data.level) || 2;
  return (
    <>
      {isRichText(data) ? <RichTextNotice /> : null}
      <InlineEditable
        value={plainTextOf(data)}
        onChange={(text) => onChange(setBlockText(data, text), `${block.id}:text`)}
        ariaLabel={`Heading text, level ${level}`}
        placeholder="Section heading"
        singleLine
        readOnly={readOnly}
        className={HEADING_CLASS[level] || HEADING_CLASS[2]}
      />
    </>
  );
}

function ParagraphBody({ block, readOnly, onChange }) {
  const { data } = block;
  return (
    <>
      {isRichText(data) ? <RichTextNotice /> : null}
      <InlineEditable
        value={plainTextOf(data)}
        onChange={(text) => onChange(setBlockText(data, text), `${block.id}:text`)}
        ariaLabel={data.is_lead ? 'Lead paragraph text' : 'Paragraph text'}
        placeholder="Write a paragraph…"
        readOnly={readOnly}
        className={clsx(
          'leading-7',
          data.is_lead ? 'text-lg leading-8 text-ink' : 'text-[15px] text-ink-secondary'
        )}
      />
    </>
  );
}

function ImageBody({ block, readOnly, onChange }) {
  const { data } = block;
  const src = resolveImageUrl(data.url);

  return (
    <div className="space-y-2">
      {src ? (
        <img
          src={src}
          alt={data.alt_text || ''}
          className="max-h-64 w-full rounded-lg border border-hairline object-cover"
          loading="lazy"
        />
      ) : (
        <div className="grid h-32 place-items-center rounded-lg border border-dashed border-hairline-strong bg-panel-sunken px-4 text-center">
          <p className="text-xs text-ink-muted">
            No image yet — add a stored path or URL in the settings panel.
          </p>
        </div>
      )}
      <InlineEditable
        value={typeof data.caption === 'string' ? data.caption : ''}
        onChange={(caption) => onChange({ ...data, caption }, `${block.id}:caption`)}
        ariaLabel="Image caption"
        placeholder="Add a caption…"
        readOnly={readOnly}
        className="text-center text-xs text-ink-muted"
      />
      {/* Surfaced on the canvas rather than only in the panel: a missing alt text is
          an accessibility defect and an SEO one, and it is invisible otherwise. */}
      {!data.alt_text ? (
        <p className="text-center text-[11px] text-status-warning">
          No alt text — screen readers will announce nothing for this image.
        </p>
      ) : null}
    </div>
  );
}

function QuoteBody({ block, readOnly, onChange }) {
  const { data } = block;
  return (
    <div className="border-l-2 border-accent/60 pl-4">
      {isRichText(data) ? <RichTextNotice /> : null}
      <InlineEditable
        value={plainTextOf(data)}
        onChange={(text) => onChange(setBlockText(data, text), `${block.id}:text`)}
        ariaLabel="Quote text"
        placeholder="Quotation…"
        readOnly={readOnly}
        className="text-[15px] italic leading-7"
      />
      <InlineEditable
        value={typeof data.attribution === 'string' ? data.attribution : ''}
        onChange={(attribution) => onChange({ ...data, attribution }, `${block.id}:attribution`)}
        ariaLabel="Quote attribution"
        placeholder="Who said it"
        singleLine
        readOnly={readOnly}
        className="text-xs text-ink-muted"
      />
    </div>
  );
}

function TableBody({ block, readOnly, onChange }) {
  const { data } = block;
  const headers = Array.isArray(data.headers) ? data.headers : [];
  const rows = Array.isArray(data.rows) ? data.rows : [];

  function setHeader(index, value) {
    const next = headers.map((header, i) => (i === index ? value : header));
    onChange({ ...data, headers: next }, `${block.id}:header:${index}`);
  }

  function setCell(rowIndex, cellIndex, value) {
    const next = rows.map((row, i) =>
      i === rowIndex
        ? (Array.isArray(row) ? row : [row]).map((cell, j) => (j === cellIndex ? value : cell))
        : row
    );
    onChange({ ...data, rows: next }, `${block.id}:cell:${rowIndex}:${cellIndex}`);
  }

  return (
    // The wrapper is what lets a wide table scroll instead of widening the page —
    // the same trick the renderer uses for `.scriptura-table-wrap`.
    <div className="overflow-x-auto rounded-lg border border-hairline">
      <table className="w-full border-collapse text-sm">
        <caption className="px-2 pt-2 text-left">
          <InlineEditable
            value={typeof data.caption === 'string' ? data.caption : ''}
            onChange={(caption) => onChange({ ...data, caption }, `${block.id}:caption`)}
            ariaLabel="Table caption"
            placeholder="Table caption…"
            singleLine
            readOnly={readOnly}
            className="text-xs uppercase tracking-wide text-ink-muted"
          />
        </caption>
        <thead>
          <tr>
            {headers.map((header, index) => (
              // eslint-disable-next-line react/no-array-index-key -- column position is the identity
              <th key={index} scope="col" className="bg-panel-raised p-0 align-middle">
                <input
                  type="text"
                  value={String(header ?? '')}
                  readOnly={readOnly}
                  onChange={(event) => setHeader(index, event.target.value)}
                  aria-label={`Column ${index + 1} header`}
                  placeholder={`Column ${index + 1}`}
                  className={clsx(CELL_CLASS, 'text-xs font-semibold uppercase tracking-wide')}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            // eslint-disable-next-line react/no-array-index-key -- row position is the identity
            <tr key={rowIndex}>
              {(Array.isArray(row) ? row : [row]).map((cell, cellIndex) => (
                // eslint-disable-next-line react/no-array-index-key
                <td key={cellIndex} className="border-t border-hairline p-0 align-top">
                  <input
                    type="text"
                    value={String(cell ?? '')}
                    readOnly={readOnly}
                    onChange={(event) => setCell(rowIndex, cellIndex, event.target.value)}
                    aria-label={`Row ${rowIndex + 1}, column ${cellIndex + 1}`}
                    className={CELL_CLASS}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FaqBody({ block, readOnly, onChange }) {
  const { data } = block;
  const items = Array.isArray(data.items) ? data.items : [];

  function setItem(index, patch, field) {
    const next = items.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange({ ...data, items: next }, `${block.id}:faq:${index}:${field}`);
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        // eslint-disable-next-line react/no-array-index-key -- item position is the identity
        <div key={index} className="rounded-lg border border-hairline bg-panel-raised/50 p-2.5">
          <div className="flex items-start gap-2">
            <InlineEditable
              value={typeof item.question === 'string' ? item.question : ''}
              onChange={(question) => setItem(index, { question }, 'question')}
              ariaLabel={`Question ${index + 1}`}
              placeholder="Question"
              singleLine
              readOnly={readOnly}
              className="text-sm font-medium"
            />
            {!readOnly ? (
              <MiniButton
                tone="danger"
                label={`Remove question ${index + 1}`}
                onClick={() =>
                  onChange({ ...data, items: items.filter((_, i) => i !== index) }, null)
                }
              >
                ×
              </MiniButton>
            ) : null}
          </div>
          <InlineEditable
            value={typeof item.answer === 'string' ? item.answer : ''}
            onChange={(answer) => setItem(index, { answer }, 'answer')}
            ariaLabel={`Answer ${index + 1}`}
            placeholder="Answer"
            readOnly={readOnly}
            className="text-sm text-ink-secondary"
          />
        </div>
      ))}
      {!readOnly ? (
        <MiniButton
          label="Add FAQ item"
          onClick={() =>
            onChange({ ...data, items: [...items, { question: '', answer: '' }] }, null)
          }
        >
          + Add question
        </MiniButton>
      ) : null}
    </div>
  );
}

function CtaBody({ block, readOnly, onChange }) {
  const { data } = block;
  return (
    <div className="space-y-1.5 text-center">
      <div className="inline-block rounded-lg bg-glow-accent px-4 py-2 shadow-glow-sm">
        <InlineEditable
          value={typeof data.text === 'string' ? data.text : ''}
          onChange={(text) => onChange({ ...data, text }, `${block.id}:text`)}
          ariaLabel="Call-to-action label"
          placeholder="Button label"
          singleLine
          readOnly={readOnly}
          className="text-center text-sm font-semibold text-white placeholder:text-white/60"
        />
      </div>
      <p className="truncate text-[11px] text-ink-muted">
        {data.url ? `→ ${data.url}` : 'No link set — add one in the settings panel.'}
      </p>
    </div>
  );
}

/** Shared body for the two `items: string[]` types (list, key takeaways). */
function ItemsBody({ block, readOnly, onChange, ariaPrefix, placeholder, marker }) {
  const { data } = block;
  const items = Array.isArray(data.items) ? data.items : [];

  function setItem(index, value) {
    const next = items.map((item, i) => (i === index ? value : item));
    onChange({ ...data, items: next }, `${block.id}:item:${index}`);
  }

  function insertAfter(index) {
    const next = [...items.slice(0, index + 1), '', ...items.slice(index + 1)];
    onChange({ ...data, items: next }, null);
  }

  return (
    <div className="space-y-1">
      {items.map((item, index) => (
        // eslint-disable-next-line react/no-array-index-key -- list position is the identity
        <div key={index} className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-1 w-4 shrink-0 text-center text-xs text-accent">
            {marker(index)}
          </span>
          <InlineEditable
            value={typeof item === 'string' ? item : String(item ?? '')}
            onChange={(value) => setItem(index, value)}
            ariaLabel={`${ariaPrefix} ${index + 1}`}
            placeholder={placeholder}
            singleLine
            // Enter adds the next entry, which is what typing a list feels like.
            onEnter={() => !readOnly && insertAfter(index)}
            readOnly={readOnly}
            className="text-[15px] leading-7"
          />
          {!readOnly && items.length > 1 ? (
            <MiniButton
              tone="danger"
              label={`Remove ${ariaPrefix.toLowerCase()} ${index + 1}`}
              onClick={() => onChange({ ...data, items: items.filter((_, i) => i !== index) }, null)}
            >
              ×
            </MiniButton>
          ) : null}
        </div>
      ))}
      {!readOnly ? (
        <MiniButton
          label={`Add ${ariaPrefix.toLowerCase()}`}
          onClick={() => onChange({ ...data, items: [...items, ''] }, null)}
        >
          + Add item
        </MiniButton>
      ) : null}
    </div>
  );
}

function ListBody(props) {
  const numbered = props.block.data.style === 'numbered';
  return (
    <ItemsBody
      {...props}
      ariaPrefix="List item"
      placeholder="List item"
      marker={(index) => (numbered ? `${index + 1}.` : '•')}
    />
  );
}

function KeyTakeawayBody({ block, readOnly, onChange }) {
  const { data } = block;
  return (
    <div className="rounded-lg border border-accent/25 bg-glow-subtle p-3">
      <InlineEditable
        value={typeof data.title === 'string' ? data.title : ''}
        onChange={(title) => onChange({ ...data, title }, `${block.id}:title`)}
        ariaLabel="Key takeaways title"
        placeholder="Key takeaways"
        singleLine
        readOnly={readOnly}
        className="text-sm font-semibold uppercase tracking-wide text-accent-bright"
      />
      <ItemsBody
        block={block}
        readOnly={readOnly}
        onChange={onChange}
        ariaPrefix="Takeaway"
        placeholder="Takeaway"
        marker={() => '•'}
      />
    </div>
  );
}

function EmbedBody({ block, readOnly, onChange }) {
  const { data } = block;
  return (
    <div className="space-y-1.5">
      <InlineEditable
        value={typeof data.url === 'string' ? data.url : ''}
        onChange={(url) => onChange({ ...data, url }, `${block.id}:url`)}
        ariaLabel="Embed URL"
        placeholder="https://www.youtube.com/embed/…"
        singleLine
        readOnly={readOnly}
        className="font-mono text-xs"
      />
      <p className="text-[11px] text-ink-muted">
        {/^https:\/\//i.test(data.url || '')
          ? `Framed as “${data.title || 'Embedded content'}”.`
          : 'Only https URLs are framed; anything else renders as a plain link.'}
      </p>
    </div>
  );
}

const BODIES = {
  heading: HeadingBody,
  paragraph: ParagraphBody,
  image: ImageBody,
  quote: QuoteBody,
  table: TableBody,
  faq_accordion: FaqBody,
  cta_button: CtaBody,
  list: ListBody,
  embed: EmbedBody,
  key_takeaway: KeyTakeawayBody,
};

/**
 * Renders the editable body for one block.
 *
 * @param {object} props
 * @param {{id: string, type: string, data: object}} props.block
 * @param {boolean} props.readOnly True while a generation run owns the row.
 * @param {(data: object, mergeKey: string|null) => void} props.onChange Replaces the
 *   block's whole `data`. A `mergeKey` groups consecutive edits to one field into a
 *   single undo step; pass null for structural changes.
 */
export default function BlockBody({ block, readOnly, onChange }) {
  const Body = BODIES[block.type];

  // An unknown type degrades to a readable note rather than an empty card — the same
  // stance the renderer takes, so a newer build's block type cannot look like data
  // loss.
  if (!Body) {
    return (
      <p className="text-xs text-ink-muted">
        This block type (<code>{block.type}</code>) is not editable in this version.
      </p>
    );
  }

  return <Body block={block} readOnly={readOnly} onChange={onChange} />;
}
