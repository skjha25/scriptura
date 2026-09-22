// frontend/src/pages/LoginPage.js
/**
 * Sign-in screen — split-screen layout around <LoginForm>, whose auth logic
 * is unchanged from before this redesign (see components/auth/LoginForm.js).
 */

import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

import LoginForm from '../components/auth/LoginForm';
import BrandLogo from '../components/layout/BrandLogo';
import LifecycleGlyph from '../components/landing/LifecycleGlyph';
import MouseGlow from '../components/ui/MouseGlow';

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Rendered outside the animated motion.div below — a `transform` on an
          ancestor would turn it into MouseGlow's containing block and break
          its viewport-fixed positioning. */}
      <MouseGlow />

      {/* Brand panel — hidden below lg to keep the form the whole screen on mobile. */}
      <div className="relative hidden overflow-hidden border-r border-hairline bg-panel/30 lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="absolute inset-0 bg-cosmic-wash" aria-hidden="true" />
        <Link to="/welcome" className="relative flex items-center gap-2.5">
          <BrandLogo />
          <span className="text-sm font-semibold text-ink">Scriptura</span>
        </Link>

        <div className="relative mx-auto w-full max-w-sm">
          <LifecycleGlyph />
        </div>

        <p className="relative max-w-sm text-sm leading-relaxed text-ink-secondary">
          Every recommendation waits for your approval. Every outcome gets measured before the
          system trusts it.
        </p>
      </div>

      <div className="flex items-center justify-center px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm"
        >
          <div className="mb-8 text-center">
            <Link to="/welcome" className="mb-4 inline-flex items-center gap-2.5 lg:hidden">
              <BrandLogo />
            </Link>
            <h1 className="text-2xl font-semibold text-ink">Scriptura</h1>
            <p className="mt-1.5 text-sm text-ink-muted">Divinetalk's content intelligence platform</p>
          </div>

          <LoginForm />
        </motion.div>
      </div>
    </div>
  );
}
