// frontend/src/pages/EditorPage.js
/**
 * The block editor.
 *
 * ---------------------------------------------------------------------------
 * WHAT OWNS WHAT
 * ---------------------------------------------------------------------------
 * This screen owns exactly one piece of editable state: the `content_blocks` array,
 * held by `useBlockHistory` so every mutation is undoable. Everything under
 * components/editor is presentational — it reports intent upward and renders what it is
 * given. That is what makes undo, autosave and the preview consistent by construction
 * rather than by discipline: there is only one array, and all three read it.
 *
 * Blog *metadata* (title, status, score) is separate state, and it deliberately does not
 * carry `content_blocks`. Keeping a second copy of the blocks on the loaded record is
 * how a stale server response ends up overwriting what the author is typing.
 *
 * ---------------------------------------------------------------------------
 * WHY blog_content IS NEVER SENT
 * ---------------------------------------------------------------------------
 * The backend regenerates `blog_content`, `word_count` and `seo_score` from
 * `content_blocks` on every write. Sending rendered HTML would be ignored at best and
 * a second source of truth at worst — the blocks are the source of truth, and the
 * derived HTML is the server's business.
 *
 * ---------------------------------------------------------------------------
 * THE GENERATION RACE
 * ---------------------------------------------------------------------------
 * A generation run writes to the same row. The backend refuses a content update while
 * one is in flight (409 GENERATION_IN_PROGRESS) rather than letting the two overwrite
 * each other, so this screen has to handle a refusal without losing the edit. It does
 * three things: stops autosave (so it is not hammering a locked row), keeps the blocks
 * exactly as they are in history state, and offers an explicit retry. The author's work
 * stays on screen and stays theirs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';

import { blogsApi, mediaApi } from '../lib/api';
import { BLOG_STATUS, GENERATION_IN_FLIGHT } from '../lib/constants';
import { useInterval } from '../hooks/useDebouncedValue';
import useBlockHistory from '../hooks/useBlockHistory';
import useAutosave, { SAVE_STATUS } from '../hooks/useAutosave';

import Button from '../components/ui/Button';
import {
  ErrorBanner,
  InfoBanner,
  Skeleton,
  StatusBadge,
  GenerationBadge,
} from '../components/ui/feedback';
import TriScoreBadge from '../components/shared/TriScoreBadge';
import EditorCanvas from '../components/editor/EditorCanvas';
import BlockSettingsPanel from '../components/editor/BlockSettingsPanel';
import PreviewPane from '../components/editor/PreviewPane';
import SaveStatus from '../components/editor/SaveStatus';
import {
  createBlock,
  duplicateBlock,
  withBlockIds,
  blockTypeLabel,
} from '../components/editor/blockModel';
import { PAGE_ENTER } from '../lib/motion';

/**
 * Stable empty array.
 *
 * `useAutosave` decides "unsaved" by comparing the blocks array by identity against the
 * last persisted one. A fresh `[]` on every render would never match, so mounting the
 * screen would look like an edit and schedule a save of nothing.
 */
const EMPTY_BLOCKS = [];

/** How often to re-check a row that a generation run is writing to. */
const GENERATION_POLL_MS = 4000;

/**
 * True when the focused element is a text-entry control.
 *
 * The spec is explicit that Ctrl/Cmd+Z must not be hijacked inside a text field — the
 * browser's own text undo is finer-grained than block undo and is what an author
 * reaches for mid-sentence. `isContentEditable` is included for completeness even
 * though the editor uses textareas.
 */
function isTextEntry(element) {
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
}

/**
 * Strips `content_blocks` from a server record.
 * The blocks live in history state; a second copy on the metadata object could only
 * ever be stale.
 */
function metaOf(record) {
  if (!record || typeof record !== 'object') return null;
  const { content_blocks: blocks, ...meta } = record;
  return meta;
}

export default function EditorPage() {
  const { id } = useParams();

  const [blog, setBlog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [showPreview, setShowPreview] = useState(true);
  const [deletedNotice, setDeletedNotice] = useState(null);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState(null);
  const [publishNotice, setPublishNotice] = useState(null);

  const [regeneratingImage, setRegeneratingImage] = useState(false);

  /** Set when the backend refuses a write because generation owns the row. */
  const [generationLock, setGenerationLock] = useState(false);

  const { blocks, setBlocks, undo, redo, canUndo, canRedo, reset } =
    useBlockHistory(EMPTY_BLOCKS);

  /** Mirror of `blocks` for handlers that must stay identity-stable. */
  const blocksRef = useRef(blocks);
  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  const generating = GENERATION_IN_FLIGHT.includes(blog?.generation_status);
  const readOnly = generating || generationLock;

  // -------------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------------

  /**
   * `content_blocks` is never sent back — the whole point of the payload shape below is
   * that the server derives the HTML from the blocks. The write path lives here rather
   * than in the hook so the endpoint contract stays visible on the screen that owns it.
   */
  const save = useCallback(
    async (nextBlocks) => {
      const updated = await blogsApi.update(id, { content_blocks: nextBlocks });
      // The response carries the server's recomputed word_count and seo_score. Only the
      // metadata is taken; the blocks stay owned by history state.
      const meta = metaOf(updated);
      if (meta) setBlog((previous) => ({ ...previous, ...meta }));
    },
    [id]
  );

  const {
    status,
    savedAt,
    error: saveError,
    sync,
    saveNow,
    flush,
  } = useAutosave({ value: blocks, save, delay: 1200, enabled: !readOnly });

  const applyRecord = useCallback(
    (record) => {
      const nextBlocks = withBlockIds(record?.content_blocks);
      setBlog(metaOf(record));
      // Discards undo history: it belongs to the version that was on screen, and undoing
      // into a superseded server state would be a lie.
      reset(nextBlocks);
      // What the server just handed us is, by definition, saved.
      sync(nextBlocks);
    },
    [reset, sync]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      applyRecord(await blogsApi.get(id));
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [id, applyRecord]);

  useEffect(() => {
    load();
  }, [load]);

  // A 409 means a generation run holds the row. Stop autosaving into a refusal; the
  // edits stay in history state and the banner offers an explicit retry.
  useEffect(() => {
    if (saveError?.code === 'GENERATION_IN_PROGRESS') setGenerationLock(true);
  }, [saveError]);

  // While generation is in flight the row is not editable, so polling cannot clobber
  // anything — and the moment it finishes the author gets the generated blocks without
  // reloading the page. `null` stops the interval entirely when nothing is generating.
  useInterval(
    useCallback(async () => {
      try {
        const record = await blogsApi.get(id);
        if (!GENERATION_IN_FLIGHT.includes(record?.generation_status)) {
          setGenerationLock(false);
          applyRecord(record);
        } else {
          setBlog(metaOf(record));
        }
      } catch {
        // A failed poll is not worth a banner — the next tick tries again.
      }
    }, [id, applyRecord]),
    readOnly ? GENERATION_POLL_MS : null
  );

  // -------------------------------------------------------------------------
  // Block mutations
  //
  // Every handler is identity-stable (functional updaters, refs for reads) because
  // SortableBlock is memoised. A handler recreated on each render would defeat that and
  // re-render every textarea on every keystroke.
  // -------------------------------------------------------------------------

  const handleSelect = useCallback((blockId) => setSelectedId(blockId), []);

  const handleChangeBlock = useCallback(
    (blockId, data, mergeKey) => {
      setBlocks(
        (previous) =>
          previous.map((block) => (block.id === blockId ? { ...block, data } : block)),
        { mergeKey }
      );
    },
    [setBlocks]
  );

  const handleInsert = useCallback(
    (type, position) => {
      // Built outside the updater so its id is known here — and so a double-invoked
      // updater cannot mint two different blocks.
      const block = createBlock(type);
      setBlocks((previous) => [
        ...previous.slice(0, position),
        block,
        ...previous.slice(position),
      ]);
      setSelectedId(block.id);
    },
    [setBlocks]
  );

  const handleDuplicate = useCallback(
    (blockId) => {
      const source = blocksRef.current.find((block) => block.id === blockId);
      if (!source) return;
      const copy = duplicateBlock(source);
      setBlocks((previous) => {
        const index = previous.findIndex((block) => block.id === blockId);
        if (index < 0) return previous;
        return [...previous.slice(0, index + 1), copy, ...previous.slice(index + 1)];
      });
      setSelectedId(copy.id);
    },
    [setBlocks]
  );

  const handleDelete = useCallback(
    (blockId) => {
      const target = blocksRef.current.find((block) => block.id === blockId);
      if (!target) return;
      setBlocks((previous) => previous.filter((block) => block.id !== blockId));
      setSelectedId((current) => (current === blockId ? null : current));
      // Undoable rather than confirmed. A confirm dialog on every delete punishes the
      // 95% of deletions that are intentional; an undo affordance costs nothing until
      // it is needed. It is announced, so it is not a visual-only escape hatch.
      setDeletedNotice({ label: blockTypeLabel(target.type) });
    },
    [setBlocks]
  );

  const handleReorder = useCallback((next) => setBlocks(next), [setBlocks]);

  // The notice is transient — it is an offer, not a state. Eight seconds is long enough
  // to read and react to, short enough not to linger over the next edit.
  useEffect(() => {
    if (!deletedNotice) return undefined;
    const timer = setTimeout(() => setDeletedNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [deletedNotice]);

  const handleRegenerateImage = async () => {
    if (!blog) return;
    setRegeneratingImage(true);
    setPublishError(null);
    try {
      const generated = await mediaApi.generateImage({
        topic: blog.blog_title || blog.topic || 'Astrology',
        logo_overlay: true,
        logo_position: 'top_right',
        count: 1
      });
      if (generated && generated.length > 0) {
        const newPicture = generated[0].publicUrl;
        const updated = await blogsApi.update(blog.id, { blog_picture: newPicture });
        setBlog(metaOf(updated));
      }
    } catch (err) {
      setPublishError(err.message || 'Failed to regenerate image.');
    } finally {
      setRegeneratingImage(false);
    }
  };

  // -------------------------------------------------------------------------
  // Keyboard: undo / redo
  // -------------------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!event.metaKey && !event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      // Inside a text field the browser's own undo stack is the right one. Taking the
      // key here would break mid-sentence correction, which is the case people
      // actually use Ctrl+Z for.
      if (isTextEntry(document.activeElement)) return;

      event.preventDefault();
      if (key === 'y' || event.shiftKey) redo();
      else undo();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const handleSaveDraft = useCallback(() => {
    // Clearing the lock here is what makes the banner's retry work: the row may well be
    // free by now, and the only way to find out is to try.
    setGenerationLock(false);
    return saveNow();
  }, [saveNow]);

  const handlePublish = useCallback(async () => {
    setPublishError(null);
    setPublishNotice(null);

    // The last keystrokes go first: publishing a version the server has not seen is the
    // one way this screen could put stale content on the public site.
    const saved = await flush();
    if (saved === false) return;

    setPublishing(true);
    try {
      const updated = await blogsApi.publish(id);
      const meta = metaOf(updated);
      if (meta) setBlog((previous) => ({ ...previous, ...meta }));
      setPublishNotice('Published. The article is now live.');
    } catch (err) {
      // 422 carries a code — NO_CONTENT, GENERATION_FAILED, GENERATION_IN_PROGRESS —
      // and a message written for the author. ErrorBanner shows the message; the code
      // is what tells us whether the row is locked.
      setPublishError(err);
      if (err?.code === 'GENERATION_IN_PROGRESS') setGenerationLock(true);
    } finally {
      setPublishing(false);
    }
  }, [flush, id]);

  const selectedBlock = useMemo(
    () => blocks.find((block) => block.id === selectedId) || null,
    [blocks, selectedId]
  );
  const selectedIndex = selectedBlock ? blocks.indexOf(selectedBlock) : -1;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6" aria-busy="true">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton rows={6} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorBanner error={loadError} onRetry={load} />
      </div>
    );
  }

  if (!blog) return null;

  return (
    <motion.div
      {...PAGE_ENTER}
      className="min-w-0 space-y-4"
    >
      <header className="min-w-0 space-y-3 border-b border-hairline pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Flushed on the way out so the last keystrokes are persisted before the
              route changes. The unmount path in useAutosave is the safety net for
              every other way of leaving. */}
          <Link
            to="/blogs"
            onClick={() => flush()}
            className="text-xs text-ink-muted hover:text-ink"
          >
            ← All blogs
          </Link>
          <StatusBadge status={blog.blog_status} />
          <GenerationBadge status={blog.generation_status} />
          {blog.word_count ? (
            <span className="text-xs text-ink-muted tabular">{blog.word_count} words</span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold leading-tight text-ink sm:text-2xl" style={{ letterSpacing: '-0.015em' }}>
              {blog.blog_title}
            </h1>
            <p className="mt-1 text-xs text-ink-muted">
              {blocks.length} {blocks.length === 1 ? 'block' : 'blocks'} · content is the
              source of truth; the HTML and scores are regenerated on save
            </p>
          </div>
          <TriScoreBadge
            seo={{ score: blog.seo_score }}
            aeo={{ score: blog.aeo_score, breakdown: blog.aeo_score_breakdown }}
            geo={{ score: blog.geo_score, breakdown: blog.geo_score_breakdown }}
            variant="compact"
          />
        </div>

        {/* Wraps rather than scrolls at 375px — the reason nothing here has a fixed
            width. */}
        <div className="flex flex-wrap items-center gap-2">
          <SaveStatus status={status} savedAt={savedAt} className="mr-auto" />

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={undo}
              disabled={!canUndo}
              aria-label="Undo"
              aria-keyshortcuts="Control+Z Meta+Z"
            >
              <span aria-hidden="true">↶</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={redo}
              disabled={!canRedo}
              aria-label="Redo"
              aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
            >
              <span aria-hidden="true">↷</span>
            </Button>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowPreview((value) => !value)}
            aria-pressed={showPreview}
          >
            {showPreview ? 'Hide preview' : 'Show preview'}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleSaveDraft}
            loading={status === SAVE_STATUS.SAVING}
          >
            Save draft
          </Button>

          <Button variant="primary" size="sm" onClick={handlePublish} loading={publishing}>
            {blog.blog_status === BLOG_STATUS.PUBLISHED ? 'Republish' : 'Publish'}
          </Button>
        </div>
      </header>

      {blog.blog_picture_url || blog.blog_picture ? (
        <div className="relative group w-full mb-6">
          <img
            src={blog.blog_picture_url || blog.blog_picture}
            alt="Blog"
            className="w-full rounded-xl border border-hairline"
          />
          <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="secondary"
              size="sm"
              loading={regeneratingImage}
              onClick={handleRegenerateImage}
              title="Regenerate Image"
              className="bg-panel/90 hover:bg-panel backdrop-blur-sm"
            >
              <span aria-hidden="true" className="text-lg">↻</span> Regenerate
            </Button>
          </div>
        </div>
      ) : (
        <div className="mb-6 flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            loading={regeneratingImage}
            onClick={handleRegenerateImage}
          >
            Generate Image
          </Button>
        </div>
      )}

      {generating ? (
        <InfoBanner tone="warning">
          Content is being generated for this article. Editing is disabled until the run
          finishes — this screen is watching for it.
        </InfoBanner>
      ) : null}

      {generationLock && !generating ? (
        <InfoBanner tone="warning">
          The last save was refused because a generation run holds this article. Your
          edits are still here and unsaved — retry the save once the run finishes.
        </InfoBanner>
      ) : null}

      {saveError ? <ErrorBanner error={saveError} onRetry={handleSaveDraft} /> : null}
      {publishError ? (
        <ErrorBanner error={publishError} onDismiss={() => setPublishError(null)} />
      ) : null}

      {publishNotice ? (
        <InfoBanner tone="accent">
          <span role="status">{publishNotice}</span>{' '}
          <Link to={`/blogs/${id}`} onClick={() => flush()} className="underline">
            View the article
          </Link>
        </InfoBanner>
      ) : null}

      {deletedNotice ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-panel-raised px-4 py-2.5"
        >
          <span className="text-sm text-ink-secondary">
            {deletedNotice.label} block deleted.
          </span>
          <button
            type="button"
            onClick={() => {
              undo();
              setDeletedNotice(null);
            }}
            // Named for what it undoes, not just "Undo": the toolbar already has a
            // generic Undo, and two controls answering to the same name is ambiguous for
            // anyone navigating by accessible name.
            aria-label={`Undo deleting the ${deletedNotice.label} block`}
            className="text-xs font-medium text-brand-light hover:underline"
          >
            Undo
          </button>
        </div>
      ) : null}

      <div
        className={clsx(
          'grid min-w-0 gap-5',
          selectedBlock ? 'lg:grid-cols-[minmax(0,1fr)_20rem]' : 'grid-cols-1'
        )}
      >
        <div className={clsx('grid min-w-0 gap-5', showPreview && 'xl:grid-cols-2')}>
          <section aria-label="Article blocks" className="min-w-0">
            <EditorCanvas
              blocks={blocks}
              selectedId={selectedId}
              readOnly={readOnly}
              onSelect={handleSelect}
              onChangeBlock={handleChangeBlock}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              onInsert={handleInsert}
              onReorder={handleReorder}
            />
          </section>

          {showPreview ? <PreviewPane blocks={blocks} title={blog.blog_title} /> : null}
        </div>

        <BlockSettingsPanel
          block={selectedBlock}
          index={selectedIndex}
          total={blocks.length}
          readOnly={readOnly}
          onChange={(data, mergeKey) => handleChangeBlock(selectedId, data, mergeKey)}
          onClose={() => setSelectedId(null)}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
        />
      </div>
    </motion.div>
  );
}
