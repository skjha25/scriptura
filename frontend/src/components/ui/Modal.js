// frontend/src/components/ui/Modal.js
/**
 * A genuinely reusable modal — extracted from the one-off pattern
 * ClusterDetailPage.js's `AutoScheduleModal` already used inline (fixed
 * backdrop + centered card), so every new P6 flow that needs a dialog (Add
 * Fact Source here, block regeneration in a later phase) shares one
 * component instead of a fourth copy-paste. Backdrop click and Escape both
 * close; the primary action lives in `footer`, not baked in, so callers
 * keep full control over labels/loading state.
 */

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export default function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-void/80 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? 'modal-title' : undefined}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={clsx('relative flex max-h-[85vh] w-full flex-col rounded-2xl border border-hairline bg-panel shadow-panel', SIZES[size] || SIZES.md)}
          >
            {title || subtitle ? (
              <div className="shrink-0 border-b border-hairline px-5 py-4">
                {title ? (
                  <h2 id="modal-title" className="text-base font-semibold text-ink">
                    {title}
                  </h2>
                ) : null}
                {subtitle ? <p className="mt-1 text-sm text-ink-muted">{subtitle}</p> : null}
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer ? <div className="flex shrink-0 justify-end gap-2 border-t border-hairline px-5 py-3">{footer}</div> : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
