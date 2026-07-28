// frontend/src/components/blogs/BlogTable.js
/**
 * The blog list as a real table.
 *
 * ---------------------------------------------------------------------------
 * WHY A REAL TABLE
 * ---------------------------------------------------------------------------
 * This is the accessible view of the list, so it is a `<table>` with a `<caption>`
 * and `scope`d headers — not a grid of divs with `role="row"` sprinkled on. A
 * genuine table gives row/column announcement, header association and table
 * navigation for free; the div version has to reimplement all three and usually
 * only manages the first.
 *
 * `aria-sort` mirrors the toolbar's sort control. The headers themselves are not
 * clickable: sorting already has one control, and two ways to set the same value
 * is how a UI ends up with a header saying "Views ↑" while the toolbar says
 * "Date created".
 *
 * The horizontal scroll lives on the wrapper, never on the page. At 375px the
 * table keeps its full width and scrolls inside its own box, which is why
 * `min-w` sits on the table and `overflow-x-auto` on the div around it.
 */

import { Link } from 'react-router-dom';

import { StatusBadge, GenerationBadge, ScoreMeter } from '../ui/feedback';
import { formatCount } from '../charts/chartTheme';
import BlogThumbnail from './BlogThumbnail';
import BlogRowActions from './BlogRowActions';

const HEAD_CLASS =
  'whitespace-nowrap border-b border-hairline bg-panel-raised px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted';

/** Columns, paired with the sort key they represent so `aria-sort` can be derived. */
const COLUMNS = [
  { key: 'article', label: 'Article', sortKey: 'blog_title' },
  { key: 'status', label: 'Status' },
  { key: 'generation', label: 'Generation' },
  { key: 'seo', label: 'SEO score', sortKey: 'seo_score' },
  { key: 'words', label: 'Words', sortKey: 'word_count', align: 'right' },
  { key: 'views', label: 'Views', sortKey: 'total_views', align: 'right' },
  { key: 'published', label: 'Published', sortKey: 'publish_date' },
  { key: 'actions', label: 'Actions' },
];

/** 'YYYY-MM-DD' → '14 Jul 2026', in UTC so the date does not drift by a day. */
function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function BlogTable({ blogs, filters, busyId, isAdmin, onPublish, onDelete, onRestore }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-hairline bg-panel shadow-panel">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <caption className="sr-only">
          {`Blog articles, ${blogs.length} shown, sorted by ${filters.sort} ${
            filters.order === 'ASC' ? 'ascending' : 'descending'
          }.`}
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  column.sortKey && filters.sort === column.sortKey
                    ? filters.order === 'ASC'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
                className={`${HEAD_CLASS}${column.align === 'right' ? ' text-right' : ''}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blogs.map((blog) => (
            <tr key={blog.id} className="border-b border-hairline/60 last:border-0 hover:bg-panel-raised/50">
              {/* The article cell is the row header: it is what identifies the row. */}
              <th scope="row" className="px-4 py-3 text-left font-normal">
                <div className="flex items-center gap-3">
                  <BlogThumbnail blog={blog} className="h-10 w-16" />
                  <span className="min-w-0">
                    <Link
                      to={`/blogs/${blog.id}`}
                      className="block max-w-[22rem] truncate font-medium text-ink hover:text-accent-bright"
                    >
                      {blog.blog_title}
                    </Link>
                    <span className="mt-0.5 block text-[11px] text-ink-muted">
                      {blog.category || 'Uncategorised'}
                    </span>
                  </span>
                </div>
              </th>
              <td className="whitespace-nowrap px-4 py-3">
                <StatusBadge status={blog.blog_status} />
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <GenerationBadge status={blog.generation_status} />
              </td>
              <td className="px-4 py-3">
                <div className="w-24">
                  <ScoreMeter score={blog.seo_score} size="sm" />
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular text-ink-secondary">
                {formatCount(blog.word_count)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular text-ink-secondary">
                {formatCount(blog.total_views)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">
                {formatDate(blog.publish_date)}
              </td>
              <td className="px-4 py-3">
                <BlogRowActions
                  blog={blog}
                  busy={busyId === blog.id}
                  isAdmin={isAdmin}
                  onPublish={onPublish}
                  onDelete={onDelete}
                  onRestore={onRestore}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
