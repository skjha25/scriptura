// frontend/src/components/landing/Footer.js
import { Link } from 'react-router-dom';

import { footer } from '../../content/landingCopy';
import BrandLogo from '../layout/BrandLogo';

export default function Footer() {
  return (
    <footer className="border-t border-hairline px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 text-center">
        <BrandLogo />
        <h2 className="font-display text-2xl font-semibold text-ink sm:text-3xl">{footer.heading}</h2>
        <Link
          to={footer.cta.to}
          className="inline-flex items-center gap-2 rounded-xl bg-glow-accent px-6 py-3 text-sm font-semibold text-white shadow-glow-sm transition-transform duration-200 hover:-translate-y-0.5"
        >
          {footer.cta.label}
        </Link>
        <p className="text-xs text-ink-faint">Scriptura — Divinetalk's content intelligence platform.</p>
      </div>
    </footer>
  );
}
