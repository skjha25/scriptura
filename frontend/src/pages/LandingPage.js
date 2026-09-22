// frontend/src/pages/LandingPage.js
/**
 * Public marketing landing page at /welcome. Unlike the rest of the app,
 * this route is meant to be indexable — see the meta-tag override below —
 * while every authenticated route stays `noindex` (public/index.html).
 */

import { useEffect } from 'react';

import MouseGlow from '../components/ui/MouseGlow';
import Hero from '../components/landing/Hero';
import ProductOverview from '../components/landing/ProductOverview';
import AgentGrid from '../components/landing/AgentGrid';
import LifecycleDiagram from '../components/landing/LifecycleDiagram';
import KnowledgeLayer from '../components/landing/KnowledgeLayer';
import Footer from '../components/landing/Footer';

const LANDING_TITLE = 'Scriptura — The Intelligence Layer for SEO Content';
const LANDING_DESCRIPTION =
  'Scriptura runs eight specialized agents against your real search data. Every recommendation waits for human approval, every outcome is measured for two weeks, and the system only remembers what proved out.';

/**
 * Swaps document.title / meta description / meta robots for the duration of
 * this route, then restores whatever was there before — the authenticated
 * app (and its noindex default) must be unaffected once the user navigates
 * away.
 */
function useLandingMeta() {
  useEffect(() => {
    const previousTitle = document.title;
    const descriptionTag = document.querySelector('meta[name="description"]');
    const robotsTag = document.querySelector('meta[name="robots"]');
    const previousDescription = descriptionTag?.getAttribute('content');
    const previousRobots = robotsTag?.getAttribute('content');

    document.title = LANDING_TITLE;
    descriptionTag?.setAttribute('content', LANDING_DESCRIPTION);
    robotsTag?.setAttribute('content', 'index, follow');

    return () => {
      document.title = previousTitle;
      if (previousDescription != null) descriptionTag?.setAttribute('content', previousDescription);
      if (previousRobots != null) robotsTag?.setAttribute('content', previousRobots);
    };
  }, []);
}

export default function LandingPage() {
  useLandingMeta();

  return (
    <div className="min-h-screen">
      <MouseGlow />
      <Hero />
      <ProductOverview />
      <AgentGrid />
      <LifecycleDiagram />
      <KnowledgeLayer />
      <Footer />
    </div>
  );
}
