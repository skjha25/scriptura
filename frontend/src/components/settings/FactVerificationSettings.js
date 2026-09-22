// frontend/src/components/settings/FactVerificationSettings.js
/**
 * P6-B: Fact Verification settings — lets an org configure the authoritative
 * sources content generation checks factual claims against. Deliberately
 * NOT hardcoded to any one source (Drik Panchang or otherwise) — every
 * source here is admin-added, tenant/config-driven data (see
 * services/factSources.js's own header comment).
 */

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import { factSourcesApi } from '../../lib/api';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Input, Textarea, Select, Toggle, TagInput } from '../ui/form';
import { Card, CardHeader, ErrorBanner, Skeleton, EmptyState, Badge } from '../ui/feedback';

const SOURCE_TYPE_OPTIONS = [
  { value: 'website', label: 'Website / URL' },
  { value: 'reference_text', label: 'Reference text' },
  { value: 'document', label: 'Uploaded document (.txt, .docx)' },
  { value: 'pdf', label: 'Uploaded PDF' },
];

const SOURCE_TYPE_LABEL = Object.fromEntries(SOURCE_TYPE_OPTIONS.map((o) => [o.value, o.label]));

const POLICY_OPTIONS = [
  { value: 'primary_only', label: 'Primary sources only', hint: 'Verify claims only against sources marked Primary.' },
  { value: 'compare_all', label: 'Compare all configured sources', hint: 'Check every active source, not just Primary ones.' },
  {
    value: 'primary_plus_conflict_warning',
    label: 'Primary source + conflict warning',
    hint: 'Trust Primary sources, but flag it clearly if a Secondary source disagrees.',
  },
];

const CONTENT_STATUS_META = {
  full: { label: 'Readable', tone: 'good' },
  user_provided: { label: 'Readable', tone: 'good' },
  partial: { label: 'Partially readable', tone: 'warning' },
  unavailable: { label: 'Not readable', tone: 'critical' },
};

const emptyForm = { name: '', sourceType: 'website', url: '', referenceText: '', tags: [], priority: 'secondary', active: true, file: null };

function SourceCard({ source, onEdit, onToggleActive, onRemove, removing }) {
  const statusMeta = CONTENT_STATUS_META[source.contentStatus] || { label: source.contentStatus, tone: 'neutral' };
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-lg border border-hairline bg-panel p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-semibold text-ink">{source.name}</p>
            <Badge tone={source.priority === 'primary' ? 'accent' : 'neutral'}>{source.priority === 'primary' ? 'Primary' : 'Secondary'}</Badge>
            <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-ink-faint">
            {SOURCE_TYPE_LABEL[source.sourceType] || source.sourceType}
            {source.url ? ` · ${source.url}` : source.fileName ? ` · ${source.fileName}` : ''}
          </p>
          {source.tags?.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {source.tags.map((tag) => (
                <span key={tag} className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-ink-faint">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Toggle checked={source.active} onChange={() => onToggleActive(source)} />
          <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(source)}>
            Edit
          </Button>
          {confirmingRemove ? (
            <span className="flex items-center gap-1">
              <Button type="button" variant="danger" size="sm" loading={removing} onClick={() => onRemove(source)}>
                Confirm
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingRemove(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingRemove(true)}>
              Remove
            </Button>
          )}
        </div>
      </div>
    </motion.li>
  );
}

function AddEditSourceModal({ open, editing, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setForm(
        editing
          ? { name: editing.name, sourceType: editing.sourceType, url: editing.url || '', referenceText: '', tags: editing.tags || [], priority: editing.priority, active: editing.active, file: null }
          : emptyForm
      );
    }
  }, [open, editing]);

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await factSourcesApi.updateSource(editing.id, { name: form.name, tags: form.tags, priority: form.priority, active: form.active });
      } else if (form.sourceType === 'document' || form.sourceType === 'pdf') {
        if (!form.file) throw new Error('Choose a file to upload.');
        const fd = new FormData();
        fd.append('name', form.name);
        fd.append('source_type', form.sourceType);
        fd.append('priority', form.priority);
        fd.append('active', String(form.active));
        fd.append('tags', JSON.stringify(form.tags));
        fd.append('file', form.file);
        await factSourcesApi.uploadSource(fd);
      } else {
        await factSourcesApi.addSource({
          name: form.name,
          sourceType: form.sourceType,
          url: form.sourceType === 'website' ? form.url : undefined,
          referenceText: form.sourceType === 'reference_text' ? form.referenceText : undefined,
          tags: form.tags,
          priority: form.priority,
          active: form.active,
        });
      }
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const canSubmit =
    form.name.trim() &&
    (editing ||
      (form.sourceType === 'website' && form.url.trim()) ||
      (form.sourceType === 'reference_text' && form.referenceText.trim()) ||
      ((form.sourceType === 'document' || form.sourceType === 'pdf') && form.file));

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title={editing ? 'Edit Fact Source' : 'Add Fact Source'}
      subtitle={editing ? 'Name, tags, priority, and active state only — the source content itself is not re-fetched.' : undefined}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={saving} disabled={!canSubmit} onClick={handleSubmit}>
            {editing ? 'Save Changes' : 'Add Source'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <Input label="Name" value={form.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Drik Panchang" disabled={saving} />

        {!editing ? (
          <Select
            label="Source type"
            value={form.sourceType}
            onChange={(e) => update({ sourceType: e.target.value })}
            options={SOURCE_TYPE_OPTIONS}
            disabled={saving}
          />
        ) : null}

        {!editing && form.sourceType === 'website' ? (
          <Input label="URL" type="url" value={form.url} onChange={(e) => update({ url: e.target.value })} placeholder="https://www.drikpanchang.com" disabled={saving} />
        ) : null}

        {!editing && form.sourceType === 'reference_text' ? (
          <Textarea
            label="Reference text"
            value={form.referenceText}
            onChange={(e) => update({ referenceText: e.target.value })}
            rows={5}
            placeholder="Paste the authoritative text to check claims against…"
            disabled={saving}
          />
        ) : null}

        {!editing && (form.sourceType === 'document' || form.sourceType === 'pdf') ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-secondary" htmlFor="fact-source-file">
              {form.sourceType === 'pdf' ? 'PDF file' : 'Document (.txt or .docx)'}
            </label>
            <input
              id="fact-source-file"
              type="file"
              accept={form.sourceType === 'pdf' ? '.pdf' : '.txt,.docx'}
              onChange={(e) => update({ file: e.target.files?.[0] || null })}
              disabled={saving}
              className="block w-full text-sm text-ink-secondary file:mr-3 file:rounded-lg file:border file:border-hairline file:bg-panel-raised file:px-3 file:py-1.5 file:text-xs file:text-ink hover:file:border-hairline-strong"
            />
            {form.sourceType === 'pdf' ? (
              <p className="mt-1 text-xs text-ink-faint">
                PDFs are stored and listed, but their content can't be read for verification yet — no fabricated confidence.
              </p>
            ) : null}
          </div>
        ) : null}

        <TagInput label="Tags" value={form.tags} onChange={(tags) => update({ tags })} placeholder="e.g. festivals, panchang" />

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Priority"
            value={form.priority}
            onChange={(e) => update({ priority: e.target.value })}
            options={[
              { value: 'primary', label: 'Primary' },
              { value: 'secondary', label: 'Secondary' },
            ]}
            disabled={saving}
          />
          <div className="flex items-end pb-2.5">
            <Toggle label="Active" checked={form.active} onChange={(active) => update({ active })} disabled={saving} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function FactVerificationSettings() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [policySaving, setPolicySaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await factSourcesApi.list());
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setEditingSource(null);
    setModalOpen(true);
  };
  const openEdit = (source) => {
    setEditingSource(source);
    setModalOpen(true);
  };

  const handleToggleActive = async (source) => {
    setData((prev) => ({ ...prev, sources: prev.sources.map((s) => (s.id === source.id ? { ...s, active: !s.active } : s)) }));
    try {
      await factSourcesApi.updateSource(source.id, { active: !source.active });
    } catch (err) {
      setError(err);
      load(); // revert the optimistic flip on failure
    }
  };

  const handleRemove = async (source) => {
    setRemovingId(source.id);
    try {
      await factSourcesApi.removeSource(source.id);
      setData((prev) => ({ ...prev, sources: prev.sources.filter((s) => s.id !== source.id) }));
    } catch (err) {
      setError(err);
    } finally {
      setRemovingId(null);
    }
  };

  const handlePolicyChange = async (policy) => {
    setPolicySaving(true);
    setError(null);
    try {
      await factSourcesApi.updatePolicy(policy);
      setData((prev) => ({ ...prev, policy }));
    } catch (err) {
      setError(err);
    } finally {
      setPolicySaving(false);
    }
  };

  return (
    <Card as="section" aria-labelledby="fact-verification-heading">
      <CardHeader
        title={<span id="fact-verification-heading">Fact Verification</span>}
        subtitle="The authoritative sources Scriptura checks factual claims against during content generation."
        action={
          <Button type="button" variant="primary" size="sm" onClick={openAdd}>
            + Add Source
          </Button>
        }
      />
      <div className="space-y-5 px-5 pb-5 pt-2">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {!data ? (
          <Skeleton rows={3} />
        ) : (
          <>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">Verification policy</p>
              <div className="space-y-2">
                {POLICY_OPTIONS.map((option) => (
                  <label key={option.value} className="flex cursor-pointer items-start gap-2.5 text-sm">
                    <input
                      type="radio"
                      name="fact-verification-policy"
                      className="mt-1 accent-accent"
                      checked={data.policy === option.value}
                      onChange={() => handlePolicyChange(option.value)}
                      disabled={policySaving}
                    />
                    <span>
                      <span className="block text-ink">{option.label}</span>
                      <span className="block text-xs text-ink-muted">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">Sources</p>
              {data.sources.length === 0 ? (
                <EmptyState title="No fact sources yet" message="Add a website, document, or reference text so generation can verify claims against it." />
              ) : (
                <ul className="space-y-2">
                  <AnimatePresence initial={false}>
                    {data.sources.map((source) => (
                      <SourceCard
                        key={source.id}
                        source={source}
                        onEdit={openEdit}
                        onToggleActive={handleToggleActive}
                        onRemove={handleRemove}
                        removing={removingId === source.id}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      <AddEditSourceModal
        open={modalOpen}
        editing={editingSource}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          load();
        }}
      />
    </Card>
  );
}
