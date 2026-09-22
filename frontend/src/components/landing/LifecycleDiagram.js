// frontend/src/components/landing/LifecycleDiagram.js
import { motion } from 'framer-motion';
import { Lightbulb, CheckCircle2, Play, TrendingUp, Brain, ArrowRight } from 'lucide-react';

import { lifecycle } from '../../content/landingCopy';

const ICONS = { Lightbulb, CheckCircle2, Play, TrendingUp, Brain };

export default function LifecycleDiagram() {
  return (
    <section id="how-it-works" className="px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-bright">
            {lifecycle.eyebrow}
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold text-ink sm:text-4xl">
            {lifecycle.heading}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">{lifecycle.subhead}</p>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-2">
          {lifecycle.stages.map((stage, i) => {
            const Icon = ICONS[stage.icon];
            const isLast = i === lifecycle.stages.length - 1;
            return (
              <div key={stage.label} className="flex flex-1 items-stretch gap-2">
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-60px' }}
                  transition={{ duration: 0.4, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                  className="flex-1 rounded-2xl border border-hairline bg-panel/60 p-5"
                >
                  <div className="mb-3 grid h-9 w-9 place-items-center rounded-lg bg-glow-subtle text-accent-bright">
                    <Icon className="h-4.5 w-4.5" strokeWidth={1.75} />
                  </div>
                  <p className="text-sm font-semibold text-ink">{stage.label}</p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{stage.description}</p>
                </motion.div>
                {!isLast && (
                  <div
                    aria-hidden="true"
                    className="hidden w-6 flex-none items-center justify-center text-ink-faint lg:flex"
                  >
                    <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
