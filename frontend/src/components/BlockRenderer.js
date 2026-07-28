// frontend/src/components/BlockRenderer.js
/**
 * The canonical article renderer.
 *
 * ---------------------------------------------------------------------------
 * ONE COMPONENT, TWO PLACES
 * ---------------------------------------------------------------------------
 * The spec requires that "the editor's live preview and the actual public blog
 * page" use the same rendering component. This is that component. Both
 * `BlockEditor`'s preview pane and `BlogView`'s article body render
 * `<BlockRenderer blocks={...} />` from the same `content_blocks` array, so there
 * is no second implementation that could disagree.
 *
 * It renders from BLOCKS, not from the stored `blog_content` HTML. That matters:
 * `blog_content` is derived server-side for external consumers (the existing
 * Divinetalk site, crawlers, SEO), while the app itself always works from the
 * editable source of truth. An author therefore cannot be shown something
 * different from what they are editing.
 *
 * ---------------------------------------------------------------------------
 * PARITY WITH THE BACKEND
 * ---------------------------------------------------------------------------
 * The markup here mirrors backend/src/services/blocksToHtml.js — same tags, same
 * `scriptura-` class names, same structure — so a single stylesheet
 * (`.prose-scriptura` in index.css) styles both. Parity is verified by
 * src/components/__tests__/blockRenderer.parity.test.js, which renders every case
 * in shared/block-fixtures.json and compares the resulting DOM against the HTML
 * the backend produced for the same input.
 *
 * If you change markup here, change it there and regenerate the fixtures.
 */

import { memo, Fragment } from 'react';
import { sanitizeInline, safeUrl } from '../lib/sanitizeInline';

/** h1 is the page title; the editor offers h2–h4. */
const MIN_HEADING_LEVEL = 2;
const MAX_HEADING_LEVEL = 4;

function headingLevel(value) {
  const level = Number.parseInt(value, 10);
  if (!Number.isFinite(level)) return MIN_HEADING_LEVEL;
  return Math.min(MAX_HEADING_LEVEL, Math.max(MIN_HEADING_LEVEL, level));
}

/**
 * Renders a block's inline text.
 *
 * `data.html` (author formatting) is sanitised and injected; `data.text` (plain)
 * is returned as a string for React to escape. Returning two different kinds of
 * value is deliberate — it keeps plain text on React's safe path entirely, rather
 * than routing everything through innerHTML.
 *
 * @returns {{__html: string}|string|null}
 */
function inlineContent(data) {
  if (typeof data.html === 'string' && data.html.trim() !== '') {
    return { __html: sanitizeInline(data.html) };
  }
  if (typeof data.text === 'string' && data.text !== '') return data.text;
  return null;
}

/** True when inlineContent returned sanitised HTML rather than plain text. */
const isHtml = (content) => content !== null && typeof content === 'object';

/**
 * Renders plain text, honouring explicit newlines as `<br />`.
 *
 * Uses `Fragment`, not `<span>`, deliberately. A wrapper element would add markup
 * the backend's renderer does not emit, which would break the DOM parity the
 * fixture test asserts — and, less abstractly, would change how `.prose-scriptura`
 * styling and text selection behave.
 */
function TextWithBreaks({ text }) {
  const lines = String(text).split(/\r?\n/);
  return lines.map((line, index) => (
    // eslint-disable-next-line react/no-array-index-key -- position IS the identity of a line break
    <Fragment key={index}>
      {line}
      {index < lines.length - 1 ? <br /> : null}
    </Fragment>
  ));
}

/**
 * Renders inline content into `Tag`, choosing between the sanitised-HTML path and
 * the plain-text path.
 *
 * Injecting on the element itself rather than into a nested `<span>` is what keeps
 * the output byte-comparable with the backend renderer.
 *
 * @param {object} props
 * @param {string} props.tag Element to render.
 * @param {object} props.data Block data carrying `text` and/or `html`.
 * @param {boolean} [props.keepEmpty] Render the element even with no content.
 *   Used where the container is structural — an FAQ answer panel must exist for
 *   the accordion to have something to reveal, and the backend emits it
 *   unconditionally.
 */
function InlineInto({ tag: Tag, data, keepEmpty = false, ...props }) {
  const content = inlineContent(data);
  if (content === null) return keepEmpty ? <Tag {...props} /> : null;
  return isHtml(content) ? (
    <Tag {...props} dangerouslySetInnerHTML={content} />
  ) : (
    <Tag {...props}>
      <TextWithBreaks text={content} />
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Per-block renderers
// ---------------------------------------------------------------------------

function HeadingBlock({ data }) {
  return <InlineInto tag={`h${headingLevel(data.level)}`} data={data} />;
}

function ParagraphBlock({ data }) {
  // `lead` reproduces the existing production convention of a styled opening
  // paragraph (see the sample row's `<p class="lead">`).
  return <InlineInto tag="p" data={data} className={data.is_lead ? 'lead' : undefined} />;
}

function ImageBlock({ data, resolveUrl }) {
  const raw = data.url || data.src || '';
  const src = safeUrl(raw);
  if (src === '') return null;
  return (
    <figure className="scriptura-figure">
      <img
        className="scriptura-image"
        src={resolveUrl(src)}
        // An empty alt is valid for decorative images, so it is emitted rather
        // than omitted — omitting it makes screen readers announce the filename.
        alt={data.alt_text || data.alt || ''}
        loading="lazy"
        decoding="async"
      />
      {data.caption ? <figcaption className="scriptura-figcaption">{data.caption}</figcaption> : null}
    </figure>
  );
}

function QuoteBlock({ data }) {
  const content = inlineContent(data);
  if (content === null) return null;
  return (
    <blockquote className="scriptura-quote">
      <InlineInto tag="p" data={data} />
      {data.attribution ? (
        <cite className="scriptura-quote-attribution">{data.attribution}</cite>
      ) : null}
    </blockquote>
  );
}

function TableBlock({ data }) {
  const headers = Array.isArray(data.headers) ? data.headers : [];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (headers.length === 0 && rows.length === 0) return null;

  return (
    // The wrapper is what lets a wide table scroll horizontally on mobile
    // instead of forcing the whole page wider.
    <div className="scriptura-table-wrap">
      <table className="scriptura-table">
        {data.caption ? <caption className="scriptura-table-caption">{data.caption}</caption> : null}
        {headers.length > 0 ? (
          <thead>
            <tr>
              {headers.map((header, index) => (
                // scope="col" is what associates each cell with its column
                // header for a screen reader. The HTML is injected on the <th>
                // itself rather than a nested <span> so the markup matches the
                // backend renderer exactly.
                // eslint-disable-next-line react/no-array-index-key -- column position is the identity
                <th
                  key={index}
                  scope="col"
                  dangerouslySetInnerHTML={{ __html: sanitizeInline(String(header ?? '')) }}
                />
              ))}
            </tr>
          </thead>
        ) : null}
        {rows.length > 0 ? (
          <tbody>
            {rows.map((row, rowIndex) => {
              const cells = Array.isArray(row) ? row : [row];
              return (
                // eslint-disable-next-line react/no-array-index-key -- row position is the identity
                <tr key={rowIndex}>
                  {cells.map((cell, cellIndex) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <td
                      key={cellIndex}
                      dangerouslySetInnerHTML={{ __html: sanitizeInline(String(cell ?? '')) }}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        ) : null}
      </table>
    </div>
  );
}

function FaqBlock({ data }) {
  const items = (Array.isArray(data.items) ? data.items : []).filter(
    (item) => item && (item.question || item.answer)
  );
  if (items.length === 0) return null;

  return (
    // <details>/<summary> gives a real accordion with no JavaScript, stays
    // expandable for crawlers, and is keyboard accessible for free.
    <section className="scriptura-faq">
      {items.map((item, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <details key={index} className="scriptura-faq-item">
          <InlineInto
            tag="summary"
            className="scriptura-faq-question"
            data={{ text: item.question, html: item.question_html }}
          />
          <InlineInto
            tag="div"
            className="scriptura-faq-answer"
            data={{ text: item.answer, html: item.answer_html }}
            keepEmpty
          />
        </details>
      ))}
    </section>
  );
}

function CtaBlock({ data }) {
  const href = safeUrl(data.url || data.href || '');
  const label = data.text || data.label || '';
  if (href === '' || label === '') return null;
  const external = /^https?:\/\//i.test(href);
  return (
    <div className="scriptura-cta">
      <a
        className="scriptura-cta-button"
        href={href}
        {...(external ? { rel: 'noopener noreferrer', target: '_blank' } : {})}
      >
        {label}
      </a>
    </div>
  );
}

function ListBlock({ data }) {
  const items = (Array.isArray(data.items) ? data.items : []).filter(
    (item) => item !== null && item !== undefined && String(item).trim() !== ''
  );
  if (items.length === 0) return null;

  const ordered = data.style === 'numbered' || data.ordered === true;
  const Tag = ordered ? 'ol' : 'ul';
  const className = `scriptura-list ${ordered ? 'scriptura-list-numbered' : 'scriptura-list-bullet'}`;

  return (
    <Tag className={className}>
      {items.map((item, index) => (
        // eslint-disable-next-line react/no-array-index-key -- list position is the identity
        <li key={index} dangerouslySetInnerHTML={{ __html: sanitizeInline(String(item)) }} />
      ))}
    </Tag>
  );
}

function EmbedBlock({ data }) {
  const src = safeUrl(data.url || data.src || '');
  if (src === '') return null;
  const title = data.title || 'Embedded content';

  // Only https is framed. Anything else degrades to a link rather than being
  // dropped, so the author does not silently lose content.
  if (!/^https:\/\//i.test(src)) {
    return (
      <p className="scriptura-embed">
        <a href={src} rel="noopener noreferrer" target="_blank">
          {title}
        </a>
      </p>
    );
  }

  return (
    <div className="scriptura-embed">
      <iframe
        className="scriptura-embed-frame"
        src={src}
        title={title}
        loading="lazy"
        allowFullScreen
      />
    </div>
  );
}

function KeyTakeawayBlock({ data }) {
  const items = (Array.isArray(data.items) ? data.items : []).filter(
    (item) => item !== null && item !== undefined && String(item).trim() !== ''
  );
  const body = inlineContent(data);
  if (items.length === 0 && body === null) return null;

  return (
    <section className="scriptura-takeaway">
      <h3 className="scriptura-takeaway-title">{data.title || 'Key takeaways'}</h3>
      {body !== null ? <InlineInto tag="p" data={data} /> : null}
      {items.length > 0 ? (
        <ul className="scriptura-takeaway-list">
          {items.map((item, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={index} dangerouslySetInnerHTML={{ __html: sanitizeInline(String(item)) }} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const RENDERERS = {
  heading: HeadingBlock,
  paragraph: ParagraphBlock,
  image: ImageBlock,
  quote: QuoteBlock,
  table: TableBlock,
  faq_accordion: FaqBlock,
  cta_button: CtaBlock,
  list: ListBlock,
  embed: EmbedBlock,
  key_takeaway: KeyTakeawayBlock,
};

/** Identity fallback: a storage-relative path is left as-is unless resolved. */
const identity = (url) => url;

/**
 * Renders one block. Exported so the editor can render a single block in
 * isolation inside its canvas.
 */
export function RenderBlock({ block, resolveUrl = identity }) {
  if (!block || typeof block !== 'object') return null;

  // An unknown type degrades to "not shown" rather than throwing: a block type
  // added by a newer build must never blank out a whole article.
  const Renderer = RENDERERS[block.type];
  if (!Renderer) return null;

  const data = block.data && typeof block.data === 'object' ? block.data : {};
  return <Renderer data={data} resolveUrl={resolveUrl} />;
}

/**
 * Renders an ordered block list as an article.
 *
 * @param {object} props
 * @param {Array<{id?: string, type: string, data: object}>} props.blocks
 * @param {(url: string) => string} [props.resolveUrl] Maps a stored
 *   storage-relative image path to a displayable URL. The API already returns
 *   resolved URLs for the primary image, but blocks hold raw paths, so the
 *   editor and the public view pass their own resolver.
 * @param {string} [props.className] Extra classes on the wrapper.
 */
function BlockRenderer({ blocks, resolveUrl = identity, className = '' }) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;

  return (
    <div className={`prose-scriptura ${className}`.trim()}>
      {blocks.map((block, index) => (
        <RenderBlock
          // Blocks carry a stable id from the editor; index is only a fallback
          // for legacy rows written before ids existed.
          key={block?.id || `block-${index}`}
          block={block}
          resolveUrl={resolveUrl}
        />
      ))}
    </div>
  );
}

export default memo(BlockRenderer);
