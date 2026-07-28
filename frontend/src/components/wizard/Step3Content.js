// frontend/src/components/wizard/Step3Content.js
/**
 * Step 3 — how the article should be written and structured.
 *
 * Two conditional controls here, for different reasons:
 *
 *   - The internal-link picker appears only when linking is on, because an empty
 *     picker on every wizard run is noise, and the toggle is what makes the
 *     picker's requirement ("choose at least one") legitimate.
 *
 *   - Web grounding is rendered ONLY when `features.serp_api` is true. The backend
 *     silently skips grounding when SerpAPI is unconfigured, so a toggle would
 *     appear to work and change nothing — which is a worse lie than not offering
 *     it. When it is available the latency cost is stated up front, because it is
 *     the one option here that makes the run noticeably slower.
 */

import { useState } from 'react';

import { generateApi } from '../../lib/api';
import { useFeatures } from '../../context/AuthContext';
import {
  ARTICLE_TYPES,
  ARTICLE_TYPE_LABELS,
  POINTS_OF_VIEW,
  POV_LABELS,
  READABILITY_LABELS,
  READABILITY_LEVELS,
  SEO_STRUCTURE_FIELDS,
} from '../../lib/constants';
import Button from '../ui/Button';
import { Input, Select, Toggle } from '../ui/form';
import { Card, CardHeader, ErrorBanner, InfoBanner } from '../ui/feedback';
import InternalLinkPicker from './InternalLinkPicker';
import OutlineBuilder from './OutlineBuilder';
import { optionsFrom } from './steps';

export default function Step3Content({ config, onChange, blogId }) {
  const features = useFeatures();
  const [outlining, setOutlining] = useState(false);
  const [error, setError] = useState(null);

  const structure = config.seo_structure_config || {};

  async function handleGenerateOutline() {
    if (outlining) return;

    setOutlining(true);
    setError(null);
    try {
      const result = await generateApi.outline({
        topic: (config.topic || '').trim(),
        title: config.blog_title || undefined,
        keyword: (config.seo_keywords || config.topic || '').trim() || undefined,
        secondary_keywords: config.secondary_keywords || [],
        article_type: config.article_type,
        tone_of_voice: config.tone_of_voice || undefined,
        point_of_view: config.point_of_view || undefined,
        readability_level: config.readability_level,
        language: config.language,
        target_country: config.target_country || undefined,
        seo_structure_config: structure,
        external_web_grounding: Boolean(config.external_web_grounding),
        // Supplying the id makes the server persist the outline to the row, which
        // is the same place our own autosave writes it — one source of truth.
        blog_id: blogId || undefined,
      });

      const outline = Array.isArray(result?.outline) ? result.outline : [];
      if (outline.length === 0) {
        setError({
          message: 'The provider returned an empty outline. Try again, or build one by hand below.',
          code: 'EMPTY_OUTLINE',
        });
        return;
      }
      onChange({ outline });
    } catch (err) {
      setError(err);
    } finally {
      setOutlining(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Voice and reading level" subtitle="What the generator is aiming for." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Select
            label="Article type"
            required
            value={config.article_type || 'general'}
            onChange={(event) => onChange({ article_type: event.target.value })}
            options={optionsFrom(ARTICLE_TYPES, ARTICLE_TYPE_LABELS)}
          />
          <Select
            label="Readability level"
            required
            value={config.readability_level || '8th_grade'}
            onChange={(event) => onChange({ readability_level: event.target.value })}
            options={optionsFrom(READABILITY_LEVELS, READABILITY_LABELS)}
          />
          <Input
            label="Tone of voice"
            value={config.tone_of_voice || ''}
            onChange={(event) => onChange({ tone_of_voice: event.target.value })}
            placeholder="Warm but factual"
            maxLength={100}
            hint="Left blank, a confirmed brand voice fills this in."
          />
          <Select
            label="Point of view"
            value={config.point_of_view || ''}
            onChange={(event) => onChange({ point_of_view: event.target.value })}
            placeholder="Let the brand voice decide"
            options={optionsFrom(POINTS_OF_VIEW, POV_LABELS)}
          />
          <Input
            label="Target country"
            value={config.target_country || ''}
            onChange={(event) => onChange({ target_country: event.target.value })}
            placeholder="IN"
            maxLength={100}
            hint="Shapes examples, festivals and dates."
          />
          <Input
            label="Language"
            required
            value={config.language || 'en'}
            onChange={(event) => onChange({ language: event.target.value })}
            placeholder="en"
            maxLength={10}
            hint="An ISO code, such as en or hi."
          />
          <div className="sm:col-span-2">
            <Toggle
              label="Clean up AI tells"
              hint="Strips the giveaway phrasing — “in conclusion”, “delve into”, “tapestry”."
              checked={Boolean(config.ai_content_cleaning)}
              onChange={(checked) => onChange({ ai_content_cleaning: checked })}
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Structure"
          subtitle="Turning one off means the generator emits no block of that kind at all."
        />
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          {SEO_STRUCTURE_FIELDS.map((field) => (
            <Toggle
              key={field.key}
              label={field.label}
              hint={field.hint}
              checked={structure[field.key] !== false}
              onChange={(checked) =>
                onChange({ seo_structure_config: { ...structure, [field.key]: checked } })
              }
            />
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Research and linking" subtitle="Where the article gets its facts." />
        <div className="space-y-4 p-5">
          <Toggle
            label="Link to our own articles"
            hint="Distributes authority and keeps readers on the site."
            checked={Boolean(config.internal_linking)}
            onChange={(checked) =>
              onChange(
                // Clearing the targets alongside the toggle keeps step 3's
                // "pick at least one" rule from being unsatisfiable-but-hidden.
                checked ? { internal_linking: true } : { internal_linking: false, internal_link_targets: [] }
              )
            }
          />

          {config.internal_linking ? (
            <InternalLinkPicker
              selected={config.internal_link_targets || []}
              onChange={(targets) => onChange({ internal_link_targets: targets })}
              excludeId={blogId}
            />
          ) : null}

          {features.serp_api ? (
            <div className="space-y-2 border-t border-hairline pt-4">
              <Toggle
                label="Ground the article in current web results"
                hint="Looks up live facts before writing, so dates and figures are current."
                checked={Boolean(config.external_web_grounding)}
                onChange={(checked) => onChange({ external_web_grounding: checked })}
              />
              {config.external_web_grounding ? (
                <InfoBanner tone="warning">
                  This adds a search round trip before the article is written — expect the run to
                  take noticeably longer, and the outline step too.
                </InfoBanner>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Outline"
          subtitle="Optional. Supplying one makes the article follow your structure instead of the model's."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGenerateOutline}
              loading={outlining}
              disabled={(config.topic || '').trim() === ''}
            >
              {outlining ? 'Generating' : 'Generate outline'}
            </Button>
          }
        />
        <div className="space-y-4 p-5">
          <ErrorBanner
            error={error}
            onRetry={handleGenerateOutline}
            onDismiss={() => setError(null)}
          />
          <OutlineBuilder
            outline={config.outline || []}
            onChange={(outline) => onChange({ outline })}
            disabled={outlining}
          />
        </div>
      </Card>
    </div>
  );
}
