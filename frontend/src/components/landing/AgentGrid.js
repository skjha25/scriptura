// frontend/src/components/landing/AgentGrid.js
import { motion } from 'framer-motion';
import {
  Network,
  LineChart,
  Search,
  Boxes,
  FileEdit,
  Wand2,
  Image,
  Timer,
} from 'lucide-react';

import { agents } from '../../content/landingCopy';
import { Card } from '../ui/feedback';

const ICONS = { Network, LineChart, Search, Boxes, FileEdit, Wand2, Image, Timer };

export default function AgentGrid() {
  return (
    <section className="px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-bright">
            The agent ecosystem
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold text-ink sm:text-4xl">
            Eight specialists. One chief.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">
            Each agent has a narrow, named job — and every one of them can only propose. A human
            approves before anything reaches your site.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {agents.map((agent, i) => {
            const Icon = ICONS[agent.icon];
            return (
              <motion.div
                key={agent.name}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.4, delay: (i % 4) * 0.06, ease: [0.22, 1, 0.36, 1] }}
              >
                <Card className="h-full p-5">
                  <div className="mb-3 grid h-9 w-9 place-items-center rounded-lg bg-glow-subtle text-accent-bright">
                    <Icon className="h-4.5 w-4.5" strokeWidth={1.75} />
                  </div>
                  <p className="text-sm font-semibold text-ink">{agent.name}</p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{agent.role}</p>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
