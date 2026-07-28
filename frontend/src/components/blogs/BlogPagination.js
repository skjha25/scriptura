// frontend/src/components/blogs/BlogPagination.js
/**
 * Pagination for the blog list.
 *
 * Prev/next plus a position readout and rows-per-page limit selector.
 */

import Button from '../ui/Button';
import { formatCount } from '../charts/chartTheme';

export default function BlogPagination({ pagination, onPageChange, limit = 20, onLimitChange, busy = false }) {
  if (!pagination) return null;

  const { page, total, total_pages: totalPages, has_next: hasNext, has_prev: hasPrev } = pagination;

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-ink-muted" aria-live="polite">
          {totalPages <= 1
            ? `${formatCount(total)} ${total === 1 ? 'article' : 'articles'}`
            : `Page ${page} of ${totalPages} · ${formatCount(total)} articles`}
        </p>
        {onLimitChange ? (
          <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
            <span>Show:</span>
            <select
              aria-label="Items per page"
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              className="bg-panel-sunken text-ink border border-hairline rounded px-2 py-1 text-xs focus:outline-none focus:border-accent cursor-pointer"
            >
              <option value={10}>10</option>
              <option value={20}>20 (Default)</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        ) : null}
      </div>

      {totalPages > 1 && (
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
      )}
    </nav>
  );
}
