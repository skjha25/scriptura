// frontend/src/index.js
/**
 * React entry point.
 *
 * The one non-obvious thing here is `MotionConfig reducedMotion="user"`. Framer
 * Motion animates in JavaScript, so the `prefers-reduced-motion` block in
 * index.css does not reach it — this is what makes the spec's reduced-motion
 * requirement actually hold for the animated transitions.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';

import './index.css';
import App from './App';
import { AuthProvider } from './context/AuthContext';

function getBasename() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  if (typeof window !== 'undefined' && window.location) {
    const path = window.location.pathname;
    const match = path.match(/^(\/[^/]+)/);
    if (match && !['/blogs', '/blog', '/login', '/api', '/static', '/agents'].includes(match[1])) {
      return match[1];
    }
  }
  return '';
}

const basename = getBasename();
const container = document.getElementById('root');

createRoot(container).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <BrowserRouter basename={basename}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </MotionConfig>
  </StrictMode>
);
