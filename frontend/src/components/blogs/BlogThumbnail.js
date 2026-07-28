// frontend/src/components/blogs/BlogThumbnail.js
/**
 * Article thumbnail, with a typed fallback.
 *
 * Two reasons this is its own component rather than an inline `<img>`:
 *
 *   - The path needs resolving. The API already hands back `blog_picture_url`, but
 *     a row saved before the resolver existed may only carry the raw storage path,
 *     so both are run through `resolveImageUrl`.
 *   - A missing image must still occupy its space. A conditional `<img>` that
 *     simply disappears makes the grid ragged and the table rows jump, so the
 *     fallback is a placeholder of identical dimensions.
 *
 * `alt` is empty by design: the title sits immediately beside it in every use, and
 * a screen reader announcing the title twice is worse than not announcing the
 * decorative image at all.
 */

import clsx from 'clsx';

import { resolveImageUrl } from '../../lib/media';

export default function BlogThumbnail({ blog, className = '' }) {
  const src = resolveImageUrl(blog.blog_picture_url || blog.blog_picture);

  if (!src) {
    return (
      <div
        aria-hidden="true"
        className={clsx(
          'grid shrink-0 place-items-center rounded-lg border border-hairline bg-panel-sunken text-accent/40',
          className
        )}
      >
        ✧
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={clsx('shrink-0 rounded-lg border border-hairline object-cover', className)}
    />
  );
}
