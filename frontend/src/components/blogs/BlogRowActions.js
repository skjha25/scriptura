// frontend/src/components/blogs/BlogRowActions.js
/**
 * The actions available on one blog row, shared by the grid and the table.
 *
 * ---------------------------------------------------------------------------
 * THREE DECISIONS
 * ---------------------------------------------------------------------------
 * 1. DELETE IS TWO-STEP, IN PLACE. Deleting is soft, but it still removes a row
 *    from everyone's list, so it should not be one stray click on a touch target
 *    the size of a fingernail. An inline "Confirm?" is used rather than
 *    `window.confirm` because a native dialog cannot be styled, blocks the whole
 *    tab, and is unavailable in jsdom — so the safeguard would be the one thing
 *    the tests could not cover.
 *
 * 2. PUBLISH IS HIDDEN WHEN THE API WOULD REFUSE IT. `POST /blogs/{id}/publish`
 *    returns 422 for an article whose last generation failed or is still running,
 *    because publishing then would put a broken page on the live site. Offering a
 *    button that is guaranteed to error is worse than not offering it.
 *
 * 3. RESTORE IS ADMIN-ONLY, matching the endpoint's own 403.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { BLOG_STATUS, GENERATION_IN_FLIGHT, GENERATION_STATUS } from '../../lib/constants';
import Button from '../ui/Button';

/** Whether the publish endpoint would accept this article right now. */
function canPublish(blog) {
  if (blog.blog_status === BLOG_STATUS.PUBLISHED) return false;
  if (blog.generation_status === GENERATION_STATUS.FAILED) return false;
  return !GENERATION_IN_FLIGHT.includes(blog.generation_status);
}

export default function BlogRowActions({
  blog,
  busy = false,
  isAdmin = false,
  onPublish,
  onDelete,
  onRestore,
  className = '',
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // A soft-deleted row has nothing to edit or publish; restoring it is the only
  // move, and only an admin has it.
  if (blog.deleted_at) {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        <span className="text-xs text-ink-faint">In trash</span>
        {isAdmin ? (
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={() => onRestore(blog)}
            aria-label={`Restore ${blog.blog_title}`}
          >
            Restore
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <Button
        as={Link}
        to={`/blogs/${blog.id}/edit`}
        size="sm"
        variant="secondary"
        aria-label={`Edit ${blog.blog_title}`}
      >
        Edit
      </Button>
      <Button
        as={Link}
        to={`/blogs/${blog.id}`}
        size="sm"
        variant="ghost"
        aria-label={`View ${blog.blog_title}`}
      >
        View
      </Button>

      {canPublish(blog) ? (
        <Button
          size="sm"
          variant="success"
          loading={busy}
          onClick={() => onPublish(blog)}
          aria-label={`Publish ${blog.blog_title}`}
        >
          Publish
        </Button>
      ) : null}

      {confirmingDelete ? (
        <>
          <Button
            size="sm"
            variant="danger"
            loading={busy}
            onClick={() => {
              setConfirmingDelete(false);
              onDelete(blog);
            }}
            aria-label={`Confirm deleting ${blog.blog_title}`}
          >
            Confirm
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirmingDelete(true)}
          aria-label={`Delete ${blog.blog_title}`}
        >
          Delete
        </Button>
      )}
    </div>
  );
}
