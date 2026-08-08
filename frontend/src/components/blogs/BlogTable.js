// frontend/src/components/blogs/BlogTable.js
/**
 * The blog list as an accessible, high-end real table.
 */

import { Link } from 'react-router-dom';

import { StatusBadge, GenerationBadge, ScoreMeter } from '../ui/feedback';
import { formatCount } from '../charts/chartTheme';
import BlogThumbnail from './BlogThumbnail';
import BlogRowActions from './BlogRowActions';

const HEAD_CLASS =
  'whitespace-nowrap border-b border-hairline bg-panel-raised/90 backdrop-blur-sm px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted';

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

function formatDate(value) {
  if (!value) return '—';
  const str = String(value);
  const date = new Date(str.includes('T') ? str : `${str.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function BlogTable({ blogs, filters, busyId, isAdmin, onPublish, onDelete, onRestore }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-hairline bg-panel shadow-panel">
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
        <tbody className="divide-y divide-hairline/40">
          {blogs.map((blog) => (
            <tr
              key={blog.id}
              className="group border-b border-hairline/40 last:border-0 transition-colors duration-150 hover:bg-panel-raised/60"
            >
              {/* The article cell is the row header: it identifies the row. */}
              <th scope="row" className="px-4 py-3.5 text-left font-normal">
                <div className="flex items-center gap-3">
                  <BlogThumbnail blog={blog} className="h-10 w-16 transition-border group-hover:border-brand/40" />
                  <span className="min-w-0">
                    <Link
                      to={`/blogs/${blog.id}`}
                      className="block max-w-[22rem] truncate font-medium text-ink transition-colors hover:text-brand-light"
                    >
                      {blog.blog_title}
                    </Link>
                    <span className="mt-1 inline-flex items-center rounded border border-hairline bg-panel-sunken px-1.5 py-0.5 text-[10px] font-medium text-ink-muted transition-colors group-hover:text-ink-secondary">
                      {blog.category || 'Uncategorised'}
                    </span>
                  </span>
                </div>
              </th>
              <td className="whitespace-nowrap px-4 py-3.5">
                <StatusBadge status={blog.blog_status} />
              </td>
              <td className="whitespace-nowrap px-4 py-3.5">
                <GenerationBadge status={blog.generation_status} />
              </td>
              <td className="px-4 py-3.5">
                <div className="w-24">
                  <ScoreMeter score={blog.seo_score} size="sm" />
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-3.5 text-right tabular text-xs text-ink-secondary">
                {formatCount(blog.word_count)}
              </td>
              <td className="whitespace-nowrap px-4 py-3.5 text-right tabular text-xs text-ink-secondary">
                {formatCount(blog.total_views)}
              </td>
              <td className="whitespace-nowrap px-4 py-3.5 text-xs text-ink-secondary">
                {formatDate(blog.publish_date)}
              </td>
              <td className="px-4 py-3.5">
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
