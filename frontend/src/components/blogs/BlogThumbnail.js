// frontend/src/components/blogs/BlogThumbnail.js
/**
 * Article thumbnail, with a clean vector SVG fallback placeholder.
 * Handles missing images as well as broken/unresolved image URLs via onError.
 */

import { useState } from 'react';
import clsx from 'clsx';

import { resolveImageUrl } from '../../lib/media';

export default function BlogThumbnail({ blog, className = '' }) {
  const [imgError, setImgError] = useState(false);
  const rawUrl = blog?.blog_picture_url || blog?.blog_picture;
  const src = resolveImageUrl(rawUrl);

  if (!src || imgError) {
    return (
      <div
        aria-hidden="true"
        className={clsx(
          'grid shrink-0 place-items-center rounded-lg border border-hairline bg-panel-sunken text-ink-muted select-none',
          className
        )}
      >
        <svg className="w-5 h-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setImgError(true)}
      className={clsx('shrink-0 rounded-lg border border-hairline object-cover', className)}
    />
  );
}
