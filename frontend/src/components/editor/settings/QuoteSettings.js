// frontend/src/components/editor/settings/QuoteSettings.js
/**
 * Quote block settings: the attribution.
 *
 * The quotation itself is content and is edited on the canvas. The attribution is here
 * because it renders as a `<cite>` outside the quote, and giving it a labelled field
 * makes clear that it is a separate thing from the quoted words — authors otherwise
 * type "— Sant Tukaram" into the quote text and the citation markup is lost.
 */

import { Input } from '../../ui/form';
import { SettingsNote } from './shared';

export default function QuoteSettings({ block, readOnly, onChange }) {
  return (
    <div className="space-y-3">
      <Input
        label="Attribution"
        value={block.data.attribution || ''}
        readOnly={readOnly}
        placeholder="Sant Tukaram"
        onChange={(event) =>
          onChange(
            { ...block.data, attribution: event.target.value },
            `${block.id}:settings:attribution`
          )
        }
      />
      <SettingsNote>
        Do not include a dash — the stylesheet adds the separator.
      </SettingsNote>
    </div>
  );
}
