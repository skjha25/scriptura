// frontend/src/components/landing/KnowledgeLayer.js
import { motion } from 'framer-motion';

import { knowledgeLayer } from '../../content/landingCopy';

export default function KnowledgeLayer() {
  return (
    <section className="px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-3xl border border-hairline bg-panel/60 p-8 sm:p-10"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-bright">
            {knowledgeLayer.eyebrow}
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold text-ink sm:text-4xl">
            {knowledgeLayer.heading}
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-secondary sm:text-base">
            {knowledgeLayer.paragraph}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            {knowledgeLayer.stages.map((stage, i) => (
              <span key={stage} className="flex items-center gap-2">
                <span className="rounded-full border border-hairline-strong px-3 py-1.5 font-medium text-ink-secondary">
                  {stage}
                </span>
                {i < knowledgeLayer.stages.length - 1 && <span aria-hidden="true">→</span>}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
