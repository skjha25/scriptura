// frontend/src/pages/WizardPage.js
/**
 * The six-step article wizard.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS RESPONSIBLE FOR
 * ---------------------------------------------------------------------------
 * State and routing, and nothing else. Every screen lives in
 * src/components/wizard/, every persistence decision lives in
 * src/hooks/useWizardDraft.js, and every "may I advance?" rule lives in
 * src/components/wizard/steps.js. What is left here is the one thing that cannot
 * be pushed down: the single copy of the configuration, and the two routes that
 * share it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE STATE IS ONE FLAT OBJECT NAMED AFTER THE COLUMNS
 * ---------------------------------------------------------------------------
 * Because the wizard's persistence model is "PATCH the row". A shape of the
 * wizard's own devising would need a translation layer in both directions, and the
 * translation is exactly where a field goes missing and a mid-wizard refresh
 * quietly loses a step's work. Keeping `config` key-for-key identical to the
 * writable `blogs` columns makes `onChange(patch)` and `blogsApi.update(id, patch)`
 * the same object, and makes hydration a rename of two nested groups rather than a
 * mapping table.
 *
 * ---------------------------------------------------------------------------
 * THE TWO ROUTES
 * ---------------------------------------------------------------------------
 * /blogs/new has no row yet; /blogs/:id/wizard resumes one. The first save creates
 * the row and replaces the URL with the second form, so a refresh at any point
 * after the title is typed resumes rather than starting over. `replace` and not
 * `push`: Back should leave the wizard, not return to a URL that no longer
 * describes what is on screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { blogsApi } from '../lib/api';
import { GENERATION_IN_FLIGHT } from '../lib/constants';
import { useWizardDraft } from '../hooks/useWizardDraft';
import { ErrorBanner, Skeleton } from '../components/ui/feedback';
import WizardShell from '../components/wizard/WizardShell';
import Step1Topic from '../components/wizard/Step1Topic';
import Step2BrandVoice from '../components/wizard/Step2BrandVoice';
import Step3Content from '../components/wizard/Step3Content';
import Step4Images from '../components/wizard/Step4Images';
import Step5Publish from '../components/wizard/Step5Publish';
import Step6Generate from '../components/wizard/Step6Generate';
import {
  FIRST_STEP,
  INITIAL_CONFIG,
  LAST_STEP,
  WIZARD_STEPS,
  furthestReachableStep,
  isStepComplete,
  missingForStep,
} from '../components/wizard/steps';

/**
 * Flattens a serialised blog into wizard state.
 *
 * The API nests brand voice and image settings for readability; the columns —
 * and therefore a PATCH — are flat. This is the only place the two shapes meet.
 */
function configFromBlog(blog) {
  return {
    ...INITIAL_CONFIG,
    blog_title: blog.blog_title || '',
    topic: blog.topic || '',
    seo_keywords: blog.seo_keywords || '',
    secondary_keywords: blog.secondary_keywords || [],

    brand_voice_source_type: blog.brand_voice?.source_type ?? null,
    brand_voice_source_ref: blog.brand_voice?.source_ref || '',
    brand_voice_tone: blog.brand_voice?.tone || '',
    brand_voice_pov: blog.brand_voice?.pov || '',
    brand_voice_traits: blog.brand_voice?.traits || [],
    brand_voice_confirmed: blog.brand_voice?.confirmed === true,

    article_type: blog.article_type || INITIAL_CONFIG.article_type,
    tone_of_voice: blog.tone_of_voice || '',
    point_of_view: blog.point_of_view || '',
    target_country: blog.target_country || '',
    language: blog.language || INITIAL_CONFIG.language,
    readability_level: blog.readability_level || INITIAL_CONFIG.readability_level,
    ai_content_cleaning: blog.ai_content_cleaning === true,

    seo_structure_config: blog.seo_structure_config || { ...INITIAL_CONFIG.seo_structure_config },
    internal_linking: blog.internal_linking === true,
    internal_link_targets: blog.internal_link_targets || [],
    external_web_grounding: blog.external_web_grounding === true,
    outline: blog.outline || [],

    include_images: blog.images_config?.include_images !== false,
    image_count: blog.images_config?.image_count || INITIAL_CONFIG.image_count,
    image_style: blog.images_config?.image_style || INITIAL_CONFIG.image_style,
    logo_overlay: blog.images_config?.logo_overlay === true,
    logo_position: blog.images_config?.logo_position || 'none',

    blog_status: blog.blog_status ?? INITIAL_CONFIG.blog_status,
    publish_date: blog.publish_date || null,
    category: blog.category || '',
    tags: blog.tags || [],
    published_by: blog.published_by || INITIAL_CONFIG.published_by,
  };
}

export default function WizardPage() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();

  const [blogId, setBlogId] = useState(routeId ? Number(routeId) : null);
  const [config, setConfig] = useState(INITIAL_CONFIG);
  const [step, setStep] = useState(FIRST_STEP);
  const [showMissing, setShowMissing] = useState(false);
  const [loading, setLoading] = useState(Boolean(routeId));
  const [loadError, setLoadError] = useState(null);
  const [generationStatus, setGenerationStatus] = useState(null);

  /**
   * Ids whose server state has already been folded into `config`.
   *
   * The create path sets this before it navigates, which is what stops the load
   * effect from firing on the id we just made and overwriting whatever the author
   * typed in the second or two since.
   */
  const hydratedRef = useRef(null);

  const handleCreated = useCallback(
    (blog) => {
      hydratedRef.current = Number(blog.id);
      setBlogId(Number(blog.id));
      navigate(`/blogs/${blog.id}/wizard`, { replace: true });
    },
    [navigate]
  );

  const draft = useWizardDraft({ blogId, onCreated: handleCreated });

  // Resume an existing draft. Runs once per id, never for an id we created.
  useEffect(() => {
    if (!routeId) return undefined;
    const numericId = Number(routeId);
    if (hydratedRef.current === numericId) {
      setLoading(false);
      return undefined;
    }
    hydratedRef.current = numericId;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    blogsApi
      .get(numericId)
      .then((blog) => {
        if (cancelled || !blog) return;
        const resumed = configFromBlog(blog);
        setBlogId(Number(blog.id));
        setConfig(resumed);
        setGenerationStatus(blog.generation_status || null);
        // Drop the author back where the draft actually is, rather than making
        // them click through five completed steps to reach the unfinished one.
        setStep(furthestReachableStep(resumed));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [routeId]);

  /** Applies a patch to local state and queues it for the server. */
  const handleChange = useCallback(
    (patch) => {
      setConfig((previous) => ({ ...previous, ...patch }));
      draft.save(patch);
      // Any edit makes the previous "here is what is missing" stale.
      setShowMissing(false);
    },
    [draft]
  );

  const missing = useMemo(() => missingForStep(step, config), [step, config]);
  const furthest = useMemo(() => furthestReachableStep(config), [config]);
  const completed = useMemo(
    () =>
      WIZARD_STEPS.reduce((accumulator, entry) => {
        accumulator[entry.id] = entry.id !== LAST_STEP && isStepComplete(entry.id, config);
        return accumulator;
      }, {}),
    [config]
  );

  const goToStep = useCallback(
    (next) => {
      setStep(next);
      setShowMissing(false);
      // The step body can be taller than the viewport; leaving the scroll position
      // where it was puts the author halfway down a form they have not read.
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    []
  );

  async function handleNext() {
    if (missing.length > 0) {
      // Refuse and explain, rather than disabling the button — a disabled control
      // cannot be focused, so it cannot tell anyone why it is disabled.
      setShowMissing(true);
      return;
    }
    // Land the step's edits before moving on, so the next step (and the server)
    // read the same configuration the author is looking at.
    await draft.saveNow();
    goToStep(Math.min(LAST_STEP, step + 1));
  }

  function handleBack() {
    goToStep(Math.max(FIRST_STEP, step - 1));
  }

  const handleGenerated = useCallback(() => {
    navigate(`/blogs/${blogId}/edit`);
  }, [navigate, blogId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6" aria-busy="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-2 w-full" />
        <Skeleton rows={10} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorBanner error={loadError} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <WizardShell
      step={step}
      furthest={furthest}
      completed={completed}
      onStepChange={goToStep}
      missing={missing}
      showMissing={showMissing}
      onNext={handleNext}
      onBack={handleBack}
      saving={draft.saving}
      savedAt={draft.savedAt}
    >
      {/* Autosave failures belong above the step, not inside it: the fields are
          still editable and the patch is still queued, so this is a warning about
          durability rather than an error about the form. */}
      <ErrorBanner error={draft.error} onDismiss={draft.dismissError} className="mb-4" />

      {step === 1 ? <Step1Topic config={config} onChange={handleChange} /> : null}
      {step === 2 ? <Step2BrandVoice config={config} onChange={handleChange} /> : null}
      {step === 3 ? (
        <Step3Content config={config} onChange={handleChange} blogId={blogId} />
      ) : null}
      {step === 4 ? <Step4Images config={config} onChange={handleChange} /> : null}
      {step === 5 ? <Step5Publish config={config} onChange={handleChange} /> : null}
      {step === 6 ? (
        <Step6Generate
          config={config}
          blogId={blogId}
          // A reload during a run has to resume watching it, not offer to start a
          // second one — the server would refuse that with 409 anyway.
          initialStatus={
            GENERATION_IN_FLIGHT.includes(generationStatus) ? generationStatus : undefined
          }
          onGenerated={handleGenerated}
          onGoToStep={goToStep}
          onBeforeSubmit={draft.saveNow}
        />
      ) : null}
    </WizardShell>
  );
}
