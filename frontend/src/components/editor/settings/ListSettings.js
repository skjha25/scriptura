// frontend/src/components/editor/settings/ListSettings.js
/**
 * List block settings: bullet or numbered, and how many items.
 *
 * Bullet versus numbered is a meaning choice, not a style one — numbered implies the
 * order matters (a ritual performed in sequence), bullets imply it does not. It is a
 * two-option `Select` rather than a toggle because "off" would have to mean "bullet",
 * and a toggle whose off state is a real value reads as a bug.
 */

import { Select } from '../../ui/form';
import { CountControl } from './shared';

const STYLE_OPTIONS = [
  { value: 'bullet', label: 'Bulleted' },
  { value: 'numbered', label: 'Numbered' },
];

export default function ListSettings({ block, readOnly, onChange }) {
  const { data } = block;
  const items = Array.isArray(data.items) ? data.items : [];

  return (
    <div className="space-y-4">
      <Select
        label="List style"
        value={data.style === 'numbered' ? 'numbered' : 'bullet'}
        options={STYLE_OPTIONS}
        disabled={readOnly}
        onChange={(event) => onChange({ ...data, style: event.target.value }, null)}
      />
      <CountControl
        label="Items"
        unit="item"
        count={items.length}
        disabled={readOnly}
        onAdd={() => onChange({ ...data, items: [...items, ''] }, null)}
        onRemove={() => onChange({ ...data, items: items.slice(0, -1) }, null)}
      />
    </div>
  );
}
