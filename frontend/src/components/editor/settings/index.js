// frontend/src/components/editor/settings/index.js
/**
 * Type -> settings panel lookup.
 *
 * A map rather than a switch inside BlockSettingsPanel, so adding a block type means
 * adding a file and one line here, and the panel component never grows. A type with no
 * entry is legitimate — `paragraph` has exactly one setting and some types could have
 * none — so the caller treats a missing entry as "nothing to configure" rather than an
 * error.
 */

import HeadingSettings from './HeadingSettings';
import ParagraphSettings from './ParagraphSettings';
import ImageSettings from './ImageSettings';
import QuoteSettings from './QuoteSettings';
import TableSettings from './TableSettings';
import FaqSettings from './FaqSettings';
import CtaSettings from './CtaSettings';
import ListSettings from './ListSettings';
import EmbedSettings from './EmbedSettings';
import KeyTakeawaySettings from './KeyTakeawaySettings';

const SETTINGS_PANELS = {
  heading: HeadingSettings,
  paragraph: ParagraphSettings,
  image: ImageSettings,
  quote: QuoteSettings,
  table: TableSettings,
  faq_accordion: FaqSettings,
  cta_button: CtaSettings,
  list: ListSettings,
  embed: EmbedSettings,
  key_takeaway: KeyTakeawaySettings,
};

export default SETTINGS_PANELS;
