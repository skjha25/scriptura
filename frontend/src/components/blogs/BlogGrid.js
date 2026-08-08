// frontend/src/components/blogs/BlogGrid.js
/**
 * The blog list as a card grid.
 *
 * The default view because the thumbnail matters here: these are articles with
 * hero images, and a text-only row makes them hard to tell apart at a glance. The
 * table view exists for when the numbers are the point.
 *
 * It is a `<ul>` of `<li>`s rather than a mesh of divs, so the count is announced
 * and each card is one list item. `AnimatePresence` plus `layout` means a row
 * removed by a delete slides the rest into place instead of snapping — the motion
 * carries the information that something left.
 */

import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

import { ARTICLE_TYPE_LABELS } from '../../lib/constants';
import { Card, StatusBadge, GenerationBadge, ScoreMeter } from '../ui/feedback';
import { formatCount } from '../charts/chartTheme';
import BlogThumbnail from './BlogThumbnail';
import BlogRowActions from './BlogRowActions';

function formatDate(value) {
  if (!value) return null;
  const str = String(value);
  const date = new Date(str.includes('T') ? str : `${str.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function BlogGrid({ blogs, busyId, isAdmin, onPublish, onDelete, onRestore }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <AnimatePresence initial={false}>
        {blogs.map((blog) => {
          const published = formatDate(blog.publish_date);

          return (
            <motion.li
              key={blog.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="min-w-0"
            >
              <Card className="flex h-full flex-col overflow-hidden animate-lift">
                <BlogThumbnail blog={blog} className="aspect-[16/9] w-full rounded-none border-0 border-b" />

                <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
                  <div className="min-w-0">
                    <Link
                      to={`/blogs/${blog.id}`}
                      className="line-clamp-2 text-sm font-semibold leading-snug text-ink hover:text-accent-bright"
                    >
                      {blog.blog_title}
                    </Link>
                    <p className="mt-1 truncate text-[11px] text-ink-muted">
                      {blog.category || 'Uncategorised'}
                      {blog.article_type
                        ? ` · ${ARTICLE_TYPE_LABELS[blog.article_type] || blog.article_type}`
                        : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={blog.blog_status} />
                    <GenerationBadge status={blog.generation_status} />
                  </div>

                  <ScoreMeter score={blog.seo_score} size="sm" />

                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted">
                    <div className="flex gap-1">
                      <dt>Words</dt>
                      <dd className="tabular text-ink-secondary">{formatCount(blog.word_count)}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>Views</dt>
                      <dd className="tabular text-ink-secondary">{formatCount(blog.total_views)}</dd>
                    </div>
                    {published ? (
                      <div className="flex gap-1">
                        {/* "Published on" rather than "Published": the status chip
                            above already says "Published", and two identical words
                            meaning different things in one card is a small trap
                            for anyone reading it aloud. */}
                        <dt>Published on</dt>
                        <dd className="text-ink-secondary">{published}</dd>
                      </div>
                    ) : null}
                  </dl>

                  {/* mt-auto pins the actions to the bottom so they line up across
                      cards whose titles wrap to different heights. */}
                  <BlogRowActions
                    blog={blog}
                    busy={busyId === blog.id}
                    isAdmin={isAdmin}
                    onPublish={onPublish}
                    onDelete={onDelete}
                    onRestore={onRestore}
                    className="mt-auto border-t border-hairline pt-3"
                  />
                </div>
              </Card>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
