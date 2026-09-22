// frontend/src/components/settings/ImageDefaultsSettings.js
/**
 * P6-A: Global Blog Image Settings.
 *
 * There is deliberately no per-blog image size control here — this is the
 * ONE global default (`ScripturaSettings` key `content.image_defaults`,
 * scope:'org') that `services/imageGeneration.js#generateBlogImage` applies
 * to every future generated/regenerated image (the featured image today;
 * block-level image regeneration reuses the same function once built, and
 * inherits this automatically). Saving here never touches any
 * already-generated image.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import { contentSettingsApi } from '../../lib/api';
import Button from '../ui/Button';
import { Input, Toggle } from '../ui/form';
import { Card, CardHeader, ErrorBanner, Skeleton, Badge } from '../ui/feedback';

/** Common header-image presets — a shortcut, not a restriction; any value inside the backend's bounds (200-2048) is still enterable by hand below. */
const PRESETS = [
  { label: 'Square', width: 1024, height: 1024 },
  { label: 'Landscape', width: 1200, height: 630 },
  { label: 'Widescreen', width: 1600, height: 900 },
];

/** A believable "photo" crop preview built from CSS gradients + simple shapes — no real image asset needed, and it genuinely demonstrates what a `cover`-fit crop will keep vs. cut off. */
function CropPreview({ width, height }) {
  const ratio = width > 0 && height > 0 ? width / height : 1;
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-xl border border-hairline shadow-panel"
        style={{ aspectRatio: `${ratio}` }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, #2B1B4A 0%, #4A2F7A 45%, #E4761B 78%, #F2B23E 100%)',
          }}
        />
        {/* "Sun" */}
        <div
          className="absolute rounded-full"
          style={{
            width: '18%',
            aspectRatio: '1',
            top: '22%',
            left: '68%',
            background: 'radial-gradient(circle, #FDE9B8 0%, #F2B23E 70%, transparent 100%)',
          }}
        />
        {/* "Mountains" */}
        <svg className="absolute inset-x-0 bottom-0 h-2/5 w-full" viewBox="0 0 100 40" preserveAspectRatio="none">
          <polygon points="0,40 0,22 22,8 38,26 55,12 72,28 88,16 100,24 100,40" fill="#1A1030" opacity="0.85" />
          <polygon points="0,40 0,30 30,18 50,32 68,20 100,30 100,40" fill="#120A22" opacity="0.9" />
        </svg>
        <div className="absolute inset-x-0 bottom-0 bg-void/70 px-3 py-1.5 backdrop-blur-sm">
          <p className="text-center text-[11px] font-medium text-white/90">
            {width} × {height} · {ratio.toFixed(2)}:1
          </p>
        </div>
      </div>
      <p className="max-w-sm text-center text-[11px] text-ink-faint">
        A generated image is cropped to fill this frame exactly — the parts outside it are trimmed, never stretched.
      </p>
    </div>
  );
}

export default function ImageDefaultsSettings() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [currentDefault, setCurrentDefault] = useState(null);

  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [lockAspectRatio, setLockAspectRatio] = useState(true);
  const ratioRef = useRef(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await contentSettingsApi.getImageDefaults();
      setCurrentDefault(data);
      setWidth(data.width);
      setHeight(data.height);
      setLockAspectRatio(data.lockAspectRatio !== false);
      ratioRef.current = data.width / data.height;
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleWidthChange = (raw) => {
    const w = Math.max(0, Math.round(Number(raw) || 0));
    setWidth(w);
    if (lockAspectRatio && ratioRef.current) {
      setHeight(Math.max(1, Math.round(w / ratioRef.current)));
    }
    setSaved(false);
  };

  const handleHeightChange = (raw) => {
    const h = Math.max(0, Math.round(Number(raw) || 0));
    setHeight(h);
    if (lockAspectRatio && ratioRef.current) {
      setWidth(Math.max(1, Math.round(h * ratioRef.current)));
    }
    setSaved(false);
  };

  const handleLockToggle = (checked) => {
    setLockAspectRatio(checked);
    if (checked && width > 0 && height > 0) ratioRef.current = width / height;
  };

  const applyPreset = (preset) => {
    setWidth(preset.width);
    setHeight(preset.height);
    ratioRef.current = preset.width / preset.height;
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await contentSettingsApi.updateImageDefaults({ width, height, lockAspectRatio });
      setCurrentDefault(updated);
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    currentDefault && (width !== currentDefault.width || height !== currentDefault.height || lockAspectRatio !== (currentDefault.lockAspectRatio !== false));
  const withinBounds = width >= 200 && width <= 2048 && height >= 200 && height <= 2048;

  return (
    <Card as="section" aria-labelledby="image-defaults-heading">
      <CardHeader
        title={<span id="image-defaults-heading">Blog Image Defaults</span>}
        subtitle="The default output size for every future generated or regenerated blog image — applied globally, not per-article."
      />
      <div className="px-5 pb-5 pt-2">
        {loading ? (
          <Skeleton rows={4} />
        ) : error && !currentDefault ? (
          <ErrorBanner error={error} onRetry={load} />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-5">
              {currentDefault ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-panel-raised/50 px-3 py-2 text-xs">
                  <span className="text-ink-faint">Current Default</span>
                  <Badge tone="accent">
                    {currentDefault.width} × {currentDefault.height}
                  </Badge>
                  <span className="text-ink-faint">{(currentDefault.width / currentDefault.height).toFixed(2)}:1</span>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {PRESETS.map((preset) => {
                  const active = width === preset.width && height === preset.height;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className={
                        active
                          ? 'rounded-full border border-accent/50 bg-accent/15 px-3 py-1 text-xs font-medium text-accent-bright'
                          : 'rounded-full border border-hairline px-3 py-1 text-xs text-ink-secondary hover:border-hairline-strong hover:text-ink'
                      }
                    >
                      {preset.label} <span className="text-ink-faint">({preset.width}×{preset.height})</span>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Width"
                  type="number"
                  min={200}
                  max={2048}
                  value={width}
                  onChange={(e) => handleWidthChange(e.target.value)}
                  disabled={saving}
                />
                <Input
                  label="Height"
                  type="number"
                  min={200}
                  max={2048}
                  value={height}
                  onChange={(e) => handleHeightChange(e.target.value)}
                  disabled={saving}
                />
              </div>

              <Toggle
                label="Lock aspect ratio"
                hint="Changing one dimension automatically adjusts the other to keep the current ratio."
                checked={lockAspectRatio}
                onChange={handleLockToggle}
                disabled={saving}
              />

              {!withinBounds ? (
                <p className="text-xs text-status-critical">Width and height must each be between 200 and 2048 pixels.</p>
              ) : null}

              <ErrorBanner error={error} onDismiss={() => setError(null)} />

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="primary"
                  loading={saving}
                  disabled={!withinBounds || !dirty}
                  onClick={handleSave}
                >
                  Save Default
                </Button>
                <AnimatePresence>
                  {saved ? (
                    <motion.span
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-1 text-xs font-medium text-status-good"
                    >
                      ✓ Saved
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>

            <CropPreview width={withinBounds ? width : currentDefault?.width || 1024} height={withinBounds ? height : currentDefault?.height || 1024} />
          </div>
        )}
      </div>
    </Card>
  );
}
