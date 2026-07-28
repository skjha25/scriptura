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

const container = document.getElementById('root');

createRoot(container).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </MotionConfig>
  </StrictMode>
);
