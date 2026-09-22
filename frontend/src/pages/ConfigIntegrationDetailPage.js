// frontend/src/pages/ConfigIntegrationDetailPage.js
/**
 * Config detail — one client publish-API integration: endpoint & auth,
 * field-mapping builder, test connection, delivery logs.
 *
 * Field mapping / test connection / delivery logs only apply once the
 * integration exists in the database — a brand-new ("/config/new") form
 * only shows Endpoint & Auth until the first Save, then redirects to
 * `/config/:id` where the rest becomes available. Avoids a parallel
 * "unsaved mappings for a not-yet-existing integration" state.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, RotateCcw } from 'lucide-react';

import { publishingConfigApi } from '../lib/api';
import Button from '../components/ui/Button';
import { Input, Select, SearchableSelect, Toggle } from '../components/ui/form';
import { Badge, Card, CardHeader, ErrorBanner, Skeleton, EmptyState } from '../components/ui/feedback';

const AUTH_TYPE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'api_key', label: 'API Key (custom header)' },
  { value: 'custom_header', label: 'Custom Header' },
];

const REQUEST_FORMAT_OPTIONS = [
  { value: 'json', label: 'JSON body' },
  { value: 'multipart', label: 'Multipart form-data (file upload)' },
];

const emptyIntegrationForm = {
  name: '',
  enabled: false,
  endpoint_url: '',
  test_endpoint_url: '',
  auth_type: 'none',
  auth_header_name: '',
  request_format: 'json',
  max_file_kb: '',
  secret: '',
  response_id_path: '',
  response_url_path: '',
  update_endpoint_url: '',
  update_id_field: '',
};

const STATUS_TONE = { delivered: 'good', failed: 'critical', pending: 'neutral' };

// ---------------------------------------------------------------------------
// Endpoint & Auth
// ---------------------------------------------------------------------------

function EndpointAuthCard({ integration, isNew, onSaved }) {
  const [form, setForm] = useState(() =>
    integration
      ? {
          name: integration.name,
          enabled: integration.enabled,
          endpoint_url: integration.endpoint_url,
          test_endpoint_url: integration.test_endpoint_url || '',
          auth_type: integration.auth_type,
          auth_header_name: integration.auth_header_name || '',
          request_format: integration.request_format || 'json',
          max_file_kb: integration.max_file_kb ?? '',
          secret: '', // write-only — never pre-filled from has_secret
          response_id_path: integration.response_id_path || '',
          response_url_path: integration.response_url_path || '',
          update_endpoint_url: integration.update_endpoint_url || '',
          update_id_field: integration.update_id_field || '',
        }
      : emptyIntegrationForm
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedSecretOnce, setSavedSecretOnce] = useState(false);

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = { ...form };
      if (payload.secret === '') delete payload.secret; // omit -> leave unchanged (update) / unset (create)
      if (payload.test_endpoint_url === '') delete payload.test_endpoint_url;
      if (payload.auth_header_name === '') delete payload.auth_header_name;
      if (payload.response_id_path === '') delete payload.response_id_path;
      if (payload.response_url_path === '') delete payload.response_url_path;
      if (payload.max_file_kb === '') delete payload.max_file_kb;

      const saved = isNew ? await publishingConfigApi.create(payload) : await publishingConfigApi.update(integration.id, payload);
      if (form.secret) setSavedSecretOnce(true);
      onSaved(saved);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card as="section" aria-labelledby="endpoint-auth-heading">
      <CardHeader
        title={<span id="endpoint-auth-heading">Endpoint &amp; Authentication</span>}
        subtitle="The client's own POST API — where a published blog gets delivered."
        action={
          <Toggle
            label="Enabled"
            checked={form.enabled}
            onChange={(enabled) => update({ enabled })}
          />
        }
      />
      <div className="space-y-4 px-5 pb-5 pt-2">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <Input label="Name" required value={form.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. DivineTalk" />
        <Input
          label="Endpoint URL"
          required
          value={form.endpoint_url}
          onChange={(e) => update({ endpoint_url: e.target.value })}
          placeholder="https://client-domain.com/api/blog/publish"
          hint="Must be https — this is where real published-blog payloads (and the configured credential) are sent."
        />
        <Input
          label="Test endpoint URL (optional)"
          value={form.test_endpoint_url}
          onChange={(e) => update({ test_endpoint_url: e.target.value })}
          placeholder="Leave empty to send Test Connection to the real endpoint above"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Update endpoint URL (optional)"
            value={form.update_endpoint_url}
            onChange={(e) => update({ update_endpoint_url: e.target.value })}
            placeholder="https://client-domain.com/api/blog/update"
            hint="Republishing a blog that was already delivered goes here instead of creating a duplicate. Needs Post ID path (Advanced) set, so the client's post id is captured on first delivery."
          />
          <Input
            label="Update ID field (optional)"
            value={form.update_id_field}
            onChange={(e) => update({ update_id_field: e.target.value })}
            placeholder="id"
            hint="Request field the client's post id is sent under on update. Empty = id."
          />
        </div>

        <Select
          label="Request format"
          options={REQUEST_FORMAT_OPTIONS}
          value={form.request_format}
          onChange={(e) => update({ request_format: e.target.value })}
          hint="Use Multipart form-data if the client's API requires an actual uploaded file (e.g. a Laravel `image` validation rule) — a field mapped to Featured Image is then fetched and attached as a real file instead of a URL string."
        />
        {form.request_format === 'multipart' && (
          <Input
            label="Max file size for the uploaded image (KB, optional)"
            type="number"
            min="1"
            value={form.max_file_kb}
            onChange={(e) => update({ max_file_kb: e.target.value })}
            placeholder="e.g. 2048"
            hint="Scriptura's generated images run ~2.7MB — if the client's endpoint enforces a size limit (e.g. Laravel's `max:2048`), set it here and the image is compressed to fit before sending. Leave blank if the client has no limit."
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Authentication"
            options={AUTH_TYPE_OPTIONS}
            value={form.auth_type}
            onChange={(e) => update({ auth_type: e.target.value })}
          />
          {(form.auth_type === 'api_key' || form.auth_type === 'custom_header') && (
            <Input
              label="Header name"
              value={form.auth_header_name}
              onChange={(e) => update({ auth_header_name: e.target.value })}
              placeholder="X-Api-Key"
            />
          )}
        </div>

        {form.auth_type !== 'none' && (
          <Input
            label={integration?.has_secret || savedSecretOnce ? 'Credential (configured — leave blank to keep it)' : 'Credential'}
            type="password"
            value={form.secret}
            onChange={(e) => update({ secret: e.target.value })}
            placeholder={integration?.has_secret || savedSecretOnce ? '••••••••  (unchanged)' : 'Paste the token/API key'}
            hint="Encrypted at rest. Never shown again after saving — leave blank on edit to keep the existing one."
          />
        )}

        <details className="rounded-lg border border-hairline px-3 py-2.5">
          <summary className="cursor-pointer text-xs font-medium text-ink-secondary">Advanced — response field extraction</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Input
              label="Post ID path (optional)"
              value={form.response_id_path}
              onChange={(e) => update({ response_id_path: e.target.value })}
              placeholder="e.g. post.id"
              hint="Dot-path into the client's JSON response, shown in delivery logs."
            />
            <Input
              label="Post URL path (optional)"
              value={form.response_url_path}
              onChange={(e) => update({ response_url_path: e.target.value })}
              placeholder="e.g. post.url"
            />
          </div>
        </details>

        <div className="flex justify-end">
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={saving || !form.name.trim() || !form.endpoint_url.trim()}>
            {isNew ? 'Create Integration' : 'Save'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Field Mapping builder
// ---------------------------------------------------------------------------

function FieldMappingRow({ mapping, availableFields, onChange, onRemove, onMove, isFirst, isLast }) {
  return (
    <div className="grid grid-cols-1 gap-2 rounded-lg border border-hairline bg-panel-raised/40 p-3 sm:grid-cols-[1fr_auto_1fr_auto_auto]">
      <Input
        label="Client field"
        value={mapping.client_field}
        onChange={(e) => onChange({ ...mapping, client_field: e.target.value })}
        placeholder="e.g. title or post.title"
      />
      <Select
        label="Source"
        options={[
          { value: 'field', label: 'Scriptura field' },
          { value: 'static', label: 'Static value' },
        ]}
        value={mapping.source_type}
        onChange={(e) => onChange({ ...mapping, source_type: e.target.value })}
      />
      {mapping.source_type === 'field' ? (
        <SearchableSelect
          label="Value"
          placeholder="Select a field…"
          searchPlaceholder="Search Scriptura fields…"
          options={availableFields.map((f) => ({ value: f.value, label: f.label, category: f.category }))}
          value={mapping.scriptura_field || ''}
          onChange={(scriptura_field) => onChange({ ...mapping, scriptura_field })}
        />
      ) : (
        <Input
          label="Static value"
          value={mapping.static_value || ''}
          onChange={(e) => onChange({ ...mapping, static_value: e.target.value })}
          placeholder="e.g. published"
        />
      )}
      <div className="flex flex-col items-start gap-1.5 sm:items-center sm:justify-center">
        <span className="text-xs font-medium text-ink-secondary">Required</span>
        <Toggle checked={Boolean(mapping.is_required)} onChange={(is_required) => onChange({ ...mapping, is_required })} />
      </div>
      <div className="flex items-end gap-1 sm:items-center">
        <Button type="button" variant="ghost" size="sm" onClick={() => onMove(-1)} disabled={isFirst} aria-label="Move up">
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onMove(1)} disabled={isLast} aria-label="Move down">
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label="Remove field">
          <Trash2 className="h-3.5 w-3.5 text-status-critical" />
        </Button>
      </div>
    </div>
  );
}

function FieldMappingCard({ integrationId }) {
  const [mappings, setMappings] = useState(null);
  const [availableFields, setAvailableFields] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [integration, fields] = await Promise.all([
        publishingConfigApi.get(integrationId),
        publishingConfigApi.availableFields(),
      ]);
      setMappings(integration.field_mappings || []);
      setAvailableFields(fields);
    } catch (err) {
      setError(err);
    }
  }, [integrationId]);

  useEffect(() => {
    load();
  }, [load]);

  const addRow = () => {
    setMappings((prev) => [...prev, { client_field: '', source_type: 'field', scriptura_field: '', static_value: '', is_required: false }]);
    setSaved(false);
  };
  const updateRow = (i, next) => {
    setMappings((prev) => prev.map((m, idx) => (idx === i ? next : m)));
    setSaved(false);
  };
  const removeRow = (i) => {
    setMappings((prev) => prev.filter((_, idx) => idx !== i));
    setSaved(false);
  };
  const moveRow = (i, dir) => {
    setMappings((prev) => {
      const next = [...prev];
      const target = i + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[i], next[target]] = [next[target], next[i]];
      return next;
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Only the fields the API accepts — `mappings` here is reused straight
      // from the GET response shape (serializeFieldMapping), which also
      // carries `id` and a DB-null `static_value` for field-type rows.
      // Sending those back verbatim fails the strict validator (`id` is an
      // unrecognized key; `static_value` must be a string or omitted, never
      // `null`) — never caught before because every prior test wrote
      // mappings straight to the DB, bypassing this save path entirely.
      const withOrder = mappings.map((m, i) => ({
        client_field: m.client_field,
        source_type: m.source_type,
        scriptura_field: m.source_type === 'field' ? m.scriptura_field || undefined : undefined,
        static_value: m.source_type === 'static' ? m.static_value ?? '' : undefined,
        is_required: Boolean(m.is_required),
        sort_order: i,
      }));
      const updated = await publishingConfigApi.replaceFieldMappings(integrationId, withOrder);
      setMappings(updated.field_mappings || []);
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card as="section" aria-labelledby="field-mapping-heading">
      <CardHeader
        title={<span id="field-mapping-heading">Publishing Payload</span>}
        subtitle="Which fields the client's API expects, and where each value comes from."
        action={
          <Button type="button" variant="ghost" size="sm" onClick={addRow} disabled={!mappings}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            Add Field
          </Button>
        }
      />
      <div className="space-y-3 px-5 pb-5 pt-2">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        {saved && <p className="text-xs text-status-good">Saved.</p>}

        {!mappings ? (
          <Skeleton rows={3} />
        ) : mappings.length === 0 ? (
          <EmptyState title="No fields mapped yet" message="Click “Add Field” to tell Scriptura what the client's API expects." />
        ) : (
          <div className="space-y-2">
            {mappings.map((m, i) => (
              <FieldMappingRow
                key={i}
                mapping={m}
                availableFields={availableFields}
                onChange={(next) => updateRow(i, next)}
                onRemove={() => removeRow(i)}
                onMove={(dir) => moveRow(i, dir)}
                isFirst={i === 0}
                isLast={i === mappings.length - 1}
              />
            ))}
          </div>
        )}

        {mappings && mappings.length > 0 && (
          <div className="flex justify-end">
            <Button variant="primary" onClick={handleSave} loading={saving} disabled={saving}>
              Save Mapping
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Test Connection
// ---------------------------------------------------------------------------

function TestConnectionCard({ integration }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [confirmingRealRequest, setConfirmingRealRequest] = useState(false);

  const runTest = async () => {
    setTesting(true);
    setError(null);
    setResult(null);
    setConfirmingRealRequest(false);
    try {
      setResult(await publishingConfigApi.testConnection(integration.id, {}));
    } catch (err) {
      setError(err);
    } finally {
      setTesting(false);
    }
  };

  const hasTestEndpoint = Boolean(integration.test_endpoint_url);

  return (
    <Card as="section" aria-labelledby="test-connection-heading">
      <CardHeader
        title={<span id="test-connection-heading">Test Connection</span>}
        subtitle={
          hasTestEndpoint
            ? 'Sends a real request to the configured test endpoint with a synthetic sample payload.'
            : "No test endpoint is configured — this will send a real request to the production endpoint above."
        }
      />
      <div className="space-y-3 px-5 pb-5 pt-2">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {!hasTestEndpoint && !confirmingRealRequest ? (
          <Button variant="secondary" onClick={() => setConfirmingRealRequest(true)}>
            Test Connection…
          </Button>
        ) : !hasTestEndpoint && confirmingRealRequest ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-ink-secondary">This sends a real test payload to the production endpoint. Continue?</p>
            <Button variant="danger" size="sm" loading={testing} onClick={runTest}>
              Send real request
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingRealRequest(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="secondary" loading={testing} onClick={runTest}>
            Test Connection
          </Button>
        )}

        {result && (
          <div className="rounded-lg border border-hairline bg-panel-raised/50 px-3 py-2.5 text-sm">
            <p className="font-medium text-ink">
              {result.success ? '✓ Success' : '✗ Failed'} — HTTP {result.http_status ?? '—'} ({result.used_test_endpoint ? 'test endpoint' : 'production endpoint'})
            </p>
            {result.error && <p className="mt-1 text-status-critical">{result.error}</p>}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-ink-faint">Payload sent</summary>
              <pre className="mt-1 max-h-64 overflow-auto rounded bg-panel-sunken p-2 text-xs text-ink-secondary">
                {JSON.stringify(result.payload_preview, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Delivery Logs
// ---------------------------------------------------------------------------

function DeliveryLogsCard({ integrationId }) {
  const [logs, setLogs] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [retryingId, setRetryingId] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await publishingConfigApi.deliveryLogs(integrationId, { page, limit: 10 });
      setLogs(result.data);
      setPagination(result.pagination);
    } catch (err) {
      setError(err);
    }
  }, [integrationId, page]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRetry = async (logId) => {
    setRetryingId(logId);
    setError(null);
    try {
      await publishingConfigApi.retryDelivery(logId);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <Card as="section" aria-labelledby="delivery-logs-heading">
      <CardHeader title={<span id="delivery-logs-heading">Delivery Logs</span>} subtitle="Every attempt to deliver a published blog to this endpoint." />
      <div className="space-y-2 px-5 pb-5 pt-2">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {!logs ? (
          <Skeleton rows={3} />
        ) : logs.length === 0 ? (
          <EmptyState title="No deliveries yet" message="This integration hasn't received a published blog yet." />
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[log.status] || 'neutral'}>{log.status}</Badge>
                    <Badge tone="neutral">{log.delivery_mode === 'update' ? 'update' : 'create'}</Badge>
                    {log.http_status &&<span className="text-xs text-ink-faint">HTTP {log.http_status}</span>}
                    <span className="text-xs text-ink-faint">Attempt {log.attempt_number}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    Blog #{log.blog_id} · {new Date(log.created_at).toLocaleString()}
                  </p>
                  {log.error && <p className="mt-1 text-xs text-status-critical">{log.error}</p>}
                </div>
                {log.status === 'failed' && (
                  <Button variant="ghost" size="sm" loading={retryingId === log.id} onClick={() => handleRetry(log.id)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {pagination && pagination.total_pages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" size="sm" disabled={!pagination.has_prev} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-xs text-ink-faint">
              Page {pagination.page} of {pagination.total_pages}
            </span>
            <Button variant="ghost" size="sm" disabled={!pagination.has_next} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ConfigIntegrationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [integration, setIntegration] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    setError(null);
    try {
      setIntegration(await publishingConfigApi.get(id));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaved = (saved) => {
    if (isNew) {
      navigate(`/config/${saved.id}`, { replace: true });
      return;
    }
    setIntegration(saved);
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <Link to="/config" className="inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-ink">
        <ArrowLeft className="h-4 w-4" />
        Back to Config
      </Link>

      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {isNew ? 'Add Integration' : integration?.name || 'Integration'}
        </h1>
      </header>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {loading ? (
        <Skeleton rows={5} />
      ) : (
        <div className="space-y-6">
          <EndpointAuthCard integration={integration} isNew={isNew} onSaved={handleSaved} />
          {!isNew && integration && (
            <>
              <FieldMappingCard integrationId={integration.id} />
              <TestConnectionCard integration={integration} />
              <DeliveryLogsCard integrationId={integration.id} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
