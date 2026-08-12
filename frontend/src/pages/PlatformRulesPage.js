// frontend/src/pages/PlatformRulesPage.js
/**
 * Platform Rules — the reference page for the three layers the agentic-AI
 * chat layer is built on:
 *
 *   1. Golden Rules   — hardcoded, no agent can ever propose changing these.
 *   2. Normal Rules    — admin-editable defaults (image style, content
 *                        defaults). Read-only here on purpose: changing them
 *                        still goes through an agent's propose -> Apply flow
 *                        in the chat widget, never a direct form submit. The
 *                        one deliberate exception is the chat context window
 *                        (see below), which also has a direct slider+Set —
 *                        an ops knob small/safe enough (bounded 2-30, no
 *                        content/brand impact) that the admin asked for a
 *                        fast path alongside the agent-proposal one.
 *   3. Knowledge Base   — the confirmed style profile learned from example
 *                        writing, plus a "teach it something new" panel that
 *                        analyses freshly pasted samples into a draft and
 *                        only persists it once the admin clicks Save.
 */

import { useCallback, useEffect, useState } from 'react';

import { agentsApi, autopilotSettingsApi } from '../lib/api';
import AgentChatWidget from '../components/agents/AgentChatWidget';
import Button from '../components/ui/Button';
import { Textarea } from '../components/ui/form';
import { Card, CardHeader, ErrorBanner, Skeleton } from '../components/ui/feedback';

const MAX_SAMPLES = 5;

// Must match AGENT_CHAT_CONTEXT_EXCHANGES_MIN/MAX in backend/src/constants/index.js —
// duplicated here only for the slider's range; the server re-validates regardless.
const CHAT_CONTEXT_MIN = 2;
const CHAT_CONTEXT_MAX = 30;

/** 'blog_image' -> 'Blog Image' — style/field keys are snake_case, labels shouldn't be. */
function formatLabel(key) {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function ProfileFields({ profile }) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <dt className="text-xs text-ink-faint">Tone</dt>
        <dd className="text-sm text-ink">{profile.tone || <span className="text-ink-faint">—</span>}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-faint">Point of view</dt>
        <dd className="text-sm text-ink">
          {profile.pov ? formatLabel(profile.pov) : <span className="text-ink-faint">—</span>}
        </dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs text-ink-faint">Traits</dt>
        <dd>
          {profile.traits?.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-ink">
              {profile.traits.map((trait, i) => (
                <li key={i}>{trait}</li>
              ))}
            </ul>
          ) : (
            <span className="text-sm text-ink-faint">—</span>
          )}
        </dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs text-ink-faint">Summary</dt>
        <dd className="text-sm text-ink">{profile.summary || <span className="text-ink-faint">—</span>}</dd>
      </div>
    </dl>
  );
}

export default function PlatformRulesPage() {
  const [goldenRules, setGoldenRules] = useState(null);
  const [goldenError, setGoldenError] = useState(null);

  const [imageStyles, setImageStyles] = useState(null);
  const [contentDefaults, setContentDefaults] = useState(null);
  const [chatContextExchanges, setChatContextExchanges] = useState(null);
  const [rulesError, setRulesError] = useState(null);

  // Slider position, separate from the saved value above so dragging doesn't
  // write anything until "Set" is clicked. Seeded from the loaded value
  // inside loadRules below, then only the admin's drag moves it.
  const [chatContextDraft, setChatContextDraft] = useState(CHAT_CONTEXT_MIN);
  const [chatContextSaving, setChatContextSaving] = useState(false);
  const [chatContextSaveError, setChatContextSaveError] = useState(null);
  const [chatContextSaved, setChatContextSaved] = useState(false);

  const [profile, setProfile] = useState(null);
  // A confirmed-nothing-yet response is ALSO `null` (see getSetting's
  // fallback), so loading has to be its own flag — `profile === null` can't
  // distinguish "haven't fetched" from "fetched, nothing learned yet".
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);

  const [samples, setSamples] = useState(['']);
  const [draft, setDraft] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadGolden = useCallback(async () => {
    setGoldenError(null);
    try {
      setGoldenRules(await agentsApi.getGoldenRules());
    } catch (err) {
      setGoldenError(err);
    }
  }, []);

  const loadRules = useCallback(async () => {
    setRulesError(null);
    try {
      const [styles, defaults, autopilot] = await Promise.all([
        agentsApi.getSetting('agents.image.style_overrides'),
        agentsApi.getSetting('agents.generate.content_defaults'),
        autopilotSettingsApi.get(),
      ]);
      setImageStyles(styles || {});
      setContentDefaults(defaults || {});
      const savedExchanges = autopilot?.['agents.chat.context_exchanges'];
      setChatContextExchanges(savedExchanges);
      if (typeof savedExchanges === 'number') setChatContextDraft(savedExchanges);
    } catch (err) {
      setRulesError(err);
    }
  }, []);

  const handleSetChatContext = useCallback(async () => {
    setChatContextSaving(true);
    setChatContextSaveError(null);
    try {
      const saved = await autopilotSettingsApi.update({
        scope: 'org',
        settings: { 'agents.chat.context_exchanges': chatContextDraft },
      });
      setChatContextExchanges(saved['agents.chat.context_exchanges']);
      setChatContextSaved(true);
      setTimeout(() => setChatContextSaved(false), 2000);
    } catch (err) {
      setChatContextSaveError(err);
    } finally {
      setChatContextSaving(false);
    }
  }, [chatContextDraft]);

  const loadProfile = useCallback(async () => {
    setProfileError(null);
    try {
      setProfile(await agentsApi.getSetting('agents.generate.style_profile'));
    } catch (err) {
      setProfileError(err);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGolden();
    loadRules();
    loadProfile();
  }, [loadGolden, loadRules, loadProfile]);

  const updateSample = (index, value) => {
    setSamples((prev) => prev.map((s, i) => (i === index ? value : s)));
  };
  const addSample = () => {
    setSamples((prev) => (prev.length >= MAX_SAMPLES ? prev : [...prev, '']));
  };
  const removeSample = (index) => {
    setSamples((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAnalyze = useCallback(async () => {
    const raw_samples = samples.map((s) => s.trim()).filter(Boolean);
    if (raw_samples.length === 0) return;

    setExtracting(true);
    setExtractError(null);
    setDraft(null);
    try {
      const result = await agentsApi.extractStyleProfile({ raw_samples });
      setDraft(result);
    } catch (err) {
      setExtractError(err);
    } finally {
      setExtracting(false);
    }
  }, [samples]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setExtractError(null);
    try {
      const saved = await agentsApi.confirmStyleProfile(draft.profile);
      setProfile(saved);
      setDraft(null);
      setSamples(['']);
    } catch (err) {
      setExtractError(err);
    } finally {
      setSaving(false);
    }
  }, [draft]);

  const handleDiscard = useCallback(() => setDraft(null), []);

  const hasAnalyzableInput = samples.some((s) => s.trim());

  return (
    <div className="space-y-8 animate-fade-in-up">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-ink">Platform Rules</h1>
        <p className="max-w-2xl text-base text-ink-secondary">
          What every agent is bound by, what&rsquo;s currently configured, and what the platform has
          learned from your writing — all in one place.
        </p>
      </header>

      <Card as="section" aria-labelledby="golden-heading">
        <CardHeader
          title={<span id="golden-heading">Golden Rules</span>}
          subtitle="Hardcoded — no agent, admin request, or chat message can ever change these."
        />
        <div className="space-y-4 px-5 pb-5 pt-4">
          {goldenError ? (
            <ErrorBanner error={goldenError} onRetry={loadGolden} />
          ) : goldenRules === null ? (
            <Skeleton rows={3} />
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Image generation
                </p>
                <p className="mt-1 text-sm text-ink-secondary">{goldenRules.image}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Editorial content
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-ink-secondary">
                  {goldenRules.content.map((rule, i) => (
                    <li key={i}>{rule}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card as="section" aria-labelledby="normal-heading">
        <CardHeader
          title={<span id="normal-heading">Normal Rules</span>}
          subtitle="Admin-editable defaults. Read-only reference — change these by asking an agent in chat, then clicking Apply."
        />
        <div className="space-y-5 px-5 pb-5 pt-4">
          {rulesError ? (
            <ErrorBanner error={rulesError} onRetry={loadRules} />
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Image style directives
                </p>
                {imageStyles === null ? (
                  <div className="mt-2">
                    <Skeleton rows={2} />
                  </div>
                ) : (
                  <dl className="mt-2 space-y-2">
                    {Object.entries(imageStyles).map(([style, text]) => (
                      <div key={style}>
                        <dt className="text-xs font-medium text-ink">{formatLabel(style)}</dt>
                        <dd className="text-sm text-ink-secondary">{text}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Content defaults
                </p>
                {contentDefaults === null ? (
                  <div className="mt-2">
                    <Skeleton rows={2} />
                  </div>
                ) : (
                  <dl className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-ink-faint">Tone of voice</dt>
                      <dd className="text-sm text-ink-secondary">
                        {contentDefaults.tone_of_voice || 'Not set'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-faint">Point of view</dt>
                      <dd className="text-sm text-ink-secondary">
                        {contentDefaults.point_of_view ? formatLabel(contentDefaults.point_of_view) : 'Not set'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-faint">Readability</dt>
                      <dd className="text-sm text-ink-secondary">
                        {contentDefaults.readability_level ? formatLabel(contentDefaults.readability_level) : 'Not set'}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-ink-faint">Extra notes</dt>
                      <dd className="text-sm text-ink-secondary">{contentDefaults.extra_notes || 'Not set'}</dd>
                    </div>
                  </dl>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Chat context window
                </p>
                {chatContextExchanges === null ? (
                  <div className="mt-2">
                    <Skeleton rows={1} />
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <p className="text-sm text-ink-secondary">
                      {chatContextExchanges} past exchange{chatContextExchanges === 1 ? '' : 's'} remembered per
                      agent conversation.
                    </p>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={CHAT_CONTEXT_MIN}
                        max={CHAT_CONTEXT_MAX}
                        step={1}
                        value={chatContextDraft}
                        onChange={(e) => setChatContextDraft(Number(e.target.value))}
                        disabled={chatContextSaving}
                        className="h-1.5 flex-1 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Chat context window, in past exchanges remembered"
                      />
                      <span className="w-6 shrink-0 text-right text-sm font-medium text-ink font-numeric">
                        {chatContextDraft}
                      </span>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        loading={chatContextSaving}
                        disabled={chatContextSaving || chatContextDraft === chatContextExchanges}
                        onClick={handleSetChatContext}
                      >
                        Set
                      </Button>
                    </div>
                    <p className="text-xs text-ink-faint">
                      {CHAT_CONTEXT_MIN}–{CHAT_CONTEXT_MAX} exchanges — applies immediately, no Apply step. Or
                      ask the Autopilot Scheduler Agent below to change it for you instead.
                    </p>
                    {chatContextSaved ? <p className="text-xs text-status-good">Saved.</p> : null}
                    <ErrorBanner error={chatContextSaveError} onDismiss={() => setChatContextSaveError(null)} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Card>

      <Card as="section" aria-labelledby="knowledge-heading">
        <CardHeader
          title={<span id="knowledge-heading">Knowledge Base</span>}
          subtitle="The style profile learned from example writing — feeds every future article's tone."
        />
        <div className="space-y-5 px-5 pb-5 pt-4">
          {profileLoading ? (
            <Skeleton rows={3} />
          ) : profileError ? (
            <ErrorBanner error={profileError} onRetry={loadProfile} />
          ) : profile?.confirmed ? (
            <div>
              <ProfileFields profile={profile} />
              <p className="mt-3 text-xs text-ink-faint">
                Last learned {new Date(profile.confirmed_at).toLocaleString()}
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-faint">
              Nothing learned yet — teach it something below and save it once you like the result.
            </p>
          )}

          <div className="border-t border-hairline pt-4">
            <p className="text-sm font-semibold text-ink">Teach it something new</p>
            <p className="mt-1 text-xs text-ink-muted">
              Paste a blog draft, a LinkedIn post, or any writing sample you want it to learn from —
              it builds on what it already knows rather than starting over.
            </p>

            <div className="mt-3 space-y-2">
              {samples.map((sample, i) => (
                <div key={i} className="flex gap-2">
                  <Textarea
                    value={sample}
                    onChange={(e) => updateSample(i, e.target.value)}
                    rows={4}
                    placeholder="Paste a blog, LinkedIn post, or any writing sample here..."
                    containerClassName="flex-1"
                    className="text-sm"
                    disabled={extracting}
                  />
                  {samples.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeSample(i)}
                      aria-label="Remove sample"
                      className="mt-1.5 h-fit text-ink-faint hover:text-ink"
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addSample}
                disabled={samples.length >= MAX_SAMPLES || extracting}
              >
                + Add another sample
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={extracting}
                disabled={!hasAnalyzableInput}
                onClick={handleAnalyze}
              >
                Analyze
              </Button>
            </div>

            <ErrorBanner error={extractError} onDismiss={() => setExtractError(null)} className="mt-3" />

            {draft ? (
              <div className="mt-4 rounded-lg border border-accent/25 bg-accent/5 p-4">
                <p className="mb-3 text-sm font-medium text-ink">
                  Here&rsquo;s what it learned from {draft.sample_count} sample
                  {draft.sample_count === 1 ? '' : 's'} — nothing is saved yet:
                </p>
                <ProfileFields profile={draft.profile} />
                <div className="mt-4 flex gap-2">
                  <Button type="button" variant="primary" size="sm" loading={saving} onClick={handleSave}>
                    Save to knowledge base
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={handleDiscard} disabled={saving}>
                    Discard
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <AgentChatWidget
        agents={['generate_agent', 'blog_image_agent', 'autopilot_agent']}
        defaultAgent="generate_agent"
      />
    </div>
  );
}
