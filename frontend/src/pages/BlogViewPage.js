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
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

import { blogsApi, generateApi } from '../lib/api';
import { resolveImageUrl } from '../lib/media';
import BlockRenderer from '../components/BlockRenderer';
import Button from '../components/ui/Button';
import { StatusBadge, ErrorBanner, Skeleton, EmptyState, ScoreMeter } from '../components/ui/feedback';

export default function BlogViewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [blog, setBlog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(null);

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

  async function handleRetryGeneration() {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      // Use the stored generation_config from the blog, or sensible defaults
      const cfg = blog.generation_config && Object.keys(blog.generation_config).length > 0
        ? { ...blog.generation_config }
        : {
            topic: blog.topic || blog.blog_title,
            title: blog.blog_title,
            keyword: blog.seo_keywords || '',
            secondary_keywords: blog.secondary_keywords || [],
            article_type: blog.article_type || 'general',
            target_word_count: 2000,
            language: blog.language || 'en',
            target_country: blog.target_country || 'India',
            readability_level: blog.readability_level || '8th_grade',
            tone_of_voice: blog.tone_of_voice || 'informative',
            include_images: blog.include_images ?? true,
            image_count: blog.image_count || 2,
            image_style: blog.image_style || 'illustration',
            logo_overlay: blog.logo_overlay ?? true,
            logo_position: blog.logo_position || 'bottom_right',
            internal_linking: blog.internal_linking ?? true,
            external_web_grounding: blog.external_web_grounding ?? false,
            ai_content_cleaning: blog.ai_content_cleaning ?? true,
            optimization_profile: blog.optimization_profile || 'balanced',
            seo_structure_config: blog.seo_structure_config || {
              h1: true, h2: true, h3: true, faq: true,
              tables: false, key_takeaways: true, quotes: false,
              lists: true, emphasis: true,
            },
            brand_voice: { source_type: 'none' },
          };

      // Remove internal _run metadata if present
      delete cfg._run;

      await generateApi.article({ blog_id: Number(id), config: cfg });
      // Navigate to wizard Step 6 style polling or just reload after a delay
      navigate(`/blogs/${id}/edit`);
    } catch (err) {
      setRetryError(err.message || 'Failed to start generation. Please try again.');
    } finally {
      setRetrying(false);
    }
  }

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
    ? new Date(blog.publish_date.includes('T') ? blog.publish_date : `${blog.publish_date}T00:00:00Z`).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
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
        <h1 className="font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">
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
            className="mt-6 w-full rounded-xl border border-hairline"
            loading="lazy"
          />
        ) : null}
      </header>

      {blocks.length === 0 ? (
        <div className="space-y-4">
          {blog.generation_status === 'failed' ? (
            <div className="rounded-xl border border-status-critical/30 bg-status-critical/5 p-6 text-center space-y-4">
              <div className="text-3xl">❌</div>
              <h3 className="text-lg font-semibold text-ink">Generation Failed</h3>
              {blog.generation_error ? (
                <p className="text-sm text-ink-muted max-w-md mx-auto">
                  {blog.generation_error}
                </p>
              ) : null}
              {retryError ? (
                <p className="text-xs text-status-critical">{retryError}</p>
              ) : null}
              <div className="flex items-center justify-center gap-3 pt-2">
                <Button
                  variant="primary"
                  onClick={handleRetryGeneration}
                  loading={retrying}
                >
                  {retrying ? 'Starting...' : '🔄 Retry Generation'}
                </Button>
                <Button as={Link} to={`/blogs/${blog.id}/edit`} variant="secondary" size="sm">
                  Open Editor
                </Button>
              </div>
            </div>
          ) : (
            <EmptyState
              icon="✧"
              title="No content yet"
              message="This article has no content blocks. Open the editor to add some."
              action={
                <Button as={Link} to={`/blogs/${blog.id}/edit`} variant="primary">
                  Open editor
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <>
          {/* Show retry banner at top if generation failed but there ARE old blocks */}
          {blog.generation_status === 'failed' ? (
            <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-status-critical/30 bg-status-critical/5 px-4 py-3">
              <span className="text-sm text-ink">
                ⚠️ Last generation failed{blog.generation_error ? `: ${blog.generation_error.slice(0, 100)}` : ''}
              </span>
              {retryError ? <span className="text-xs text-status-critical">{retryError}</span> : null}
              <Button
                variant="primary"
                size="sm"
                onClick={handleRetryGeneration}
                loading={retrying}
                className="ml-auto"
              >
                {retrying ? 'Starting...' : '🔄 Retry'}
              </Button>
            </div>
          ) : null}
          <BlockRenderer blocks={blocks} resolveUrl={resolveImageUrl} />
        </>
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
