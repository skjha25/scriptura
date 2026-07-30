// frontend/src/components/editor/BlockSettingsPanel.js
/**
 * Settings for the selected block.
 *
 * ---------------------------------------------------------------------------
 * ONE INSTANCE, TWO SHAPES
 * ---------------------------------------------------------------------------
 * Below `lg` this is a bottom sheet over the canvas; from `lg` up it is a column beside
 * it. Both are the same mounted element, switched by `fixed … lg:static`, and that is
 * deliberate: rendering a mobile copy and a desktop copy would duplicate every field,
 * which means duplicate label/control id pairs, two elements answering to the same
 * accessible name, and two sources of truth for whichever one has focus.
 *
 * A `position: fixed` grid child is out of flow, so below `lg` it occupies no column
 * and the canvas keeps the full width. From `lg` up `static` returns it to its cell.
 *
 * ---------------------------------------------------------------------------
 * ACCESSIBILITY
 * ---------------------------------------------------------------------------
 * It is a labelled `region`, not a dialog, because on desktop it genuinely is not modal
 * — the canvas beside it stays live and editable, and claiming `aria-modal` would lie
 * to a screen reader about where the user can go. Below `lg` it covers the canvas, so
 * there Escape closes it and a backdrop absorbs stray taps; focus is not trapped,
 * because trapping focus in a non-modal panel is what makes keyboard users stuck.
 */

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import Button from '../ui/Button';
import SETTINGS_PANELS from './settings';
import { blockTypeIcon, blockTypeLabel } from './blockModel';

export default function BlockSettingsPanel({
  block,
  index,
  total,
  readOnly,
  onChange,
  onClose,
  onDuplicate,
  onDelete,
}) {
  // Escape closes. Registered only while open so it does not compete with the insert
  // menu's own Escape handling.
  useEffect(() => {
    if (!block) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [block, onClose]);

  const label = block ? blockTypeLabel(block.type) : '';
  const Settings = block ? SETTINGS_PANELS[block.type] : null;

  return (
    <AnimatePresence>
      {block && (
        <motion.div
          key="block-settings-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          onPointerDown={onClose}
          onTap={onClose}
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-black/60 cursor-pointer lg:hidden"
        />
      )}

      {block && (
        <motion.aside
          key="block-settings-aside"
          role="region"
          aria-label={`Settings for ${label} block, position ${index + 1} of ${total}`}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className={
            'fixed inset-x-0 bottom-0 z-40 max-h-[75vh] overflow-y-auto rounded-t-2xl ' +
            'border-t border-hairline bg-panel p-4 shadow-panel ' +
            'lg:static lg:z-auto lg:max-h-none lg:overflow-visible lg:rounded-xl lg:border ' +
            'lg:p-0 lg:shadow-none'
          }
        >
            <div className="lg:sticky lg:top-6">
              <div className="mb-4 flex items-start justify-between gap-3 lg:border-b lg:border-hairline lg:p-4">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <span aria-hidden="true" className="text-accent">
                      {blockTypeIcon(block.type)}
                    </span>
                    {label}
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    Block {index + 1} of {total}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close block settings"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-hairline text-ink-muted transition-colors hover:text-ink"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>

              <div className="lg:px-4 lg:pb-4">
                {Settings ? (
                  <Settings block={block} readOnly={readOnly} onChange={onChange} />
                ) : (
                  <p className="text-xs text-ink-muted">
                    This block has no settings — edit it directly on the canvas.
                  </p>
                )}

                <div className="mt-5 flex gap-2 border-t border-hairline pt-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    disabled={readOnly}
                    onClick={() => onDuplicate(block.id)}
                  >
                    Duplicate
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    className="flex-1"
                    disabled={readOnly}
                    onClick={() => onDelete(block.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
  );
}
