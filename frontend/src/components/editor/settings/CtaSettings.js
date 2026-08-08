/**
 * CTA button settings: the label and where it goes.
 *
 * The renderer drops the whole block when either the label or the URL is empty — a
 * button with no destination is worse than no button. So both are shown here together
 * with a warning when one is missing, rather than letting the author wonder why their
 * CTA vanished from the preview.
 *
 * The URL is not validated beyond the renderer's own `safeUrl` check (which rejects
 * `javascript:` and protocol-relative URLs). Refusing anything stricter here would
 * block legitimate root-relative links into the Divinetalk site.
 */

import { Input } from '../../ui/form';
import { SettingsNote } from './shared';

export default function CtaSettings({ block, readOnly, onChange }) {
  const { data } = block;
  const incomplete = !data.text || !data.url;

  return (
    <div className="space-y-4">
      <Input
        label="Button label"
        required
        value={data.text || ''}
        readOnly={readOnly}
        placeholder="Talk to an astrologer"
        onChange={(event) =>
          onChange({ ...data, text: event.target.value }, `${block.id}:settings:text`)
        }
      />
      <Input
        label="Link"
        required
        value={data.url || ''}
        readOnly={readOnly}
        placeholder="https://divinetalk.in/astrology"
        hint="External links open in a new tab with noopener."
        onChange={(event) =>
          onChange({ ...data, url: event.target.value }, `${block.id}:settings:url`)
        }
      />
      {incomplete ? (
        <SettingsNote>
          Both a label and a link are needed — the block is skipped entirely while either
          is empty.
        </SettingsNote>
      ) : null}
    </div>
  );
}
