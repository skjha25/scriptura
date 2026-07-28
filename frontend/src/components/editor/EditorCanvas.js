// frontend/src/components/editor/EditorCanvas.js
/**
 * The block canvas: ordering, insertion points, and the drag-and-drop context.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SENSOR SET LOOKS LIKE THIS
 * ---------------------------------------------------------------------------
 * PointerSensor with a 4px activation distance: without a distance constraint, a
 * pointer-down on the handle that moves a pixel while the button is pressed registers
 * as a drag, so an ordinary click on the handle becomes a no-op drag. Four pixels is
 * below the threshold of an intentional gesture and above hand tremor.
 *
 * KeyboardSensor with `sortableKeyboardCoordinates`: this is not a nicety. Reordering
 * is the primary operation on this screen, and a pointer-only implementation makes the
 * screen unusable without a mouse. It is also the only path a test can drive, because
 * jsdom has no layout and therefore no real pointer drag.
 *
 * `restrictToVerticalAxis` only. `restrictToParentElement` was considered and dropped:
 * it clamps movement against the measured container, so a container with no measured
 * height clamps every movement to zero.
 *
 * ---------------------------------------------------------------------------
 * ANNOUNCEMENTS
 * ---------------------------------------------------------------------------
 * dnd-kit's defaults say "Draggable item 3 was moved" — a position with no subject.
 * The overrides below name the block type and both positions ("Heading block moved
 * from position 2 to 4"), which is the only version that tells a screen-reader user
 * what actually happened.
 *
 * ---------------------------------------------------------------------------
 * WHY THE GAP INSERTER IS PASSED INTO THE BLOCK
 * ---------------------------------------------------------------------------
 * AnimatePresence tracks its *direct* children, so each block must be one. Interleaving
 * the inserters as siblings would mean wrapping each pair in a fragment, and the
 * presence context would then cover two motion elements instead of one — which is
 * exactly how exit animations end up never completing. Handing the inserter to the
 * block as `insertBefore` keeps one motion element per presence child.
 */

import { useCallback, useMemo, useRef } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { AnimatePresence } from 'framer-motion';

import SortableBlock from './SortableBlock';
import AddBlockMenu from './AddBlockMenu';
import { blockTypeLabel } from './blockModel';
import { EmptyState } from '../ui/feedback';

/** Read out once when a drag handle receives focus. */
const screenReaderInstructions = {
  draggable:
    'To reorder this block, press space or enter to pick it up, use the up and down ' +
    'arrow keys to choose a new position, then press space or enter to drop it. ' +
    'Press escape to cancel.',
};

export default function EditorCanvas({
  blocks,
  selectedId,
  readOnly,
  onSelect,
  onChangeBlock,
  onDuplicate,
  onDelete,
  onInsert,
  onReorder,
}) {
  /** Position the active block started at, so the end announcement can name both. */
  const fromIndexRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const ids = useMemo(() => blocks.map((block) => block.id), [blocks]);

  const describe = useCallback(
    (id) => {
      const block = blocks.find((entry) => entry.id === id);
      return block ? `${blockTypeLabel(block.type)} block` : 'Block';
    },
    [blocks]
  );

  const announcements = useMemo(
    () => ({
      onDragStart: ({ active }) => {
        const index = blocks.findIndex((block) => block.id === active.id);
        return `Picked up ${describe(active.id)} from position ${index + 1} of ${blocks.length}.`;
      },
      onDragOver: ({ active, over }) => {
        if (!over) return `${describe(active.id)} is no longer over a drop position.`;
        const index = blocks.findIndex((block) => block.id === over.id);
        return `${describe(active.id)} is over position ${index + 1} of ${blocks.length}.`;
      },
      onDragEnd: ({ active, over }) => {
        const from = (fromIndexRef.current ?? 0) + 1;
        if (!over) return `${describe(active.id)} was dropped at position ${from}.`;
        const to = blocks.findIndex((block) => block.id === over.id) + 1;
        if (from === to) return `${describe(active.id)} stayed at position ${from}.`;
        return `${describe(active.id)} moved from position ${from} to ${to}.`;
      },
      onDragCancel: ({ active }) =>
        `Move cancelled. ${describe(active.id)} returned to position ${
          (fromIndexRef.current ?? 0) + 1
        }.`,
    }),
    [blocks, describe]
  );

  function handleDragStart({ active }) {
    fromIndexRef.current = blocks.findIndex((block) => block.id === active.id);
  }

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const from = blocks.findIndex((block) => block.id === active.id);
    const to = blocks.findIndex((block) => block.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(blocks, from, to));
  }

  if (blocks.length === 0) {
    return (
      <div className="rounded-xl border border-hairline bg-panel">
        <EmptyState
          icon="✧"
          title="No blocks yet"
          message="Add a heading or a paragraph to start the article, or run the wizard to generate a draft."
          action={
            <AddBlockMenu
              position={0}
              onInsert={onInsert}
              disabled={readOnly}
              variant="primary"
              triggerLabel="Add block"
            />
          }
        />
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      accessibility={{ announcements, screenReaderInstructions }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="space-y-1">
          <AnimatePresence initial={false}>
            {blocks.map((block, index) => (
              <SortableBlock
                key={block.id}
                block={block}
                index={index}
                total={blocks.length}
                selected={block.id === selectedId}
                readOnly={readOnly}
                onSelect={onSelect}
                onChange={onChangeBlock}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                insertBefore={
                  <AddBlockMenu position={index} onInsert={onInsert} disabled={readOnly} />
                }
              />
            ))}
          </AnimatePresence>
          <AddBlockMenu position={blocks.length} onInsert={onInsert} disabled={readOnly} />
        </div>
      </SortableContext>
    </DndContext>
  );
}
