// frontend/src/pages/AgentKnowledgePage.js
/**
 * Agent Knowledge — the "Teach Agent" flow for the Knowledge & Learning Layer
 * (see /home/shivam/.claude/plans/zazzy-doodling-wadler.md). Every agent
 * except Generate Agent (which keeps its own separate style-profile flow on
 * Platform Rules) can be taught here from pasted text, links, images, a
 * video clip, or YouTube links.
 *
 * Flow mirrors every other propose->confirm pattern in this app: submitting
 * sources only ever returns a DRAFT batch (ingest -> extract -> validate,
 * nothing persisted). The admin reviews each candidate — new / supports /
 * contradicts / duplicate an existing item — decides accept or skip per
 * item, and only the Confirm click writes anything.
 */

import { useCallback, useEffect, useState } from 'react';

import { agentsApi, knowledgeApi, mediaApi } from '../lib/api';
import { AGENT_META, AGENT_ORDER } from '../lib/agentMeta';
import Button from '../components/ui/Button';
import { Textarea, TagInput } from '../components/ui/form';
import { Card, CardHeader, ErrorBanner, Skeleton, EmptyState, Badge } from '../components/ui/feedback';

/** Generate Agent has its own dedicated flow on Platform Rules — not this generic one. */
const TEACHABLE_AGENTS = AGENT_ORDER.filter((name) => name !== 'generate_agent');

const MAX_TEXT_SAMPLES = 20;
const MAX_LINKS = 10;
const MAX_IMAGES = 5;
const MAX_YOUTUBE_LINKS = 5;
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

const VERDICT_META = {
  new: { label: 'New', tone: 'accent' },
  supports: { label: 'Supports existing', tone: 'good' },
  contradicts: { label: 'Contradicts existing', tone: 'critical' },
  duplicate: { label: 'Duplicate', tone: 'neutral' },
};

function VerdictBadge({ verdict }) {
  const meta = VERDICT_META[verdict] || VERDICT_META.new;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/**
 * SOURCE ACCESS STATE (source-ingestion audit, FIX 7) — this is NOT knowledge
 * confidence. It answers one question only: "how much of the actual source
 * content did we successfully access?" A metadata-only or unavailable source
 * must never look like a successful content source in this UI — the admin
 * needs to see exactly what the system did and did not read.
 */
const CONTENT_STATUS_META = {
  full: { label: 'Full content', icon: '✓', tone: 'good' },
  user_provided: { label: 'Manual text', icon: '✓', tone: 'good' },
  partial: { label: 'Partial content', icon: '⚠', tone: 'warning' },
  metadata_only: { label: 'Metadata only', icon: '⚠', tone: 'warning' },
  unavailable: { label: 'Content unavailable', icon: '✕', tone: 'critical' },
  unknown: { label: 'Access state unknown (legacy source)', icon: '?', tone: 'neutral' },
};

function ContentStatusBadge({ status }) {
  const meta = CONTENT_STATUS_META[status] || CONTENT_STATUS_META.unknown;
  return (
    <Badge tone={meta.tone}>
      {meta.icon} {meta.label}
    </Badge>
  );
}

/** One line per submitted source — type, what was obtained, and its access state. Never hidden, even when metadata-only. */
function SourceStatusRow({ source }) {
  const label = source.url || source.path || (source.type === 'text' ? `Pasted text (${source.chars ?? '?'} chars)` : source.type);
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-panel px-2.5 py-1.5 text-xs">
      <span className="max-w-xs truncate text-ink-secondary" title={label}>
        {label}
      </span>
      {source.error ? (
        <span className="text-status-critical">✕ {source.error}</span>
      ) : (
        <>
          <ContentStatusBadge status={source.content_status} />
          {source.content_status === 'metadata_only' ? (
            <span className="text-ink-faint">Source content was not accessible — no substantive knowledge was extracted from it.</span>
          ) : null}
          {source.reused ? <Badge tone="neutral">Already known — reused, not re-analyzed</Badge> : null}
        </>
      )}
    </li>
  );
}

/** Read-only list of an agent's current confirmed/supported knowledge. */
function CurrentKnowledgeList({ agentName }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await knowledgeApi.get(agentName));
    } catch (err) {
      setError(err);
    }
  }, [agentName]);

  useEffect(() => {
    setRows(null);
    load();
  }, [load]);

  if (error) return <ErrorBanner error={error} onRetry={load} />;
  if (rows === null) return <Skeleton rows={3} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing learned yet"
        message="Teach it something below — paste text, a link, an image, or a video, and review what it extracts before saving."
      />
    );
  }

  // Group contested pairs together — a contested row's counterpart is one of
  // its own related_knowledge_ids. Rendering them separately (as the raw list
  // order would) buries the fact that they're a live disagreement.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const rendered = [];
  const consumed = new Set();
  for (const row of rows) {
    if (consumed.has(row.id)) continue;
    if (row.status === 'contested' && Array.isArray(row.related_knowledge_ids)) {
      const counterpartId = row.related_knowledge_ids.find((id) => byId.has(id) && id !== row.id);
      const counterpart = counterpartId ? byId.get(counterpartId) : null;
      if (counterpart) {
        rendered.push({ type: 'contested-pair', a: row, b: counterpart });
        consumed.add(row.id);
        consumed.add(counterpart.id);
        continue;
      }
    }
    rendered.push({ type: 'single', row });
    consumed.add(row.id);
  }

  return (
    <ul className="space-y-2.5">
      {rendered.map((entry) =>
        entry.type === 'contested-pair' ? (
          <li
            key={`contested-${entry.a.id}-${entry.b.id}`}
            className="rounded-lg border border-status-critical/30 bg-status-critical/5 p-3 text-sm"
          >
            <div className="mb-2 flex items-center gap-2">
              <Badge tone="critical">Contested</Badge>
              <span className="text-xs text-ink-faint">these two claims conflict — neither is settled</span>
            </div>
            <div className="space-y-2">
              {[entry.a, entry.b].map((side) => (
                <div key={side.id} className="rounded-md bg-panel px-2.5 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-ink">{side.claim}</p>
                    <span className="shrink-0 text-xs text-ink-faint">{Math.round(side.confidence * 100)}%</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-faint">{side.category}</p>
                </div>
              ))}
            </div>
          </li>
        ) : (
          <li key={entry.row.id} className="rounded-lg border border-hairline bg-panel-sunken/50 p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="text-ink">{entry.row.claim}</p>
              <span className="shrink-0 text-xs text-ink-faint">{Math.round(entry.row.confidence * 100)}%</span>
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              {entry.row.scope === 'global' ? 'Global' : AGENT_META[agentName]?.label || agentName} · {entry.row.category} ·{' '}
              {entry.row.knowledge_type ? `${entry.row.knowledge_type} · ` : ''}
              {entry.row.status}
            </p>
            {/* FIX 10 — source trace: what type/URL this claim was distilled from, and how much of it we actually read. */}
            {entry.row.source ? (
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                <span>
                  {entry.row.source.source_type}
                  {entry.row.source.source_url ? `: ${entry.row.source.source_url}` : ''}
                </span>
                <ContentStatusBadge status={entry.row.source.content_status} />
              </p>
            ) : null}
          </li>
        )
      )}
    </ul>
  );
}

/** The four source-type input blocks, each visually separated per its own content type. */
function TeachPanel({ agentName, onDraft }) {
  const [textSamples, setTextSamples] = useState(['']);
  const [links, setLinks] = useState([]);
  const [imageFiles, setImageFiles] = useState([]); // [{file, relativePath, publicUrl, uploading, error}]
  const [youtubeLinks, setYoutubeLinks] = useState([]);
  const [videoFile, setVideoFile] = useState(null);
  const [videoError, setVideoError] = useState(null);

  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState(null);

  const updateTextSample = (i, value) => setTextSamples((prev) => prev.map((s, idx) => (idx === i ? value : s)));
  const addTextSample = () => setTextSamples((prev) => (prev.length >= MAX_TEXT_SAMPLES ? prev : [...prev, '']));
  const removeTextSample = (i) => setTextSamples((prev) => prev.filter((_, idx) => idx !== i));

  const handleImagePick = async (event) => {
    const files = Array.from(event.target.files || []).slice(0, MAX_IMAGES - imageFiles.length);
    event.target.value = '';
    for (const file of files) {
      const entry = { file, relativePath: null, publicUrl: null, uploading: true, error: null };
      setImageFiles((prev) => [...prev, entry]);
      try {
        // eslint-disable-next-line no-await-in-loop -- uploads are shown one at a time as they resolve, sequential is intentional here.
        const asset = await mediaApi.upload(file);
        setImageFiles((prev) =>
          prev.map((e) => (e.file === file ? { ...e, relativePath: asset.relativePath, publicUrl: asset.publicUrl, uploading: false } : e))
        );
      } catch (err) {
        setImageFiles((prev) => prev.map((e) => (e.file === file ? { ...e, uploading: false, error: err.message } : e)));
      }
    }
  };
  const removeImage = (file) => setImageFiles((prev) => prev.filter((e) => e.file !== file));

  const handleVideoPick = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    setVideoError(null);
    if (!file) {
      setVideoFile(null);
      return;
    }
    if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
      setVideoError('Only mp4, webm, or mov clips are supported.');
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setVideoError(`That clip is too large (max ${Math.round(MAX_VIDEO_BYTES / 1e6)}MB).`);
      return;
    }
    setVideoFile(file);
  };

  const hasAnySource =
    textSamples.some((s) => s.trim()) ||
    links.length > 0 ||
    imageFiles.some((e) => e.relativePath) ||
    youtubeLinks.length > 0 ||
    Boolean(videoFile);
  const stillUploading = imageFiles.some((e) => e.uploading);

  const handleAnalyze = async () => {
    setExtracting(true);
    setExtractError(null);
    try {
      const form = new FormData();
      form.append(
        'text_samples',
        JSON.stringify(textSamples.map((s) => s.trim()).filter(Boolean))
      );
      form.append('links', JSON.stringify(links));
      form.append(
        'image_paths',
        JSON.stringify(imageFiles.filter((e) => e.relativePath).map((e) => e.relativePath))
      );
      form.append('youtube_links', JSON.stringify(youtubeLinks));
      if (videoFile) form.append('video', videoFile);

      const draft = await knowledgeApi.extract(agentName, form);
      onDraft(draft);
      setTextSamples(['']);
      setLinks([]);
      setImageFiles([]);
      setYoutubeLinks([]);
      setVideoFile(null);
    } catch (err) {
      setExtractError(err);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-ink">Text</p>
        <p className="mt-1 text-xs text-ink-muted">Paste a blog draft, a LinkedIn post, an article, or any writing sample.</p>
        <div className="mt-3 space-y-2">
          {textSamples.map((sample, i) => (
            <div key={i} className="flex gap-2">
              <Textarea
                value={sample}
                onChange={(e) => updateTextSample(i, e.target.value)}
                rows={3}
                placeholder="Paste text here..."
                containerClassName="flex-1"
                className="text-sm"
                disabled={extracting}
              />
              {textSamples.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeTextSample(i)}
                  aria-label="Remove sample"
                  className="mt-1.5 h-fit text-ink-faint hover:text-ink"
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={addTextSample}
          disabled={textSamples.length >= MAX_TEXT_SAMPLES || extracting}
        >
          + Add another sample
        </Button>
      </div>

      <div className="border-t border-hairline pt-4">
        <p className="text-sm font-semibold text-ink">Links</p>
        <p className="mt-1 text-xs text-ink-muted">A web article, competitor blog, or documentation page.</p>
        <div className="mt-3">
          <TagInput value={links} onChange={setLinks} max={MAX_LINKS} placeholder="Paste a URL and press Enter..." />
        </div>
      </div>

      <div className="border-t border-hairline pt-4">
        <p className="text-sm font-semibold text-ink">Images</p>
        <p className="mt-1 text-xs text-ink-muted">Up to {MAX_IMAGES} images — a screenshot, a chart, a visual reference.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {imageFiles.map((e) => (
            <div key={e.file.name + e.file.lastModified} className="relative">
              {e.publicUrl ? (
                <img src={e.publicUrl} alt="" className="h-16 w-16 rounded-md border border-hairline object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-md border border-hairline bg-panel-sunken text-xs text-ink-faint">
                  {e.uploading ? '…' : '!'}
                </div>
              )}
              <button
                type="button"
                onClick={() => removeImage(e.file)}
                aria-label="Remove image"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-panel text-xs text-ink-faint ring-1 ring-hairline hover:text-ink"
              >
                ✕
              </button>
              {e.error ? <p className="mt-1 max-w-[4rem] text-[10px] text-status-critical">{e.error}</p> : null}
            </div>
          ))}
          {imageFiles.length < MAX_IMAGES ? (
            <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-md border border-dashed border-hairline-strong text-xs text-ink-faint hover:border-accent hover:text-accent">
              +
              <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={handleImagePick} disabled={extracting} />
            </label>
          ) : null}
        </div>
      </div>

      <div className="border-t border-hairline pt-4">
        <p className="text-sm font-semibold text-ink">Video &amp; YouTube</p>
        <p className="mt-1 text-xs text-ink-muted">
          Transcript-based understanding only (spoken words, not visuals). A YouTube link without captions falls
          back to its title/author only.
        </p>
        <div className="mt-3 space-y-3">
          <div>
            {videoFile ? (
              <div className="flex items-center gap-2 text-sm text-ink-secondary">
                <span>{videoFile.name}</span>
                <button type="button" onClick={() => setVideoFile(null)} className="text-ink-faint hover:text-ink" aria-label="Remove video">
                  ✕
                </button>
              </div>
            ) : (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-hairline-strong px-3 py-2 text-xs text-ink-faint hover:border-accent hover:text-accent">
                Choose a clip (mp4/webm/mov, max {Math.round(MAX_VIDEO_BYTES / 1e6)}MB)
                <input type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={handleVideoPick} disabled={extracting} />
              </label>
            )}
            {videoError ? <p className="mt-1 text-xs text-status-critical">{videoError}</p> : null}
          </div>
          <TagInput
            value={youtubeLinks}
            onChange={setYoutubeLinks}
            max={MAX_YOUTUBE_LINKS}
            placeholder="Paste a YouTube URL and press Enter..."
          />
        </div>
      </div>

      <ErrorBanner error={extractError} onDismiss={() => setExtractError(null)} className="mt-2" />

      <Button
        type="button"
        variant="primary"
        loading={extracting}
        disabled={!hasAnySource || stillUploading}
        onClick={handleAnalyze}
      >
        {extracting ? 'Analyzing...' : 'Analyze'}
      </Button>
    </div>
  );
}

/** The reviewable draft batch — accept/skip per item, then Confirm. */
function DraftReview({ agentName, draft, onConfirmed, onDiscard }) {
  const [decisions, setDecisions] = useState(() => draft.items.map(() => 'accept'));
  // Batch-level target: 'agent' (default) keeps every accepted item scoped to
  // this agent only; 'global' makes them visible to every agent. See
  // knowledgeBase.confirmKnowledgeBatch on the backend.
  const [scope, setScope] = useState('agent');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState(null);

  const toggle = (i) => setDecisions((prev) => prev.map((d, idx) => (idx === i ? (d === 'accept' ? 'skip' : 'accept') : d)));

  const handleConfirm = async () => {
    setConfirming(true);
    setConfirmError(null);
    try {
      // Only the fields POST /knowledge-base/confirm's validator actually
      // accepts — `applicable_agents`/`reason` are draft-review-only display
      // fields the backend never persists, and its body schema is `.strict()`.
      const items = draft.items.map((item, i) => ({
        decision: decisions[i],
        category: item.category,
        topic: item.topic,
        claim: item.claim,
        evidence: item.evidence,
        knowledge_type: item.knowledge_type,
        source_id: item.source_id,
        chunk_ids: item.chunk_ids,
        verdict: item.verdict,
        related_id: item.related_id,
      }));
      const result = await knowledgeApi.confirm(agentName, items, scope);
      onConfirmed(result);
    } catch (err) {
      setConfirmError(err);
    } finally {
      setConfirming(false);
    }
  };

  // Keyed for the per-item source trace below (FIX 10) — a candidate carries
  // only source_id; this maps it back to that source's access state.
  const sourceById = new Map(draft.sources.filter((s) => s.source_id != null).map((s) => [s.source_id, s]));

  return (
    <div className="mt-4 rounded-lg border border-accent/25 bg-accent/5 p-4">
      <p className="mb-1 text-sm font-medium text-ink">
        {draft.items.length} candidate{draft.items.length === 1 ? '' : 's'} extracted — nothing is saved yet.
      </p>

      {/* Every submitted source, not just failures — a metadata-only source must never quietly look like a successful one. */}
      <ul className="mb-3 space-y-1">
        {draft.sources.map((source, i) => (
          <SourceStatusRow key={i} source={source} />
        ))}
      </ul>

      <div className="mb-3 flex items-center gap-3 text-xs">
        <span className="text-ink-faint">Applies to</span>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="radio"
            name={`knowledge-scope-${agentName}`}
            checked={scope === 'agent'}
            onChange={() => setScope('agent')}
            disabled={confirming}
          />
          Only {AGENT_META[agentName]?.label || agentName}
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="radio"
            name={`knowledge-scope-${agentName}`}
            checked={scope === 'global'}
            onChange={() => setScope('global')}
            disabled={confirming}
          />
          Every agent (Global)
        </label>
      </div>

      <ul className="space-y-3">
        {draft.items.map((item, i) => (
          <li key={i} className="rounded-md border border-hairline bg-panel p-3">
            <div className="flex items-start justify-between gap-3">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={decisions[i] === 'accept'}
                  onChange={() => toggle(i)}
                  className="mt-1"
                  disabled={confirming}
                />
                <span className="text-sm text-ink">{item.claim}</span>
              </label>
              <VerdictBadge verdict={item.verdict} />
            </div>
            <p className="mt-1 pl-6 text-xs text-ink-faint">
              {item.knowledge_type ? `${item.knowledge_type} · ` : ''}
              {item.category} · {item.topic}
              {item.related_id ? ` · related to #${item.related_id}` : ''}
            </p>
            {sourceById.has(item.source_id) ? (
              <p className="mt-1 pl-6 text-xs text-ink-faint">
                From: {sourceById.get(item.source_id).url || sourceById.get(item.source_id).path || sourceById.get(item.source_id).type}
                {' · '}
                <ContentStatusBadge status={sourceById.get(item.source_id).content_status} />
              </p>
            ) : null}
            {item.reason ? <p className="mt-1 pl-6 text-xs text-ink-muted">{item.reason}</p> : null}
          </li>
        ))}
      </ul>

      <ErrorBanner error={confirmError} onDismiss={() => setConfirmError(null)} className="mt-3" />

      <div className="mt-4 flex gap-2">
        <Button type="button" variant="primary" size="sm" loading={confirming} onClick={handleConfirm}>
          Confirm {decisions.filter((d) => d === 'accept').length} item{decisions.filter((d) => d === 'accept').length === 1 ? '' : 's'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={confirming}>
          Discard
        </Button>
      </div>
    </div>
  );
}

/**
 * P4-D: Learning Candidate review — the human gate between P2/P3's
 * deterministic outcome measurement (real recommendation_outcome rows) and
 * agent_knowledge. Patterns are detected in the background
 * (services/learningCandidateScheduler.js); this section is purely a
 * viewer + decision UI over the already-existing, unmodified
 * learningCandidateDecisions API — it never detects, writes agent_knowledge
 * directly, or runs any action itself. See learningCandidates.js's own
 * header comment on the backend: "P4 may IDENTIFY. P4 must NOT TEACH."
 * Confirming is the one bridge to agent_knowledge, and it goes exclusively
 * through the existing confirmKnowledgeBatch — same as the Teach flow
 * below.
 */
const CANDIDATE_STATUS_META = {
  pending_review: { label: 'Pending Review', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'neutral' },
};

const CANDIDATE_STATUS_FILTERS = [
  { value: 'pending_review', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'rejected', label: 'Rejected' },
];

const CANDIDATE_EMPTY_META = {
  pending_review: {
    title: 'No pending candidates',
    message: 'Nothing detected yet — this fills up automatically as recommendation outcomes accumulate.',
  },
  confirmed: {
    title: 'Nothing confirmed yet',
    message: 'Candidates you confirm will show up here as a record of what was taught from real outcomes.',
  },
  rejected: {
    title: 'Nothing rejected yet',
    message: 'Candidates you reject will show up here.',
  },
};

/** `evidence_refs` — pointers only (never duplicated data), exactly as stored. Provenance stays visible so the reviewer can judge the claim before teaching it. */
function EvidenceRefsList({ refs }) {
  if (!Array.isArray(refs) || refs.length === 0) {
    return <span className="text-xs text-ink-faint">No evidence references recorded.</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {refs.map((ref, i) => (
        <span
          // eslint-disable-next-line react/no-array-index-key -- refs carry no independent id of their own, (type,id) pairs may legitimately repeat across different candidates
          key={`${ref.type}-${ref.id}-${i}`}
          className="rounded border border-hairline bg-panel px-1.5 py-0.5 text-[11px] text-ink-faint"
        >
          {ref.type === 'recommendation_outcome' ? 'Outcome' : ref.type} #{ref.id}
        </span>
      ))}
    </div>
  );
}

/** Raw counts, shown alongside the deterministic `evidence` sentence — never just the rendered text alone, so the reviewer can audit the numbers independently. */
function CandidateCounts({ candidate }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-secondary">
      <span>
        Sample size: <strong className="text-ink">{candidate.sample_size}</strong>
      </span>
      <span className="text-status-good">Improved: {candidate.improved_count}</span>
      <span className="text-status-critical">Declined: {candidate.declined_count}</span>
      <span className="text-ink-faint">Neutral: {candidate.neutral_count}</span>
      <span className="text-ink-faint">Inconclusive: {candidate.inconclusive_count}</span>
      <span>
        Confidence: <strong className="text-ink">{Math.round((candidate.confidence || 0) * 100)}%</strong>
      </span>
    </div>
  );
}

/**
 * One candidate. `decision` is this session's own optimistic override right
 * after a confirm/reject click (mirrors AgentActivityPage's
 * decisionOverride pattern for recommendations) — the underlying row is
 * already durable server-side the moment the API call resolves; this is
 * purely immediate UI feedback. `resolvedScope` is used instead when the
 * row arrived already-confirmed from a *previous* session: the
 * learning_candidates row's own `scope` column always stays 'agent'
 * regardless of the reviewer's choice (only the resulting agent_knowledge
 * row reflects Agent vs Global — see learningCandidateDecisions.js), so the
 * parent resolves it by cross-referencing the existing per-agent knowledge
 * read endpoint.
 */
function LearningCandidateCard({ candidate, decision, resolvedScope, busyAction, onConfirm, onReject }) {
  const agentMeta = AGENT_META[candidate.agent_name] || { label: candidate.agent_name, icon: '🤖' };
  const status = decision?.status || candidate.status;
  const scope = decision?.scope || resolvedScope;
  const statusMeta = CANDIDATE_STATUS_META[status] || CANDIDATE_STATUS_META.pending_review;
  const busy = Boolean(busyAction);

  return (
    <Card interactive={false} className="p-4" data-testid={`learning-candidate-${candidate.id}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
        <Badge tone="accent">
          {agentMeta.icon} {agentMeta.label}
        </Badge>
        <span>
          {candidate.category}
          {candidate.topic ? ` · ${candidate.topic}` : ''}
        </span>
        <span className="font-mono" title={candidate.pattern_key} data-testid="pattern-key">
          {candidate.pattern_key}
        </span>
        <span>Detected {new Date(candidate.created_at).toLocaleString()}</span>
      </div>

      <p className="mt-2 text-sm text-ink">{candidate.claim}</p>
      {candidate.evidence ? <p className="mt-1 text-xs text-ink-secondary">{candidate.evidence}</p> : null}

      <div className="mt-2">
        <CandidateCounts candidate={candidate} />
      </div>

      <div className="mt-2">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Evidence references</p>
        <EvidenceRefsList refs={candidate.evidence_refs} />
      </div>

      <div className="mt-3">
        {status === 'pending_review' ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" size="sm" loading={busyAction === 'agent'} disabled={busy} onClick={() => onConfirm('agent')}>
              Confirm as Agent
            </Button>
            <Button type="button" variant="secondary" size="sm" loading={busyAction === 'global'} disabled={busy} onClick={() => onConfirm('global')}>
              Confirm as Global
            </Button>
            <Button type="button" variant="ghost" size="sm" loading={busyAction === 'reject'} disabled={busy} onClick={onReject}>
              Reject
            </Button>
          </div>
        ) : status === 'confirmed' ? (
          <Badge tone="good">Confirmed{scope ? ` — ${scope === 'global' ? 'Global' : 'Agent'}` : ''}</Badge>
        ) : (
          <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
        )}
      </div>
    </Card>
  );
}

function LearningCandidatesReview() {
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({}); // { [candidateId]: 'agent' | 'global' | 'reject' }
  const [decisionOverride, setDecisionOverride] = useState({}); // { [candidateId]: {status, scope} }
  const [resolvedScopes, setResolvedScopes] = useState({}); // { [candidateId]: 'agent' | 'global' }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentsApi.listLearningCandidates({ status: statusFilter });
      setRows(data);
      setDecisionOverride({});
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Best-effort Agent/Global resolution for rows that arrived already
  // confirmed (i.e. not decided in this session, so there's no local
  // `decisionOverride` for them) — see LearningCandidateCard's own comment
  // on why this can't be read off the candidate row itself. Read-only reuse
  // of the existing knowledgeApi.get() endpoint, already used elsewhere on
  // this page; failure here only means the "— Agent"/"— Global" suffix is
  // omitted, it never blocks rendering the confirmed state itself.
  useEffect(() => {
    if (!rows) return;
    const unresolved = rows.filter(
      (r) => r.status === 'confirmed' && r.confirmed_knowledge_id && !(r.id in resolvedScopes) && !(r.id in decisionOverride)
    );
    if (unresolved.length === 0) return;
    const agentNames = Array.from(new Set(unresolved.map((r) => r.agent_name)));
    let cancelled = false;
    (async () => {
      const next = {};
      for (const agentName of agentNames) {
        try {
          // eslint-disable-next-line no-await-in-loop -- bounded (<=8 agents), sequential is fine for a background resolution pass
          const knowledgeRows = await knowledgeApi.get(agentName);
          const byId = new Map(knowledgeRows.map((k) => [k.id, k]));
          for (const candidate of unresolved.filter((r) => r.agent_name === agentName)) {
            const knowledgeRow = byId.get(candidate.confirmed_knowledge_id);
            if (knowledgeRow) next[candidate.id] = knowledgeRow.scope;
          }
        } catch {
          // Best-effort only — see comment above.
        }
      }
      if (!cancelled && Object.keys(next).length > 0) setResolvedScopes((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, resolvedScopes, decisionOverride]);

  const decide = useCallback(async (candidate, action) => {
    setBusy((prev) => ({ ...prev, [candidate.id]: action }));
    setError(null);
    try {
      if (action === 'reject') {
        const updated = await agentsApi.rejectLearningCandidate(candidate.id);
        setDecisionOverride((prev) => ({ ...prev, [candidate.id]: { status: updated.status } }));
      } else {
        // action is 'agent' or 'global' — 'agent' never sends a scope key at
        // all (see agentsApi.confirmLearningCandidate), so there is no path
        // by which clicking "Confirm as Agent" can end up global.
        const updated = await agentsApi.confirmLearningCandidate(candidate.id, action === 'global' ? 'global' : undefined);
        setDecisionOverride((prev) => ({ ...prev, [candidate.id]: { status: updated.status, scope: action } }));
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy((prev) => {
        const next = { ...prev };
        delete next[candidate.id];
        return next;
      });
    }
  }, []);

  const emptyMeta = CANDIDATE_EMPTY_META[statusFilter] || CANDIDATE_EMPTY_META.pending_review;

  return (
    <Card as="section" aria-labelledby="learning-candidates-heading">
      <CardHeader
        title={<span id="learning-candidates-heading">Learning Candidates</span>}
        subtitle="Patterns detected from real recommendation outcomes — nothing here is taught until you confirm it."
      />
      <div className="px-5 pb-5 pt-4">
        <div role="tablist" aria-label="Candidate status" className="mb-4 flex flex-wrap gap-2">
          {CANDIDATE_STATUS_FILTERS.map((f) => {
            const selected = statusFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setStatusFilter(f.value)}
                className={
                  selected
                    ? 'rounded-full bg-accent/20 px-3 py-1.5 text-sm font-medium text-accent-bright ring-1 ring-accent/40'
                    : 'rounded-full px-3 py-1.5 text-sm text-ink-secondary hover:bg-panel-sunken'
                }
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <ErrorBanner error={error} onRetry={load} onDismiss={() => setError(null)} className="mb-3" />

        {loading && !rows ? (
          <Skeleton rows={3} />
        ) : !rows || rows.length === 0 ? (
          <EmptyState title={emptyMeta.title} message={emptyMeta.message} />
        ) : (
          <div className="space-y-3">
            {rows.map((candidate) => (
              <LearningCandidateCard
                key={candidate.id}
                candidate={candidate}
                decision={decisionOverride[candidate.id]}
                resolvedScope={resolvedScopes[candidate.id]}
                busyAction={busy[candidate.id]}
                onConfirm={(scope) => decide(candidate, scope)}
                onReject={() => decide(candidate, 'reject')}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export default function AgentKnowledgePage() {
  const [activeAgent, setActiveAgent] = useState(TEACHABLE_AGENTS[0]);
  const [draft, setDraft] = useState(null);
  const [confirmedSummary, setConfirmedSummary] = useState(null);
  const [knowledgeRefreshKey, setKnowledgeRefreshKey] = useState(0);

  const selectAgent = (name) => {
    setActiveAgent(name);
    setDraft(null);
    setConfirmedSummary(null);
  };

  return (
    <div className="space-y-8 animate-fade-in-up">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Agent Knowledge</h1>
        <p className="max-w-2xl text-base text-ink-secondary">
          Teach an agent from text, links, images, or video — every submission is reviewed and confidence-checked
          against what it already knows before anything is saved. Generate Agent has its own dedicated flow on
          Platform Rules.
        </p>
      </header>

      <LearningCandidatesReview />

      <div role="tablist" aria-label="Agent" className="flex flex-wrap gap-2">
        {TEACHABLE_AGENTS.map((name) => {
          const meta = AGENT_META[name] || { label: name, icon: '🤖' };
          const selected = activeAgent === name;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => selectAgent(name)}
              className={
                selected
                  ? 'rounded-full bg-accent/20 px-3 py-1.5 text-sm font-medium text-accent-bright ring-1 ring-accent/40'
                  : 'rounded-full px-3 py-1.5 text-sm text-ink-secondary hover:bg-panel-sunken'
              }
            >
              <span className="mr-1.5">{meta.icon}</span>
              {meta.label}
            </button>
          );
        })}
      </div>

      <Card as="section" aria-labelledby="knowledge-heading">
        <CardHeader
          title={<span id="knowledge-heading">Current knowledge</span>}
          subtitle={`What ${AGENT_META[activeAgent]?.label || activeAgent} currently knows, global + its own.`}
        />
        <div className="px-5 pb-5 pt-4">
          <CurrentKnowledgeList key={`${activeAgent}-${knowledgeRefreshKey}`} agentName={activeAgent} />
        </div>
      </Card>

      <Card as="section" aria-labelledby="teach-heading">
        <CardHeader title={<span id="teach-heading">Teach it something new</span>} />
        <div className="px-5 pb-5 pt-4">
          {confirmedSummary ? (
            <div className="mb-4 rounded-lg border border-status-good/30 bg-status-good/10 p-3 text-sm text-ink">
              Saved — {confirmedSummary.created.length} new, {confirmedSummary.updated.length} updated,{' '}
              {confirmedSummary.skipped} skipped.
            </div>
          ) : null}

          {draft ? (
            <DraftReview
              agentName={activeAgent}
              draft={draft}
              onDiscard={() => setDraft(null)}
              onConfirmed={(result) => {
                setDraft(null);
                setConfirmedSummary(result);
                setKnowledgeRefreshKey((k) => k + 1);
              }}
            />
          ) : (
            <TeachPanel agentName={activeAgent} onDraft={(d) => { setConfirmedSummary(null); setDraft(d); }} />
          )}
        </div>
      </Card>
    </div>
  );
}
