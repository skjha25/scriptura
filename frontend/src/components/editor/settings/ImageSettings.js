// frontend/src/components/editor/settings/ImageSettings.js
/**
 * Image block settings: source, alt text, caption, and the logo overlay.
 *
 * ---------------------------------------------------------------------------
 * WHY ALT TEXT IS FIRST AND MARKED REQUIRED
 * ---------------------------------------------------------------------------
 * It is the field most likely to be skipped and the one with the largest consequence:
 * a missing alt is an accessibility failure for every screen-reader visitor and a lost
 * SEO signal on every image. Marking it required here is a nudge, not a validator —
 * the backend accepts an empty alt because an empty alt is correct for a purely
 * decorative image, and the canvas warns visibly when one is missing.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE LOGO TOGGLE ACTUALLY DOES
 * ---------------------------------------------------------------------------
 * `has_logo_overlay` and `logo_position` are metadata: they record the intent that the
 * Divinetalk logo is composited onto this image. The compositing happens server-side
 * (POST /media/composite-logo) against the stored file — the block renderer does not
 * draw an overlay. So the fields are honest about being a record of a decision, and
 * the note says so rather than implying the preview will change.
 */

import { Input, Toggle, Select } from '../../ui/form';
import { LOGO_POSITIONS, LOGO_POSITION_LABELS } from '../../../lib/constants';
import { SettingsNote } from './shared';

/** `none` is the toggle's off state, so it is not offered as a position. */
const POSITION_OPTIONS = LOGO_POSITIONS.filter((position) => position !== 'none').map(
  (position) => ({ value: position, label: LOGO_POSITION_LABELS[position] })
);

export default function ImageSettings({ block, readOnly, onChange }) {
  const { data } = block;
  const hasLogo = Boolean(data.has_logo_overlay);

  function patch(next, mergeKey) {
    onChange({ ...data, ...next }, mergeKey);
  }

  return (
    <div className="space-y-4">
      <Input
        label="Alt text"
        required
        value={data.alt_text || ''}
        readOnly={readOnly}
        hint="Describe what the image shows, not that it is an image."
        onChange={(event) =>
          patch({ alt_text: event.target.value }, `${block.id}:settings:alt_text`)
        }
      />

      <Input
        label="Image path or URL"
        value={data.url || ''}
        readOnly={readOnly}
        hint="A stored path such as blogs/July2026/name.png, or an absolute https URL."
        onChange={(event) => patch({ url: event.target.value }, `${block.id}:settings:url`)}
      />

      <Input
        label="Caption"
        value={data.caption || ''}
        readOnly={readOnly}
        onChange={(event) => patch({ caption: event.target.value }, `${block.id}:settings:caption`)}
      />

      <div className="space-y-3 border-t border-hairline pt-4">
        <Toggle
          label="Logo overlay"
          hint="Composite the Divinetalk logo onto this image"
          checked={hasLogo}
          disabled={readOnly}
          onChange={(checked) =>
            patch(
              {
                has_logo_overlay: checked,
                // Off means "no logo" in the stored data too, so a disabled overlay
                // cannot leave a stale position behind for the compositor to act on.
                logo_position: checked
                  ? data.logo_position && data.logo_position !== 'none'
                    ? data.logo_position
                    : 'bottom_right'
                  : 'none',
              },
              null
            )
          }
        />

        {hasLogo ? (
          <Select
            label="Logo position"
            value={data.logo_position && data.logo_position !== 'none' ? data.logo_position : 'bottom_right'}
            options={POSITION_OPTIONS}
            disabled={readOnly}
            onChange={(event) => patch({ logo_position: event.target.value }, null)}
          />
        ) : null}

        <SettingsNote>
          The overlay is applied to the stored file when the image is composited. The
          preview shows the image as it is stored right now.
        </SettingsNote>
      </div>
    </div>
  );
}
