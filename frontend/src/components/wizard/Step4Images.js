// frontend/src/components/wizard/Step4Images.js
/**
 * Step 4 — images.
 *
 * The preview here is a PREVIEW, and is labelled as one. `mediaApi.generateImage`
 * stores what it makes, but the article run generates its own images from the same
 * settings, so writing a preview into `blog_picture` would be overwritten minutes
 * later and would meanwhile misreport which image the article actually carries.
 * What the preview is for is answering "is this the right style?" before spending
 * a full run finding out.
 */

import { useState } from 'react';

import { mediaApi } from '../../lib/api';
import { resolveImageUrl } from '../../lib/media';
import {
  IMAGE_COUNT_MAX,
  IMAGE_COUNT_MIN,
  IMAGE_STYLES,
  IMAGE_STYLE_LABELS,
} from '../../lib/constants';
import Button from '../ui/Button';
import { Checkbox, Select, Toggle } from '../ui/form';
import { Card, CardHeader, ErrorBanner, InfoBanner, Skeleton } from '../ui/feedback';
import LogoPositionGrid from './LogoPositionGrid';
import { optionsFrom } from './steps';

/** Where the logo goes when the overlay is switched on with nothing chosen. */
const DEFAULT_LOGO_POSITION = 'bottom_right';

const COUNTS = Array.from(
  { length: IMAGE_COUNT_MAX - IMAGE_COUNT_MIN + 1 },
  (_, index) => IMAGE_COUNT_MIN + index
);

export default function Step4Images({ config, onChange }) {
  const [previews, setPreviews] = useState([]);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState(null);

  const include = config.include_images !== false;

  async function handlePreview() {
    if (previewing) return;

    setPreviewing(true);
    setError(null);
    try {
      const result = await mediaApi.generateImage({
        topic: (config.topic || config.blog_title || '').trim(),
        style: config.image_style || 'photo',
        // One image, whatever the article will use: the point is to judge the
        // style, and a four-image preview costs four provider calls to answer the
        // same question.
        count: 1,
        logo_overlay: Boolean(config.logo_overlay),
        logo_position: config.logo_overlay ? config.logo_position || DEFAULT_LOGO_POSITION : 'none',
      });

      const images = Array.isArray(result?.images) ? result.images : [];
      if (images.length === 0) {
        setError({
          message: 'The image provider returned nothing. The article can still be generated without a preview.',
          code: 'NO_IMAGES',
        });
        return;
      }
      setPreviews(images);
    } catch (err) {
      setError(err);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Images"
          subtitle="Generated with the article, from its topic and your style choice."
        />
        <div className="space-y-4 p-5">
          <Toggle
            label="Include images"
            hint="Off means a text-only article. You can add images by hand in the editor later."
            checked={include}
            onChange={(checked) => onChange({ include_images: checked })}
          />

          {include ? (
            <>
              <fieldset>
                <legend className="mb-2 text-xs font-medium text-ink-secondary">
                  How many images
                </legend>
                <div className="flex flex-wrap gap-2">
                  {COUNTS.map((count) => (
                    <label
                      key={count}
                      className={
                        Number(config.image_count) === count
                          ? 'cursor-pointer rounded-lg border border-accent/60 bg-glow-subtle px-4 py-2 text-sm text-ink'
                          : 'cursor-pointer rounded-lg border border-hairline bg-panel-sunken px-4 py-2 text-sm text-ink-secondary hover:border-hairline-strong'
                      }
                    >
                      <input
                        type="radio"
                        name="image-count"
                        value={count}
                        checked={Number(config.image_count) === count}
                        onChange={() => onChange({ image_count: count })}
                        className="sr-only"
                      />
                      {count}
                      <span className="sr-only"> {count === 1 ? 'image' : 'images'}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <Select
                label="Image style"
                required
                value={config.image_style || 'photo'}
                onChange={(event) => onChange({ image_style: event.target.value })}
                options={optionsFrom(IMAGE_STYLES, IMAGE_STYLE_LABELS)}
                hint="Brand-coloured tints the result towards Divinetalk's palette."
              />

              <div className="space-y-3 border-t border-hairline pt-4">
                <Checkbox
                  label="Burn the Divinetalk logo into each image"
                  checked={Boolean(config.logo_overlay)}
                  onChange={(checked) =>
                    onChange({
                      logo_overlay: checked,
                      // The two fields have to move together: an overlay with
                      // position 'none' is a contradiction the backend would store.
                      logo_position: checked
                        ? config.logo_position && config.logo_position !== 'none'
                          ? config.logo_position
                          : DEFAULT_LOGO_POSITION
                        : 'none',
                    })
                  }
                />
                <LogoPositionGrid
                  value={config.logo_position}
                  onChange={(position) => onChange({ logo_position: position })}
                  disabled={!config.logo_overlay}
                />
              </div>
            </>
          ) : null}
        </div>
      </Card>

      {include ? (
        <Card>
          <CardHeader
            title="Preview"
            subtitle="One sample image, to check the style before committing to a full run."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={handlePreview}
                loading={previewing}
                disabled={(config.topic || config.blog_title || '').trim() === ''}
              >
                {previewing ? 'Generating' : 'Preview an image'}
              </Button>
            }
          />
          <div className="space-y-4 p-5">
            <ErrorBanner error={error} onRetry={handlePreview} onDismiss={() => setError(null)} />

            {previewing && previews.length === 0 ? (
              <Skeleton className="aspect-video w-full max-w-sm" />
            ) : previews.length > 0 ? (
              <>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {previews.map((image) => (
                    <li key={image.relativePath || image.publicUrl}>
                      <img
                        src={resolveImageUrl(image.publicUrl || image.relativePath)}
                        alt={image.alt_text || `Sample ${config.image_style} image for ${config.topic}`}
                        className="aspect-video w-full rounded-lg border border-hairline object-cover"
                        loading="lazy"
                      />
                      {image.has_logo_overlay === false && config.logo_overlay ? (
                        <p className="mt-1.5 text-[11px] text-status-warning">
                          The overlay was requested but no logo file was found on the server.
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <InfoBanner tone="neutral">
                  This sample is not attached to the article. The run generates its own images from
                  these same settings.
                </InfoBanner>
              </>
            ) : (
              <p className="text-sm text-ink-muted">
                No preview yet. Generating one costs a provider call, so it is opt-in.
              </p>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
