// frontend/src/components/editor/SeoPanel.js
/**
 * Meta title, meta description and slug — editable directly in the editor.
 *
 * All three columns already exist and are already writable via the same
 * `PATCH /blogs/:id` the block canvas's autosave uses — see
 * blogService.js's updateBlog and blog.validators.js's writableFields. This
 * panel is the only new thing: there was previously no UI for them at all.
 *
 * Saves on blur, one field at a time, using the same "immediate direct PATCH
 * for a non-block field" pattern EditorPage.js's handleRegenerateImage and
 * update_title already use — not the debounced content_blocks autosave,
 * since these fields are not part of `blocks`.
 *
 * Local drafts are only re-synced from `blog` when the record identity
 * changes (a different blog loaded), never on every parent re-render —
 * otherwise a periodic metadata refresh (e.g. the generation-status poll)
 * could clobber a field the author is mid-edit on.
 */

import { useEffect, useState } from 'react';

import { Card, CardHeader, ErrorBanner } from '../ui/feedback';
import { Input, Textarea } from '../ui/form';

const META_DESCRIPTION_MIN = 140;
const META_DESCRIPTION_MAX = 160;

export default function SeoPanel({ blog, readOnly, onSave }) {
  const [metaTitle, setMetaTitle] = useState(blog.meta_title || '');
  const [metaDescription, setMetaDescription] = useState(blog.meta_description || '');
  const [slug, setSlug] = useState(blog.slug || '');
  const [savingField, setSavingField] = useState(null);
  const [fieldError, setFieldError] = useState(null);

  useEffect(() => {
    setMetaTitle(blog.meta_title || '');
    setMetaDescription(blog.meta_description || '');
    setSlug(blog.slug || '');
    setFieldError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync only on a different record, see file header
  }, [blog.id]);

  async function commit(field, value, previous) {
    if (value === previous) return;
    setSavingField(field);
    setFieldError(null);
    try {
      await onSave({ [field]: value });
    } catch (err) {
      setFieldError(err);
    } finally {
      setSavingField(null);
    }
  }

  return (
    <Card interactive={false}>
      <CardHeader title="SEO & Publishing" subtitle="How this article is found and linked." />
      <div className="space-y-4 p-5">
        <Input
          label="Meta title"
          value={metaTitle}
          readOnly={readOnly}
          maxLength={70}
          hint={`${metaTitle.length} / 60 characters recommended`}
          onChange={(event) => setMetaTitle(event.target.value)}
          onBlur={() => commit('meta_title', metaTitle, blog.meta_title || '')}
        />

        <Textarea
          label="Meta description"
          value={metaDescription}
          readOnly={readOnly}
          rows={3}
          maxLength={320}
          hint={`${metaDescription.length} characters — recommended ${META_DESCRIPTION_MIN}-${META_DESCRIPTION_MAX}`}
          onChange={(event) => setMetaDescription(event.target.value)}
          onBlur={() => commit('meta_description', metaDescription, blog.meta_description || '')}
        />

        <Input
          label="Slug"
          value={slug}
          readOnly={readOnly}
          hint={slug ? `Published at /blog/${slug}` : 'Used in the published URL.'}
          onChange={(event) => setSlug(event.target.value)}
          onBlur={() => commit('slug', slug, blog.slug || '')}
        />

        {savingField ? (
          <p className="text-xs text-ink-muted" role="status">
            Saving {savingField.replace('_', ' ')}…
          </p>
        ) : null}
        {fieldError ? <ErrorBanner error={fieldError} onDismiss={() => setFieldError(null)} /> : null}
      </div>
    </Card>
  );
}
