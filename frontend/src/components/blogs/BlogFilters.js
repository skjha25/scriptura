/**
 * Toolbar for the blog list: search, filters, sort and the grid/table switch.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A DUMB COMPONENT
 * ---------------------------------------------------------------------------
 * Every value here lives in the URL (see BlogListPage), not in this component. It
 * receives the parsed filter object and emits patches. That is what makes a
 * filtered view shareable and refresh-proof, and it keeps one source of truth —
 * local state mirroring the URL is how a "clear filters" button ends up clearing
 * the query string while leaving the checkboxes ticked.
 *
 * The search box is the single exception: its raw keystrokes are owned by the page
 * so they can be debounced before they reach the URL.
 */

import clsx from 'clsx';

import {
  BLOG_STATUS,
  BLOG_STATUS_LABELS,
  BLOG_STATUS_META,
  GENERATION_STATUS,
  GENERATION_STATUS_META,
} from '../../lib/constants';
import Button from '../ui/Button';
import { Input, Select, Toggle, Checkbox } from '../ui/form';

/**
 * Status filter values are the *labels*, not the numeric codes.
 *
 * The API accepts either (`status=draft,scheduled` or `status=0,2`), and a URL
 * reading `status=draft,scheduled` is legible to whoever it gets pasted to.
 */
const STATUS_SELECT_OPTIONS = [
  { value: '', label: 'Any status' },
  ...Object.values(BLOG_STATUS).map((code) => ({
    value: BLOG_STATUS_LABELS[code],
    label: BLOG_STATUS_META[code].label,
  })),
];

const GENERATION_FILTERS = [
  { value: '', label: 'Any generation state' },
  ...Object.values(GENERATION_STATUS).map((value) => ({
    value,
    label: GENERATION_STATUS_META[value].label,
  })),
];

/**
 * Sortable columns, mirroring the backend's allow-list. Anything else is rejected
 * with a 422, so the UI must not offer it.
 */
export const SORT_OPTIONS = [
  { value: 'created_at', label: 'Date created' },
  { value: 'updated_at', label: 'Last updated' },
  { value: 'publish_date', label: 'Publish date' },
  { value: 'blog_title', label: 'Title' },
  { value: 'total_views', label: 'Views' },
  { value: 'seo_score', label: 'SEO score' },
  { value: 'word_count', label: 'Word count' },
];

const TOGGLE_BUTTON =
  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none';

export default function BlogFilters({
  filters,
  searchInput,
  onSearchInput,
  onChange,
  onClear,
  view,
  onViewChange,
  categories = [],
  isAdmin = false,
  hasActiveFilters = false,
}) {
  // The active category is unioned in so a filter arriving from a shared URL still
  // has a matching option to select, even if that category is not on this page.
  const categoryOptions = [
    { value: '', label: 'All categories' },
    ...(filters.category && !categories.includes(filters.category)
      ? [{ value: filters.category, label: filters.category }]
      : []),
    ...categories.map((category) => ({ value: category, label: category })),
  ];

  return (
    <div className="space-y-4 rounded-xl border border-hairline bg-panel p-4 shadow-panel sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Input
          label="Search"
          type="search"
          value={searchInput}
          onChange={(event) => onSearchInput(event.target.value)}
          placeholder="Title, topic or keyword..."
          containerClassName="w-full sm:w-72 max-w-xs"
        />

        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-ink-secondary">View</span>
          <div
            role="group"
            aria-label="View mode"
            className="inline-flex shrink-0 gap-0.5 rounded-lg border border-hairline bg-panel-sunken p-1"
          >
            {[
              { key: 'grid', label: 'Grid' },
              { key: 'table', label: 'Table' },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={view === option.key}
                onClick={() => onViewChange(option.key)}
                className={clsx(
                  TOGGLE_BUTTON,
                  view === option.key
                    ? 'bg-panel-raised text-ink'
                    : 'text-ink-muted hover:text-ink-secondary'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Select
          label="Status"
          value={filters.status[0] || ''}
          onChange={(event) => onChange({ status: event.target.value ? [event.target.value] : [] })}
          options={STATUS_SELECT_OPTIONS}
        />

        <div className="sr-only">
          {Object.values(BLOG_STATUS).map((code) => {
            const label = BLOG_STATUS_LABELS[code];
            const title = BLOG_STATUS_META[code].label;
            const isChecked = filters.status.includes(label);
            return (
              <input
                key={label}
                type="checkbox"
                aria-label={title}
                checked={isChecked}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...filters.status, label]
                    : filters.status.filter((s) => s !== label);
                  onChange({ status: next });
                }}
              />
            );
          })}
        </div>

        <Select
          label="Category"
          value={filters.category}
          onChange={(event) => onChange({ category: event.target.value })}
          options={categoryOptions}
          hint="Categories seen so far in this session."
        />

        <Select
          label="Generation state"
          value={filters.generationStatus}
          onChange={(event) => onChange({ generationStatus: event.target.value })}
          options={GENERATION_FILTERS}
        />

        <div className="flex items-start gap-2">
          <Select
            label="Sort by"
            value={filters.sort}
            onChange={(event) => onChange({ sort: event.target.value })}
            options={SORT_OPTIONS}
            containerClassName="min-w-0 flex-1"
          />
          <Button
            size="sm"
            variant="secondary"
            className="mt-[1.55rem] shrink-0"
            onClick={() => onChange({ order: filters.order === 'ASC' ? 'DESC' : 'ASC' })}
            aria-label={`Reverse sort direction. Currently ${
              filters.order === 'ASC' ? 'ascending' : 'descending'
            }.`}
          >
            <span aria-hidden="true">{filters.order === 'ASC' ? '↑' : '↓'}</span>
            {filters.order === 'ASC' ? 'Asc' : 'Desc'}
          </Button>
        </div>
      </div>

      {isAdmin || hasActiveFilters ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
          {/* Deleted rows are only fetchable with include_deleted, which the API
              ignores for editors — so the control only exists for an admin. */}
          {isAdmin ? (
            <Toggle
              label="Include deleted"
              hint="Shows soft-deleted articles so they can be restored."
              checked={filters.includeDeleted}
              onChange={(checked) => onChange({ includeDeleted: checked })}
            />
          ) : (
            <span />
          )}
          {hasActiveFilters ? (
            <Button size="sm" variant="ghost" onClick={onClear}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
