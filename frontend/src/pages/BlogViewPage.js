// frontend/src/pages/BlogViewPage.js
/**
 * Public-facing blog page.
 *
 * The point of this screen, beyond being useful: it is the SECOND consumer of
 * `<BlockRenderer>`. The editor's preview pane is the first. Both render the same
 * component from the same `content_blocks`, which is how the spec's requirement —
 * that the preview and the real page use one renderer — is actually satisfied
 * rather than merely intended.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';

import { blogsApi } from '../lib/api';
import { resolveImageUrl } from '../lib/media';
import BlockRenderer from '../components/BlockRenderer';
import Button from '../components/ui/Button';
import { StatusBadge, ErrorBanner, Skeleton, EmptyState, ScoreMeter } from '../components/ui/feedback';

export default function BlogViewPage() {
  const { id } = useParams();
  const [blog, setBlog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBlog(await blogsApi.get(id));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6" aria-busy="true">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-56 w-full" />
        <Skeleton rows={8} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorBanner error={error} onRetry={load} />
      </div>
    );
  }

  if (!blog) return null;

  const blocks = blog.content_blocks || [];
  const publishedDate = blog.publish_date
    ? new Date(`${blog.publish_date}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mx-auto max-w-3xl"
    >
      {/* Editor chrome, not part of the article. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/blogs" className="text-xs text-ink-muted hover:text-ink">
            ← All blogs
          </Link>
          <StatusBadge status={blog.blog_status} />
          {blog.category ? (
            <span className="text-xs text-ink-muted">{blog.category}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <div className="w-28">
            <ScoreMeter score={blog.seo_score} size="sm" />
          </div>
          <Button as={Link} to={`/blogs/${blog.id}/edit`} variant="secondary" size="sm">
            Edit
          </Button>
        </div>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold leading-tight text-ink sm:text-4xl">
          {blog.blog_title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          {blog.published_by ? <span>{blog.published_by}</span> : null}
          {publishedDate ? (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={blog.publish_date}>{publishedDate}</time>
            </>
          ) : null}
          {blog.word_count ? (
            <>
              <span aria-hidden="true">·</span>
              {/* ~200 wpm is the usual reading-speed assumption. */}
              <span>{Math.max(1, Math.round(blog.word_count / 200))} min read</span>
            </>
          ) : null}
        </div>

        {blog.blog_picture_url ? (
          <img
            src={blog.blog_picture_url}
            alt={blog.meta_title || blog.blog_title}
            className="mt-6 aspect-[16/9] w-full rounded-xl border border-hairline object-cover"
            loading="lazy"
          />
        ) : null}
      </header>

      {blocks.length === 0 ? (
        <EmptyState
          icon="✧"
          title="No content yet"
          message={
            blog.generation_status === 'failed'
              ? 'The last generation run failed. Open the wizard to retry it.'
              : 'This article has no content blocks. Open the editor to add some.'
          }
          action={
            <Button as={Link} to={`/blogs/${blog.id}/edit`} variant="primary">
              Open editor
            </Button>
          }
        />
      ) : (
        <BlockRenderer blocks={blocks} resolveUrl={resolveImageUrl} />
      )}

      {blog.tags?.length > 0 ? (
        <footer className="mt-10 flex flex-wrap gap-2 border-t border-hairline pt-6">
          {blog.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-hairline bg-panel-raised px-2 py-0.5 text-xs text-ink-secondary"
            >
              #{tag}
            </span>
          ))}
        </footer>
      ) : null}
    </motion.article>
  );
}
