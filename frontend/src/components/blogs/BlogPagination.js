// frontend/src/components/blogs/BlogPagination.js
/**
 * Pagination for the blog list.
 *
 * Prev/next plus a position readout rather than a strip of numbered pages. The
 * list is sorted and filtered, so "page 5" is not a stable address for anything —
 * jumping straight to it is not a real user need, whereas knowing where you are
 * and how much is left is.
 *
 * The readout is a polite live region: after a page change the focus has not moved,
 * so without an announcement a screen-reader user gets a silently rewritten table.
 */

import Button from '../ui/Button';
import { formatCount } from '../charts/chartTheme';

export default function BlogPagination({ pagination, onPageChange, busy = false }) {
  if (!pagination) return null;

  const { page, total, total_pages: totalPages, has_next: hasNext, has_prev: hasPrev } = pagination;

  // One page of results needs no controls, but the total is still worth stating.
  if (totalPages <= 1) {
    return (
      <p className="text-xs text-ink-muted" aria-live="polite">
        {`${formatCount(total)} ${total === 1 ? 'article' : 'articles'}`}
      </p>
    );
  }

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4"
    >
      <p className="text-xs text-ink-muted" aria-live="polite">
        {`Page ${page} of ${totalPages} · ${formatCount(total)} articles`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!hasPrev || busy}
          onClick={() => onPageChange(page - 1)}
        >
          <span aria-hidden="true">←</span>
          Previous
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!hasNext || busy}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <span aria-hidden="true">→</span>
        </Button>
      </div>
    </nav>
  );
}
