// frontend/src/components/ui/MouseGlow.js
/**
 * Ambient background glow that follows the mouse — not a cursor replacement.
 * The system pointer stays exactly as it is; this only sits in the
 * background layer and gently lights up whatever's near it, the way
 * user360.in's login page does. Position snaps straight to the pointer (no
 * easing) — only opacity eases in/out — same mechanism, colors swapped for
 * Scriptura's own accent → violet blend (see `.mouse-glow` in index.css,
 * which mirrors the `cosmic-wash` gradient's alpha values so this reads at
 * the same intensity the rest of the app already uses for ambient glow).
 *
 * Landing/login only by design — call sites mount this themselves rather
 * than it living globally in App.js.
 *
 * Never activates on a coarse/touch pointer or with reduced motion
 * requested — renders nothing in both cases.
 */

import { useEffect, useRef, useState } from 'react';

const SIZE = 480;
const HALF = SIZE / 2;

export default function MouseGlow() {
  const [enabled, setEnabled] = useState(false);
  const glowRef = useRef(null);

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)');
    const motionOk = window.matchMedia('(prefers-reduced-motion: no-preference)');
    setEnabled(fine.matches && motionOk.matches);

    const onChange = () => setEnabled(fine.matches && motionOk.matches);
    fine.addEventListener('change', onChange);
    motionOk.addEventListener('change', onChange);
    return () => {
      fine.removeEventListener('change', onChange);
      motionOk.removeEventListener('change', onChange);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    const move = (event) => {
      const el = glowRef.current;
      if (!el) return;
      el.style.transform = `translate3d(${event.clientX - HALF}px, ${event.clientY - HALF}px, 0)`;
      el.style.opacity = '1';
    };
    const hide = () => {
      if (glowRef.current) glowRef.current.style.opacity = '0';
    };

    document.addEventListener('pointermove', move);
    document.addEventListener('mouseleave', hide);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('mouseleave', hide);
    };
  }, [enabled]);

  if (!enabled) return null;

  return <div ref={glowRef} className="mouse-glow" aria-hidden="true" />;
}
