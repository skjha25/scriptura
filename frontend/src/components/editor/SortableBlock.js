// frontend/src/components/editor/SortableBlock.js
/**
 * One block card on the canvas, wired to dnd-kit's sortable machinery.
 *
 * ---------------------------------------------------------------------------
 * TWO TRANSFORMS, TWO ELEMENTS
 * ---------------------------------------------------------------------------
 * dnd-kit positions a sorting item by writing `transform`, and Framer Motion animates
 * enter/exit by writing `transform`. Put both on one element and they overwrite each
 * other — the block either jumps during a drag or does not animate at all. So the
 * outer element is Framer Motion's (and is what AnimatePresence tracks) and the inner
 * element is dnd-kit's draggable node.
 *
 * For the same reason there is no `layout` prop: Framer's layout animation and
 * dnd-kit's sort transform describe the same movement, and running both makes the
 * card overshoot.
 *
 * `data-block-id` is on the dnd node deliberately — that is the element dnd-kit
 * measures, so it is also the element a test's rect stub has to be able to identify.
 */

import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import clsx from 'clsx';

import BlockToolbar from './BlockToolbar';
import BlockBody from './BlockBody';
import { blockTypeLabel } from './blockModel';

function SortableBlock({
  block,
  index,
  total,
  selected,
  readOnly,
  onSelect,
  onChange,
  onDuplicate,
  onDelete,
  insertBefore,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id, disabled: readOnly });

  const label = blockTypeLabel(block.type);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* The gap inserter for this position. It lives inside the presence wrapper so
          AnimatePresence still sees exactly one motion element per child — see the
          note in EditorCanvas. */}
      {insertBefore}
      <div
        ref={setNodeRef}
        data-block-id={block.id}
        role="group"
        aria-label={`${label} block, position ${index + 1} of ${total}`}
        // Computed values only — the transform comes from dnd-kit's measurement.
        style={{ transform: CSS.Translate.toString(transform), transition }}
        // Focus is the keyboard/AT path to selection and pointer-down the mouse one.
        // Neither is a click handler on a non-interactive element, so the card stays
        // a plain container and the real controls inside it keep their semantics.
        onFocusCapture={() => onSelect(block.id)}
        onPointerDownCapture={() => onSelect(block.id)}
        className={clsx(
          'rounded-xl border bg-panel transition-colors',
          selected ? 'border-accent/50 shadow-glow-sm' : 'border-hairline hover:border-hairline-strong',
          // Lifted out of the page while dragging, and translucent so the gap it will
          // land in stays visible underneath.
          isDragging && 'relative z-10 opacity-80 shadow-panel'
        )}
      >
        <BlockToolbar
          label={label}
          position={index + 1}
          total={total}
          selected={selected}
          readOnly={readOnly}
          dragHandleProps={{ attributes, listeners, setActivatorNodeRef }}
          onOpenSettings={() => onSelect(block.id)}
          onDuplicate={() => onDuplicate(block.id)}
          onDelete={() => onDelete(block.id)}
        />
        <div className="px-3 py-3">
          <BlockBody
            block={block}
            readOnly={readOnly}
            onChange={(data, mergeKey) => onChange(block.id, data, mergeKey)}
          />
        </div>
      </div>
    </motion.div>
  );
}

// Memoised because a keystroke in one block re-renders the whole canvas otherwise,
// and re-rendering nine untouched textareas per character is what makes a block
// editor feel laggy on a long article.
export default memo(SortableBlock);
