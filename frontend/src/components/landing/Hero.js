// frontend/src/components/landing/Hero.js
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { hero } from '../../content/landingCopy';
import BrandLogo from '../layout/BrandLogo';
import LifecycleGlyph from './LifecycleGlyph';

export default function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pb-20 pt-10 sm:px-6 sm:pt-16 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-6 flex items-center gap-2.5">
            <BrandLogo />
            <span className="text-sm font-semibold text-ink">Scriptura</span>
          </div>

          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-accent-bright">
            {hero.eyebrow}
          </p>
          <h1 className="font-display text-4xl font-semibold leading-[1.08] text-ink sm:text-5xl lg:text-[3.25rem]">
            {hero.headline}
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-secondary sm:text-lg">
            {hero.subhead}
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              to={hero.primaryCta.to}
              className="inline-flex items-center gap-2 rounded-xl bg-glow-accent px-6 py-3 text-sm font-semibold text-white shadow-glow-sm transition-transform duration-200 hover:-translate-y-0.5"
            >
              {hero.primaryCta.label}
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </Link>
            <a
              href={hero.secondaryCta.href}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline px-6 py-3 text-sm font-medium text-ink-secondary transition-colors hover:border-hairline-strong hover:text-ink"
            >
              {hero.secondaryCta.label}
            </a>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden="true"
          className="relative"
        >
          <LifecycleGlyph />
        </motion.div>
      </div>
    </section>
  );
}
