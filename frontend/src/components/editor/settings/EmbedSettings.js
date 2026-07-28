// frontend/src/components/editor/settings/EmbedSettings.js
/**
 * Embed block settings: the URL and the frame title.
 *
 * The title is not decoration. It becomes the `<iframe title>`, which is what a screen
 * reader announces in place of the frame's contents — an untitled iframe is announced
 * as "frame", which is useless. It defaults to "Embedded content" in the renderer, and
 * this field exists so the author can do better than the default.
 *
 * Only `https` URLs are framed. Anything else degrades to a plain link rather than
 * being dropped, which is why the field accepts it and the note explains what will
 * happen instead of rejecting the input.
 */

import { Input } from '../../ui/form';
import { SettingsNote } from './shared';

export default function EmbedSettings({ block, readOnly, onChange }) {
  const { data } = block;
  const framed = /^https:\/\//i.test(data.url || '');

  return (
    <div className="space-y-4">
      <Input
        label="Embed URL"
        required
        value={data.url || ''}
        readOnly={readOnly}
        placeholder="https://www.youtube.com/embed/…"
        onChange={(event) =>
          onChange({ ...data, url: event.target.value }, `${block.id}:settings:url`)
        }
      />
      <Input
        label="Frame title"
        value={data.title || ''}
        readOnly={readOnly}
        placeholder="Embedded content"
        hint="Announced to screen readers in place of the frame's contents."
        onChange={(event) =>
          onChange({ ...data, title: event.target.value }, `${block.id}:settings:title`)
        }
      />
      {data.url && !framed ? (
        <SettingsNote>
          Not an https URL — this will render as a plain link rather than an embedded
          frame.
        </SettingsNote>
      ) : null}
    </div>
  );
}
