// frontend/src/components/editor/PreviewPane.js
/**
 * The live preview.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS ALMOST NOTHING HERE
 * ---------------------------------------------------------------------------
 * That is the point. The preview renders `<BlockRenderer>` — the same component
 * BlogViewPage renders for the public article, from the same `content_blocks` — so
 * preview and published output cannot disagree. Any markup written here instead would
 * be a second renderer, and a second renderer is a promise to drift.
 *
 * It renders from the editor's live blocks rather than from the saved `blog_content`
 * HTML, so it reflects the current keystroke rather than the last save. The server
 * regenerates that HTML from the same blocks, which is what makes the two equivalent.
 *
 * `resolveImageUrl` is passed because blocks hold storage-relative image paths, not
 * URLs — BlogViewPage passes the identical resolver.
 */

import BlockRenderer from '../BlockRenderer';
import { resolveImageUrl } from '../../lib/media';

export default function PreviewPane({ blocks, title }) {
  return (
    <section
      aria-label="Live preview"
      className="min-w-0 rounded-xl border border-hairline bg-panel"
    >
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Live preview</h2>
        <p className="text-[11px] text-ink-muted">Same renderer as the public page</p>
      </header>

      {/* `overflow-x-auto` on the body, not on the page: a wide table inside the
          article scrolls in place instead of widening the whole editor. */}
      <div className="overflow-x-auto px-4 py-5">
        {title ? (
          <h1 className="mb-6 text-2xl font-semibold leading-tight text-ink">{title}</h1>
        ) : null}
        {blocks.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing to preview yet. Blocks appear here as you add them.
          </p>
        ) : (
          <BlockRenderer blocks={blocks} resolveUrl={resolveImageUrl} />
        )}
      </div>
    </section>
  );
}
