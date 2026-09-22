// frontend/src/pages/ConfigPage.js
/**
 * Config — client publish-API integrations list. Each row is a client's
 * external POST endpoint + credentials + field mapping; publishing a blog
 * delivers to every enabled row automatically (backend/src/services/delivery).
 *
 * List + detail by design, not a single-config screen — new clients are
 * expected soon, and this avoids a rework when the second one arrives.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ArrowRight } from 'lucide-react';

import { publishingConfigApi } from '../lib/api';
import Button from '../components/ui/Button';
import { Badge, Card, EmptyState, ErrorBanner, Skeleton } from '../components/ui/feedback';

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function IntegrationCard({ integration }) {
  return (
    <Link to={`/config/${integration.id}`} className="block">
      <Card as="div" className="transition-colors hover:border-hairline-strong">
        <div className="flex items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-ink">{integration.name}</p>
              <Badge tone={integration.enabled ? 'good' : 'neutral'}>{integration.enabled ? 'Enabled' : 'Disabled'}</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-ink-faint">{hostOf(integration.endpoint_url)}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {integration.field_mappings?.length ?? 0} mapped field{integration.field_mappings?.length === 1 ? '' : 's'} ·{' '}
              {integration.auth_type === 'none' ? 'No auth' : integration.has_secret ? 'Credential configured' : 'Credential not set'}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
        </div>
      </Card>
    </Link>
  );
}

export default function ConfigPage() {
  const [integrations, setIntegrations] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setIntegrations(await publishingConfigApi.list());
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-8 animate-fade-in-up">
      <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Config</h1>
          <p className="max-w-2xl text-base text-ink-secondary">
            Client publish-API integrations. When a blog is published, Scriptura also delivers it to every
            enabled endpoint below — automatically, including from Autopilot.
          </p>
        </div>
        <Button as={Link} to="/config/new" variant="primary">
          <Plus className="h-4 w-4" strokeWidth={2} />
          Add Integration
        </Button>
      </header>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {!integrations ? (
        <Skeleton rows={3} />
      ) : integrations.length === 0 ? (
        <EmptyState
          title="No integrations yet"
          message="Add a client's POST endpoint, credentials, and field mapping to start delivering published blogs automatically."
          action={
            <Button as={Link} to="/config/new" variant="primary">
              <Plus className="h-4 w-4" strokeWidth={2} />
              Add Integration
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {integrations.map((integration) => (
            <IntegrationCard key={integration.id} integration={integration} />
          ))}
        </div>
      )}
    </div>
  );
}
