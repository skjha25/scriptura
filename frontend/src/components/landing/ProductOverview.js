// frontend/src/components/landing/ProductOverview.js
import { motion } from 'framer-motion';

import { productOverview } from '../../content/landingCopy';
import { Card } from '../ui/feedback';

export default function ProductOverview() {
  return (
    <section className="px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {productOverview.map((tile, i) => (
            <motion.div
              key={tile.title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.4, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
            >
              <Card interactive={false} className="h-full p-5">
                <p className="text-sm font-semibold text-ink">{tile.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{tile.description}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
