// frontend/src/components/editor/settings/HeadingSettings.js
/**
 * Heading block settings: the outline level.
 *
 * h1 is the article title and is not offered — two h1s on a page is a genuine SEO and
 * accessibility defect, and the renderer clamps to 2–4 anyway, so offering h1 here
 * would let an author pick a value that silently becomes something else.
 */

import { Select } from '../../ui/form';
import { SettingsNote } from './shared';

const LEVEL_OPTIONS = [
  { value: '2', label: 'H2 — section' },
  { value: '3', label: 'H3 — sub-section' },
  { value: '4', label: 'H4 — detail' },
];

export default function HeadingSettings({ block, readOnly, onChange }) {
  const level = String(Number(block.data.level) || 2);

  return (
    <div className="space-y-3">
      <Select
        label="Heading level"
        value={level}
        options={LEVEL_OPTIONS}
        disabled={readOnly}
        onChange={(event) =>
          onChange({ ...block.data, level: Number(event.target.value) }, null)
        }
      />
      <SettingsNote>
        Levels should descend without skipping — an H4 directly under an H2 reads as a
        gap in the outline to a crawler and to a screen reader.
      </SettingsNote>
    </div>
  );
}
