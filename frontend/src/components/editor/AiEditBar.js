// frontend/src/components/editor/AiEditBar.js
/**
 * Inline "just type what to edit" prompt for the block editor.
 *
 * Deliberately separate from the floating AgentChatWidget: that widget is a
 * multi-turn chat with per-change diff cards and an explicit Apply/Dismiss
 * click. This bar is a single input + single button that applies whatever
 * the AI proposes immediately — the live editor (undo, autosave, preview)
 * is the review step, not a second confirmation click. `onSubmit` (owned by
 * EditorPage) does the actual chat call + apply; this component only owns
 * its own input/loading/notice state.
 */

import { useState } from 'react';
import Button from '../ui/Button';
import { Input } from '../ui/form';

export default function AiEditBar({ onSubmit, readOnly }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { tone: 'success' | 'info' | 'error', text }

  const handleSubmit = async (event) => {
    event.preventDefault();
    const instruction = value.trim();
    if (!instruction || busy || readOnly) return;

    setBusy(true);
    setNotice(null);
    try {
      const result = await onSubmit(instruction);
      if (result?.clarification) {
        // Left in the input so the admin can extend/correct it rather than retype from scratch.
        setNotice({ tone: 'info', text: result.clarification });
      } else {
        setNotice({ tone: 'success', text: result?.summary || 'Applied.' });
        setValue('');
      }
    } catch (err) {
      setNotice({ tone: 'error', text: err?.message || 'Could not apply that edit.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <form onSubmit={handleSubmit} className="flex items-start gap-2">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Just type what to edit..."
          disabled={busy || readOnly}
          containerClassName="flex-1"
          aria-label="Describe the edit you want the AI to make"
        />
        <Button
          type="submit"
          variant="primary"
          size="md"
          loading={busy}
          disabled={!value.trim() || readOnly}
        >
          {busy ? 'Applying your edit...' : '✨ Apply AI Edit'}
        </Button>
      </form>
      {notice ? (
        <p
          role="status"
          className={
            notice.tone === 'error'
              ? 'text-xs text-status-critical'
              : notice.tone === 'info'
                ? 'text-xs text-ink-secondary'
                : 'text-xs text-status-good'
          }
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
