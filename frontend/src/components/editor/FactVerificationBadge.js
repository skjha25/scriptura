// frontend/src/components/editor/FactVerificationBadge.js
/**
 * P6-B Part 13: surfaces the real fact-verification result (blog.fact_verification,
 * written by generation.js's factVerification.verifyBlocks) in the editor header.
 * Renders nothing when verification never ran — a missing result must never
 * be shown as "verified".
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { Badge } from '../ui/feedback';

const STATUS_META = {
  verified: { label: '✓ Facts Verified', tone: 'good' },
  conflict: { label: '⚠ Fact Conflict', tone: 'critical' },
  unverified: { label: 'Facts Unverified', tone: 'warning' },
};

export default function FactVerificationBadge({ factVerification }) {
  const [open, setOpen] = useState(false);

  if (!factVerification || !STATUS_META[factVerification.status]) return null;
  const meta = STATUS_META[factVerification.status];
  const claims = factVerification.claims || [];

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="cursor-pointer">
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full z-20 mt-2 w-80 rounded-lg border border-hairline bg-panel-raised p-3 shadow-panel"
          >
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
              Fact verification · {factVerification.policy?.replace(/_/g, ' ')}
            </p>
            {claims.length === 0 ? (
              <p className="text-xs text-ink-muted">
                {factVerification.reason === 'verification_failed'
                  ? 'Verification could not run for this generation.'
                  : 'No checkable claims were found in this article.'}
              </p>
            ) : (
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {claims.map((c, i) => (
                  <li key={i} className="rounded-md border border-hairline bg-panel px-2.5 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-ink">{c.claim}</p>
                      <Badge tone={STATUS_META[c.status]?.tone || 'neutral'} className="shrink-0">
                        {c.status}
                      </Badge>
                    </div>
                    {c.sourceName ? <p className="mt-1 text-[11px] text-ink-faint">Source: {c.sourceName}</p> : null}
                    {c.conflictDetail ? <p className="mt-1 text-[11px] text-status-critical">{c.conflictDetail}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
