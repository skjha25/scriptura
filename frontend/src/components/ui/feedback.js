/**
 * Presentational primitives: cards, badges, banners, empty and loading states.
 */

import clsx from 'clsx';
import { BLOG_STATUS_META, GENERATION_STATUS_META } from '../../lib/constants';

export function Card({ children, className = '', glow = false, interactive = true, as: Component = 'div', ...rest }) {
  return (
    <Component
      className={clsx(
        'rounded-xl border border-white/5 bg-panel/60 backdrop-blur-2xl shadow-panel',
        'transition-all duration-500 ease-out',
        interactive && 'hover:-translate-y-1 hover:border-white/10 hover:shadow-glow-sm',
        glow && 'shadow-glow-sm border-accent/25',
        className
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}

export function CardHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={clsx('flex items-start justify-between gap-4 px-5 pt-5', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * Headline metric.
 *
 * `delta` is rendered with an arrow glyph *and* a colour, never colour alone — a
 * red number with no other cue is invisible to a colourblind reader.
 */
export function StatTile({ label, value, delta, deltaLabel, hint, icon, className = '' }) {
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
  const positive = hasDelta && delta > 0;
  const negative = hasDelta && delta < 0;

  return (
    <Card className={clsx('p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
        {icon ? (
          <span aria-hidden="true" className="text-accent/70">
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-3xl font-semibold leading-none text-ink">
        {value === null || value === undefined ? (
          // An em dash rather than 0: "no data" and "zero" are different facts,
          // and showing 0 for a missing average is a quiet lie.
          <span className="text-ink-faint">—</span>
        ) : (
          value
        )}
      </p>
      {hasDelta ? (
        <p
          className={clsx(
            'mt-2 flex items-center gap-1 text-xs',
            positive && 'text-status-good',
            negative && 'text-status-critical',
            !positive && !negative && 'text-ink-muted'
          )}
        >
          <span aria-hidden="true">{positive ? '↑' : negative ? '↓' : '→'}</span>
          <span>
            {Math.abs(delta)}
            {deltaLabel ? ` ${deltaLabel}` : ''}
          </span>
        </p>
      ) : hint ? (
        <p className="mt-2 text-xs text-ink-muted">{hint}</p>
      ) : null}
    </Card>
  );
}

/** Generic pill. */
export function Badge({ children, className = '', tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-ink-faint/15 text-ink-secondary border-hairline',
    accent: 'bg-accent/15 text-accent-bright border-accent/30',
    good: 'bg-status-good/15 text-status-good border-status-good/30',
    warning: 'bg-status-warning/15 text-status-warning border-status-warning/30',
    serious: 'bg-status-serious/15 text-status-serious border-status-serious/30',
    critical: 'bg-status-critical/15 text-status-critical border-status-critical/30',
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
        tones[tone] || tones.neutral,
        className
      )}
    >
      {children}
    </span>
  );
}

/** Publish-state chip. Always carries its text label, never colour alone. */
export function StatusBadge({ status, className = '' }) {
  const meta = BLOG_STATUS_META[status] || BLOG_STATUS_META[0];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
        meta.chip,
        className
      )}
    >
      {meta.label}
    </span>
  );
}

/**
 * Generation-state chip, with a pulsing dot while work is in flight so the state
 * reads as "moving" rather than "stuck".
 */
export function GenerationBadge({ status, className = '' }) {
  const meta = GENERATION_STATUS_META[status];
  if (!meta) return null;

  const inFlight = status === 'queued' || status === 'generating';
  const tone =
    meta.tone === 'good'
      ? 'good'
      : meta.tone === 'critical'
        ? 'critical'
        : meta.tone === 'accent'
          ? 'accent'
          : 'neutral';

  return (
    <Badge tone={tone} className={className}>
      {inFlight ? (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-current"
        />
      ) : null}
      {meta.label}
    </Badge>
  );
}

/**
 * Error banner.
 *
 * `role="alert"` so it is announced immediately. Field-level validation errors
 * are listed out, because "Request validation failed" alone tells the user
 * nothing actionable.
 */
export function ErrorBanner({ error, onRetry, onDismiss, className = '' }) {
  if (!error) return null;

  const fieldErrors = error.fieldErrors
    ? Object.entries(error.fieldErrors).flatMap(([field, messages]) =>
        messages.map((message) => `${field.replace(/^body\.|^query\.|^params\./, '')}: ${message}`)
      )
    : [];

  return (
    <div
      role="alert"
      className={clsx(
        'rounded-lg border border-status-critical/40 bg-status-critical/10 px-4 py-3',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 text-status-critical">
          ⚠
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink">{error.message || 'Something went wrong.'}</p>
          {fieldErrors.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-ink-secondary">
              {fieldErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
          {error.retryAfterSeconds ? (
            <p className="mt-2 text-xs text-ink-muted">
              Try again in about {error.retryAfterSeconds} seconds.
            </p>
          ) : null}
          {(onRetry || onDismiss) && (
            <div className="mt-3 flex gap-2">
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="text-xs font-medium text-accent-bright hover:underline"
                >
                  Try again
                </button>
              ) : null}
              {onDismiss ? (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="text-xs text-ink-muted hover:text-ink"
                >
                  Dismiss
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Non-error informational note. */
export function InfoBanner({ children, tone = 'accent', className = '' }) {
  const tones = {
    accent: 'border-accent/30 bg-accent/10',
    warning: 'border-status-warning/40 bg-status-warning/10',
    neutral: 'border-hairline bg-panel-raised',
  };
  return (
    <div className={clsx('rounded-lg border px-4 py-3 text-sm text-ink-secondary', tones[tone], className)}>
      {children}
    </div>
  );
}

/** Empty state with a single clear next action. */
export function EmptyState({ title, message, action, icon, className = '' }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      {icon ? (
        <div aria-hidden="true" className="mb-4 text-4xl text-accent/40">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {message ? <p className="mt-1.5 max-w-md text-sm text-ink-muted">{message}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/**
 * Loading placeholder.
 *
 * Shaped like the content it replaces, so the layout does not jump when real data
 * arrives. `aria-hidden` because the surrounding region carries `aria-busy`.
 */
export function Skeleton({ className = '', rows = 1 }) {
  if (rows === 1) return <div aria-hidden="true" className={clsx('skeleton h-4', className)} />;
  return (
    <div aria-hidden="true" className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          // eslint-disable-next-line react/no-array-index-key -- position is the identity
          key={index}
          className={clsx(
            'skeleton h-4',
            // The last line is short, the way a real paragraph ends.
            index === rows - 1 ? 'w-2/3' : 'w-full',
            className
          )}
        />
      ))}
    </div>
  );
}

/**
 * 0–100 SEO score with a label and a bar.
 *
 * The band colours come from the reserved status palette, and the numeric score
 * is always shown — the colour is reinforcement, not the only signal.
 */
export function ScoreMeter({ score, size = 'md', showLabel = true, className = '' }) {
  if (score === null || score === undefined) {
    return <span className={clsx('text-xs text-ink-faint', className)}>Not scored</span>;
  }

  const clamped = Math.max(0, Math.min(100, Number(score)));
  const band =
    clamped >= 80
      ? { color: 'bg-status-good', text: 'text-status-good', label: 'Strong' }
      : clamped >= 60
        ? { color: 'bg-status-warning', text: 'text-status-warning', label: 'Fair' }
        : clamped >= 40
          ? { color: 'bg-status-serious', text: 'text-status-serious', label: 'Weak' }
          : { color: 'bg-status-critical', text: 'text-status-critical', label: 'Poor' };

  const height = size === 'sm' ? 'h-1' : 'h-1.5';

  return (
    <div className={clsx('min-w-0', className)}>
      {showLabel ? (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className={clsx('text-xs font-semibold tabular', band.text)}>{clamped}/100</span>
          <span className="text-[11px] text-ink-muted">{band.label}</span>
        </div>
      ) : null}
      <div
        className={clsx('w-full overflow-hidden rounded-full bg-panel-sunken', height)}
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`SEO score ${clamped} out of 100 (${band.label})`}
      >
        <div
          className={clsx('h-full rounded-full transition-all duration-500', band.color)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
