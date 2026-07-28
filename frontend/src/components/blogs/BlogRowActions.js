// frontend/src/components/blogs/BlogRowActions.js
/**
 * The actions available on one blog row, wrapped inside a 3-vertical-dots dropdown menu.
 */

import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';

import { BLOG_STATUS, GENERATION_IN_FLIGHT, GENERATION_STATUS } from '../../lib/constants';
import Button from '../ui/Button';

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
  const [isOpen, setIsOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
        setConfirmingDelete(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  if (blog.deleted_at) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
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
    <div ref={menuRef} className={`relative inline-block text-left ${className}`}>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={`More actions for ${blog.blog_title}`}
        aria-expanded={isOpen}
        className="px-2.5 py-1 text-lg font-bold leading-none text-ink-secondary hover:text-white hover:bg-white/[0.08] rounded-xl border border-white/10"
      >
        ⋮
      </Button>

      <div
        className={`absolute right-0 z-50 mt-1.5 w-44 origin-top-right rounded-2xl border border-white/[0.12] bg-[#141419]/95 p-1.5 shadow-2xl backdrop-blur-2xl space-y-1 transition-all duration-150 ${
          isOpen
            ? 'opacity-100 scale-100 pointer-events-auto visible'
            : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        <Button
          as={Link}
          to={`/blogs/${blog.id}/edit`}
          size="sm"
          variant="ghost"
          onClick={() => setIsOpen(false)}
          aria-label={`Edit ${blog.blog_title}`}
          className="w-full justify-start text-xs text-white hover:bg-white/[0.08] rounded-xl"
        >
          ✏ Edit
        </Button>

        <Button
          as={Link}
          to={`/blogs/${blog.id}`}
          size="sm"
          variant="ghost"
          onClick={() => setIsOpen(false)}
          aria-label={`View ${blog.blog_title}`}
          className="w-full justify-start text-xs text-white hover:bg-white/[0.08] rounded-xl"
        >
          👁 View
        </Button>

        {canPublish(blog) ? (
          <Button
            size="sm"
            variant="success"
            loading={busy}
            onClick={() => {
              setIsOpen(false);
              onPublish(blog);
            }}
            aria-label={`Publish ${blog.blog_title}`}
            className="w-full justify-start text-xs rounded-xl"
          >
            ✦ Publish
          </Button>
        ) : null}

        {confirmingDelete ? (
          <div className="flex items-center gap-1 pt-1 border-t border-white/10">
            <Button
              size="sm"
              variant="danger"
              loading={busy}
              onClick={() => {
                setConfirmingDelete(false);
                setIsOpen(false);
                onDelete(blog);
              }}
              aria-label={`Confirm deleting ${blog.blog_title}`}
              className="w-full justify-start text-xs rounded-xl"
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmingDelete(false)}
              className="text-xs px-2 rounded-xl"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="danger"
            onClick={() => setConfirmingDelete(true)}
            aria-label={`Delete ${blog.blog_title}`}
            className="w-full justify-start text-xs rounded-xl"
          >
            🗑 Delete
          </Button>
        )}
      </div>
    </div>
  );
}
