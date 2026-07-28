// frontend/src/components/editor/settings/KeyTakeawaySettings.js
/**
 * Key-takeaway settings: the box heading and how many points.
 *
 * The heading is editable rather than fixed at "Key takeaways" because the renderer
 * emits it as an `<h3>` — it participates in the article outline, so an author writing
 * about one festival may reasonably want "What Shravana asks of you" instead.
 */

import { Input } from '../../ui/form';
import { CountControl, SettingsNote } from './shared';

export default function KeyTakeawaySettings({ block, readOnly, onChange }) {
  const { data } = block;
  const items = Array.isArray(data.items) ? data.items : [];

  return (
    <div className="space-y-4">
      <Input
        label="Box heading"
        value={data.title || ''}
        readOnly={readOnly}
        placeholder="Key takeaways"
        hint="Renders as an H3, so it appears in the outline."
        onChange={(event) =>
          onChange({ ...data, title: event.target.value }, `${block.id}:settings:title`)
        }
      />
      <CountControl
        label="Points"
        unit="point"
        count={items.length}
        disabled={readOnly}
        onAdd={() => onChange({ ...data, items: [...items, ''] }, null)}
        onRemove={() => onChange({ ...data, items: items.slice(0, -1) }, null)}
      />
      <SettingsNote>Three to five short points scan better than a long list.</SettingsNote>
    </div>
  );
}
