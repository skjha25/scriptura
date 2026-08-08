// frontend/src/components/wizard/InternalLinkPicker.js
/**
 * Picker for internal-link targets.
 *
 * Searches published articles via `blogsApi.linkable`, which excludes drafts (a
 * link to an unpublished article is a 404 for the reader) and excludes the article
 * being written (nothing should link to itself).
 *
 * The chosen targets are rendered from `internal_link_targets` rather than from the
 * search results, so a selection made under one search term stays visible and
 * removable after the term changes. Without that, an author who picks two articles
 * and then searches for a third appears to have lost the first two.
 */

import { useEffect, useState } from 'react';

import { blogsApi } from '../../lib/api';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { Checkbox, Input } from '../ui/form';
import { Badge, ErrorBanner, Skeleton } from '../ui/feedback';

export default function InternalLinkPicker({ selected = [], onChange, excludeId }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [chosen, setChosen] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const debouncedQuery = useDebouncedValue(query, 350);

  useEffect(() => {
    let cancelled = false;

    async function search() {
      setLoading(true);
      setError(null);
      try {
        const data = await blogsApi.linkable({
          q: debouncedQuery || undefined,
          exclude_id: excludeId || undefined,
        });
        if (!cancelled) setResults(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    search();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, excludeId]);

  /**
   * Remembers the title of anything selected, so a chip can name the article even
   * once it has fallen out of the current result set.
   */
  useEffect(() => {
    setChosen((previous) => {
      const known = new Map(previous.map((entry) => [entry.id, entry]));
      results.forEach((row) => known.set(row.id, { id: row.id, blog_title: row.blog_title }));
      return selected
        .map((id) => known.get(id) || { id, blog_title: `Article #${id}` })
        .filter(Boolean);
    });
  }, [selected, results]);

  function toggle(id, checked) {
    onChange(checked ? [...selected, id] : selected.filter((entry) => entry !== id));
  }

  return (
    <div className="space-y-3">
      <Input
        label="Search published articles"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="retrograde, sawan, mangal dosha…"
        hint="Only published articles can be linked to."
      />

      {chosen.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((entry) => (
            <Badge key={entry.id} tone="accent">
              <span className="max-w-[16rem] truncate">{entry.blog_title}</span>
              <button
                type="button"
                onClick={() => toggle(entry.id, false)}
                aria-label={`Remove ${entry.blog_title} from link targets`}
                className="text-brand/70 hover:text-ink"
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div
        className="max-h-64 overflow-y-auto rounded-lg border border-hairline bg-panel-sunken p-3"
        aria-busy={loading}
      >
        {loading && results.length === 0 ? (
          <Skeleton rows={4} />
        ) : results.length === 0 ? (
          <p className="py-3 text-center text-xs text-ink-muted">
            {debouncedQuery
              ? `No published articles match "${debouncedQuery}".`
              : 'No published articles to link to yet.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {results.map((row) => (
              <li key={row.id}>
                <Checkbox
                  label={
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink">{row.blog_title}</span>
                      {row.topic ? (
                        <span className="block truncate text-[11px] text-ink-muted">{row.topic}</span>
                      ) : null}
                    </span>
                  }
                  checked={selected.includes(row.id)}
                  onChange={(checked) => toggle(row.id, checked)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-ink-muted">
        {selected.length} selected. The generator weaves them in where they fit; it will not force a
        link that does not belong.
      </p>
    </div>
  );
}
