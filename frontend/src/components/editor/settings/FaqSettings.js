// frontend/src/components/editor/settings/FaqSettings.js
/**
 * FAQ block settings: how many question/answer pairs.
 *
 * The questions and answers are typed on the canvas, where they read as an accordion.
 * The count lives here for the same reason the table's does — adding an item changes
 * the block's shape rather than its words, and the panel can say how many there are.
 *
 * Removal takes the last item rather than a chosen one: choosing which to remove is
 * what the × on each item in the canvas is for, and duplicating that choice in two
 * places invites the two to disagree.
 */

import { CountControl, SettingsNote } from './shared';

export default function FaqSettings({ block, readOnly, onChange }) {
  const items = Array.isArray(block.data.items) ? block.data.items : [];

  return (
    <div className="space-y-2">
      <CountControl
        label="Questions"
        unit="question"
        count={items.length}
        min={1}
        disabled={readOnly}
        onAdd={() =>
          onChange({ ...block.data, items: [...items, { question: '', answer: '' }] }, null)
        }
        onRemove={() => onChange({ ...block.data, items: items.slice(0, -1) }, null)}
      />
      <SettingsNote>
        Questions render as a real `details`/`summary` accordion, so they stay
        expandable for crawlers and keyboard users with no JavaScript.
      </SettingsNote>
    </div>
  );
}
