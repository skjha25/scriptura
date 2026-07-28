// frontend/src/components/editor/settings/ParagraphSettings.js
/**
 * Paragraph block settings: the lead flag.
 *
 * `is_lead` renders `<p class="lead">`, which reproduces the existing production
 * convention of one styled opening paragraph. It is a per-block flag rather than
 * "whichever paragraph is first" because a generated article sometimes opens with a
 * key-takeaway box, and the lead paragraph then sits second.
 */

import { Toggle } from '../../ui/form';
import { SettingsNote } from './shared';

export default function ParagraphSettings({ block, readOnly, onChange }) {
  return (
    <div className="space-y-3">
      <Toggle
        label="Lead paragraph"
        hint="Larger opening paragraph"
        checked={Boolean(block.data.is_lead)}
        disabled={readOnly}
        onChange={(is_lead) => onChange({ ...block.data, is_lead }, null)}
      />
      <SettingsNote>Use this on one paragraph per article, near the top.</SettingsNote>
    </div>
  );
}
