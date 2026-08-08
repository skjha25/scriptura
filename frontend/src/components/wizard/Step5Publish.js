// frontend/src/components/wizard/Step5Publish.js
/**
 * Step 5 — publish settings.
 *
 * The three choices are intent, not action. See PUBLISH_MODES in steps.js for how
 * each maps onto `blog_status` and `publish_date`, and for why "publish now" does
 * not actually publish here: PATCH /blogs/:id would happily set status = published,
 * bypassing the server's own "is there any content?" guard and putting an empty
 * article on the live site before it had been generated, never mind reviewed.
 */

import { BLOG_STATUS } from '../../lib/constants';
import { Input, Select, TagInput } from '../ui/form';
import { Card, CardHeader, InfoBanner } from '../ui/feedback';
import { PUBLISH_MODE, PUBLISH_MODES, patchForPublishMode, publishModeOf, todayIsoDatetime } from './steps';

/**
 * Categories offered in the picker.
 *
 * A free-text field here produces "Festivals", "festivals" and "Festival" in the
 * same table within a week, and the column is shared with the live site's
 * navigation. A short list matching what Divinetalk already publishes under is the
 * lesser evil; anything genuinely new is a one-line change here.
 */
const CATEGORIES = Object.freeze([
  'Astrology basics',
  'Horoscope',
  'Festivals & vrat',
  'Planets & transits',
  'Remedies',
  'Numerology',
  'Vastu',
  'Tarot',
]);

export default function Step5Publish({ config, onChange }) {
  const mode = publishModeOf(config);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="When does this go live?"
          subtitle="Generation never publishes. This records what should happen after the review pass."
        />
        <div className="space-y-4 p-5">
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-ink-secondary">Publishing</legend>
            <div className="space-y-2">
              {PUBLISH_MODES.map((entry) => (
                <label
                  key={entry.value}
                  className={
                    mode === entry.value
                      ? 'flex cursor-pointer items-start gap-3 rounded-lg border border-brand/50 bg-brand-subtle dark:bg-brand-darkSubtle px-3 py-2.5'
                      : 'flex cursor-pointer items-start gap-3 rounded-lg border border-hairline bg-panel-sunken px-3 py-2.5 hover:border-hairline-strong'
                  }
                >
                  <input
                    type="radio"
                    name="publish-mode"
                    value={entry.value}
                    checked={mode === entry.value}
                    onChange={() => onChange(patchForPublishMode(entry.value, config.publish_date))}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-accent"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{entry.label}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-ink-muted">
                      {entry.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {mode === PUBLISH_MODE.SCHEDULE ? (
            <Input
              label="Publish date"
              type="datetime-local"
              required
              // A schedule in the past is a publish, and the two choices above
              // already distinguish them.
              min={todayIsoDatetime()}
              value={config.publish_date || ''}
              onChange={(event) =>
                onChange({
                  blog_status: BLOG_STATUS.SCHEDULED,
                  publish_date: event.target.value || null,
                })
              }
              hint="The article stays scheduled until someone publishes it from the editor."
            />
          ) : null}

          {mode === PUBLISH_MODE.NOW ? (
            <InfoBanner>
              Dated {config.publish_date || todayIsoDatetime()}. You still press publish in the editor —
              nothing goes live off the back of a generation run.
            </InfoBanner>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="Filing and attribution" subtitle="How the article is found and credited." />
        <div className="space-y-4 p-5">
          <Select
            label="Category"
            value={config.category || ''}
            onChange={(event) => onChange({ category: event.target.value })}
            placeholder="Uncategorised"
            options={CATEGORIES}
            hint="Drives the site's navigation, so it is a fixed list."
          />

          <TagInput
            label="Tags"
            value={config.tags || []}
            onChange={(tags) => onChange({ tags })}
            max={30}
            placeholder="mercury, retrograde, virgo"
          />

          <Input
            label="Published by"
            required
            value={config.published_by || ''}
            onChange={(event) => onChange({ published_by: event.target.value })}
            maxLength={255}
            hint="Shown as the byline on the live article."
          />
        </div>
      </Card>
    </div>
  );
}
