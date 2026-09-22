// frontend/src/components/settings/IntegrationsSettings.js
/**
 * Manual "test the integration" panel for Google Search Console and SerpAPI.
 *
 * Both are otherwise invisible until something else happens to trigger them —
 * GSC snapshots are only ever created as a side effect of completing an SEO
 * Analyst recommendation (services/agents/outcomeMeasurement.js), and SERP
 * rank checks only ever run from a blog editor. This panel exists purely so
 * an admin can confirm credentials/config actually work end to end (right
 * after a deploy, for example) without needing to set either of those up
 * first. It changes nothing about how either integration is used elsewhere.
 */

import { useCallback, useEffect, useState } from 'react';

import { metaApi, gscApi, serpApi } from '../../lib/api';
import Button from '../ui/Button';
import { Input } from '../ui/form';
import { Card, CardHeader, ErrorBanner, Badge } from '../ui/feedback';

function ConfigBadge({ enabled }) {
  return <Badge tone={enabled ? 'good' : 'neutral'}>{enabled ? 'Enabled' : 'Disabled'}</Badge>;
}

function GscSyncCard({ enabled }) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      setResult(await gscApi.sync({ days: 7 }));
    } catch (err) {
      setError(err);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card as="div">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Google Search Console
            <ConfigBadge enabled={enabled} />
          </span>
        }
        subtitle="Fetches and stores a fresh Search Analytics snapshot right now, so you can confirm the property/credentials actually work."
        action={
          <Button type="button" variant="primary" size="sm" onClick={handleSync} disabled={syncing || !enabled} loading={syncing}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        }
      />
      <div className="space-y-3 px-5 pb-5 pt-2">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        {!enabled && (
          <p className="text-sm text-ink-muted">
            GSC is disabled or misconfigured on this deployment (check <code>GSC_ENABLED</code>,{' '}
            <code>GSC_SITE_URL</code>, <code>GSC_SERVICE_ACCOUNT_KEY</code>).
          </p>
        )}
        {result && (
          <div className="rounded-lg border border-hairline bg-panel-raised/50 px-3 py-2.5 text-sm">
            <p className="font-medium text-ink">
              {result.site_url} · {result.date_range_start} → {result.date_range_end}
            </p>
            <p className="mt-1 text-ink-secondary">
              {result.row_count} rows stored · {result.totals.clicks} clicks · {result.totals.impressions} impressions
            </p>
            <p className="mt-1 text-xs text-ink-faint">Fetched {new Date(result.fetched_at).toLocaleString()}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function SerpTestCard({ enabled }) {
  const [keyword, setKeyword] = useState('astrology consultation');
  const [domain, setDomain] = useState('divinetalk.in');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    setResult(null);
    try {
      setResult(await serpApi.checkRank({ keyword: keyword.trim(), domain: domain.trim() }));
    } catch (err) {
      setError(err);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card as="div">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            SERP (SerpAPI)
            <ConfigBadge enabled={enabled} />
          </span>
        }
        subtitle="Runs one real rank check to confirm the SerpAPI key/connection actually works. Costs one search credit per click."
      />
      <div className="space-y-3 px-5 pb-5 pt-2">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        {!enabled && (
          <p className="text-sm text-ink-muted">
            SerpAPI is disabled (check <code>SERPAPI_ENABLED</code>, <code>SERPAPI_KEY</code>).
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Input
            label="Keyword"
            containerClassName="min-w-[220px] flex-1"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            disabled={testing || !enabled}
          />
          <Input
            label="Domain"
            containerClassName="min-w-[180px] flex-1"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            disabled={testing || !enabled}
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleTest}
            disabled={testing || !enabled || !keyword.trim() || !domain.trim()}
            loading={testing}
          >
            {testing ? 'Checking…' : 'Test connection'}
          </Button>
        </div>
        {result && (
          <div className="rounded-lg border border-hairline bg-panel-raised/50 px-3 py-2.5 text-sm">
            {result.found ? (
              <p className="font-medium text-ink">
                Ranking confirmed — position {result.position} for “{keyword}”.
              </p>
            ) : (
              <p className="font-medium text-ink">
                Connection works, but “{keyword}” wasn't found in the top {result.depth_searched} results for {domain}.
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export default function IntegrationsSettings() {
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setMeta(await metaApi.get());
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section aria-labelledby="integrations-heading" className="space-y-4">
      <div>
        <h2 id="integrations-heading" className="text-lg font-semibold text-ink">
          Search Integrations
        </h2>
        <p className="text-sm text-ink-muted">
          Test Google Search Console and SerpAPI connectivity directly — useful right after a deploy.
        </p>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="grid gap-6 lg:grid-cols-2">
        <GscSyncCard enabled={Boolean(meta?.features?.gsc)} />
        <SerpTestCard enabled={Boolean(meta?.features?.serp_api)} />
      </div>
    </section>
  );
}
