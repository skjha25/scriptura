// frontend/src/components/wizard/Step2BrandVoice.js
/**
 * Step 2 — brand voice, and the wizard's one hard gate.
 *
 * ---------------------------------------------------------------------------
 * WHY THE GATE IS A SEPARATE, DELIBERATE ACT
 * ---------------------------------------------------------------------------
 * A model's reading of Divinetalk's voice is a proposal, not a fact. The backend
 * treats it that way — `/brand-voice/analyze` always returns `confirmed: false`
 * and `/generate/article` refuses with 422 BRAND_VOICE_NOT_CONFIRMED until a human
 * says otherwise — so this screen has to make the confirmation a real decision
 * rather than a checkbox the author skims past. Hence: the analysed fields are
 * editable, the confirm control is the only way forward, and editing any field
 * after confirming un-confirms it. That last rule mirrors the server, which resets
 * `brand_voice_confirmed` on re-analysis for the same reason: confirming voice A
 * and then generating with voice B would be a silent lie.
 *
 * Skipping is a first-class choice (`source_type: 'none'`), not a hidden escape
 * hatch. Plenty of articles do not need a voice sample, and an author who cannot
 * find the skip will paste something arbitrary to get past the gate — which is
 * worse than no voice at all.
 */

import { useRef, useState } from 'react';
import clsx from 'clsx';

import { brandVoiceApi } from '../../lib/api';
import { POINTS_OF_VIEW, POV_LABELS } from '../../lib/constants';
import Button from '../ui/Button';
import { Field, Input, Select, TagInput, Textarea } from '../ui/form';
import { Card, CardHeader, ErrorBanner, InfoBanner } from '../ui/feedback';
import { optionsFrom } from './steps';

/** The backend refuses a shorter sample with 422 SAMPLE_TOO_SHORT. */
const MIN_SAMPLE_LENGTH = 200;

const MODES = Object.freeze([
  { value: 'text', label: 'Paste writing', hint: 'A published article or two' },
  { value: 'web_scrape', label: 'Scrape a URL', hint: 'We read the page server-side' },
  { value: 'file_upload', label: 'Upload a file', hint: '.txt or .docx, up to 2 MB' },
]);

export default function Step2BrandVoice({ config, onChange }) {
  /**
   * The input mode is UI state, not draft state: `brand_voice_source_type` records
   * what the voice *came from*, and overwriting it with a half-finished attempt
   * would make a reload claim a voice that was never analysed.
   */
  const [mode, setMode] = useState(
    config.brand_voice_source_type && config.brand_voice_source_type !== 'none'
      ? config.brand_voice_source_type
      : 'text'
  );
  const [sample, setSample] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState(null);
  /** Returned prose. There is no column for it, so it lives and dies in-session. */
  const [summary, setSummary] = useState('');
  const fileInputRef = useRef(null);

  const sourceType = config.brand_voice_source_type ?? null;
  const confirmed = config.brand_voice_confirmed === true;
  const hasVoice = sourceType !== null && sourceType !== 'none';
  const skipped = sourceType === 'none';

  /** Any edit to an analysed field invalidates a previous confirmation. */
  function editVoice(patch) {
    onChange(confirmed ? { ...patch, brand_voice_confirmed: false } : patch);
  }

  const canAnalyse =
    (mode === 'text' && sample.trim().length >= MIN_SAMPLE_LENGTH) ||
    (mode === 'web_scrape' && url.trim() !== '') ||
    (mode === 'file_upload' && file !== null);

  async function handleAnalyse() {
    if (analysing || !canAnalyse) return;

    setAnalysing(true);
    setError(null);
    try {
      const analysis =
        mode === 'file_upload'
          ? await brandVoiceApi.analyzeFile(file)
          : await brandVoiceApi.analyze(
              mode === 'text'
                ? { source_type: 'text', text: sample.trim() }
                : { source_type: 'web_scrape', url: url.trim() }
            );

      if (!analysis || typeof analysis !== 'object') {
        setError({
          message: 'The analysis came back empty. Try a longer sample, or continue without a voice.',
          code: 'EMPTY_ANALYSIS',
        });
        return;
      }

      setSummary(analysis.summary || '');
      // `confirmed: false` explicitly, not merely absent: a second analysis after
      // a confirmation must reopen the gate.
      onChange({
        brand_voice_source_type: analysis.source_type || mode,
        brand_voice_source_ref: analysis.source_ref || (mode === 'web_scrape' ? url.trim() : ''),
        brand_voice_tone: analysis.tone || '',
        brand_voice_pov: analysis.pov || '',
        brand_voice_traits: Array.isArray(analysis.traits) ? analysis.traits : [],
        brand_voice_confirmed: false,
      });
    } catch (err) {
      setError(err);
    } finally {
      setAnalysing(false);
    }
  }

  function handleSkip() {
    setSummary('');
    onChange({
      brand_voice_source_type: 'none',
      brand_voice_source_ref: '',
      brand_voice_tone: '',
      brand_voice_pov: '',
      brand_voice_traits: [],
      brand_voice_confirmed: false,
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Where should the voice come from?"
          subtitle="Optional. A sample makes the article sound like Divinetalk rather than like a model."
        />
        <div className="space-y-4 p-5">
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-ink-secondary">Input method</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {MODES.map((entry) => (
                <label
                  key={entry.value}
                  className={clsx(
                    'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors',
                    mode === entry.value
                      ? 'border-accent/50 bg-glow-subtle'
                      : 'border-hairline bg-panel-sunken hover:border-hairline-strong'
                  )}
                >
                  <input
                    type="radio"
                    name="brand-voice-mode"
                    value={entry.value}
                    checked={mode === entry.value}
                    onChange={() => setMode(entry.value)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-accent"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{entry.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-muted">
                      {entry.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {mode === 'text' ? (
            <Textarea
              label="Writing sample"
              value={sample}
              onChange={(event) => setSample(event.target.value)}
              rows={7}
              placeholder="Paste one or two published articles…"
              hint={
                sample.trim().length < MIN_SAMPLE_LENGTH
                  ? `${sample.trim().length} of at least ${MIN_SAMPLE_LENGTH} characters.`
                  : `${sample.trim().length} characters — enough to analyse.`
              }
            />
          ) : null}

          {mode === 'web_scrape' ? (
            <Input
              label="Page to read"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://divinetalk.com/blog/some-article"
              hint="Public https pages only. Internal and private addresses are refused."
            />
          ) : null}

          {mode === 'file_upload' ? (
            <Field
              label="Document"
              htmlFor="brand-voice-file"
              hint={file ? `${file.name} ready to analyse.` : '.txt or .docx, up to 2 MB.'}
            >
              <input
                ref={fileInputRef}
                id="brand-voice-file"
                type="file"
                accept=".txt,.docx"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                className="block w-full cursor-pointer rounded-lg border border-hairline bg-panel-sunken px-3 py-2.5 text-sm text-ink-secondary file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-panel-raised file:px-3 file:py-1.5 file:text-xs file:text-ink hover:border-hairline-strong"
              />
            </Field>
          ) : null}

          <ErrorBanner error={error} onDismiss={() => setError(null)} />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleAnalyse}
              loading={analysing}
              disabled={!canAnalyse}
            >
              {analysing ? 'Analysing' : 'Analyse voice'}
            </Button>
            <Button variant="ghost" onClick={handleSkip}>
              Continue without a brand voice
            </Button>
          </div>
        </div>
      </Card>

      {skipped ? (
        <InfoBanner tone="neutral">
          <strong className="font-medium text-ink">No brand voice.</strong> The article will use the
          tone and point of view you set in step 3. You can come back and analyse a sample at any
          point before generating.
        </InfoBanner>
      ) : null}

      {hasVoice ? (
        <Card glow={!confirmed}>
          <CardHeader
            title="Review the analysed voice"
            subtitle="Everything here is editable. It is a proposal until you confirm it."
          />
          <div className="space-y-4 p-5">
            {summary ? (
              <InfoBanner tone="neutral">
                <span className="text-xs uppercase tracking-wide text-ink-muted">Summary</span>
                <p className="mt-1 text-sm text-ink-secondary">{summary}</p>
              </InfoBanner>
            ) : null}

            <Input
              label="Tone"
              value={config.brand_voice_tone || ''}
              onChange={(event) => editVoice({ brand_voice_tone: event.target.value })}
              placeholder="Calm, evidence-aware, reassuring"
              maxLength={255}
            />

            <Select
              label="Point of view"
              value={config.brand_voice_pov || ''}
              onChange={(event) => editVoice({ brand_voice_pov: event.target.value })}
              placeholder="Not detected — pick one"
              options={optionsFrom(POINTS_OF_VIEW, POV_LABELS)}
            />

            <TagInput
              label="Style rules"
              value={config.brand_voice_traits || []}
              onChange={(value) => editVoice({ brand_voice_traits: value })}
              max={8}
              placeholder="Names the common fear, then right-sizes it"
              hint="Up to 8. Press Enter to add, or click × to drop one."
            />

            {config.brand_voice_source_ref ? (
              <p className="text-[11px] text-ink-faint">
                Derived from {config.brand_voice_source_ref}
              </p>
            ) : null}

            {/* The gate. Deliberately the loudest thing on the step while it is
                open, because it is the one action that cannot be inferred. */}
            <div
              className={clsx(
                'rounded-lg border px-4 py-4',
                confirmed
                  ? 'border-status-good/40 bg-status-good/10'
                  : 'border-status-warning/50 bg-status-warning/10'
              )}
            >
              {confirmed ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-ink">
                    <span aria-hidden="true" className="mr-1.5 text-status-good">
                      ✓
                    </span>
                    Voice confirmed. You can still edit it — that will ask you to confirm again.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange({ brand_voice_confirmed: false })}
                  >
                    Withdraw confirmation
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium text-ink">Confirmation required</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                    A model read the sample; it may have got the voice wrong. Article generation is
                    refused until someone has checked the tone, point of view and style rules above.
                  </p>
                  <Button variant="primary" size="sm" className="mt-3" onClick={() => onChange({ brand_voice_confirmed: true })}>
                    This is our voice — confirm
                  </Button>
                </>
              )}
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
