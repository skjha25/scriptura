// frontend/src/pages/UsersPage.js
/**
 * Users — platform user management. Admin-only (see App.js's `RequireAdmin`
 * wrapper and backend/src/controllers/users.controller.js's `requireAdmin`).
 *
 * There is no registration flow in this app (backend/src/controllers/auth.controller.js's
 * header comment is explicit: accounts were previously created only by a
 * seeder or "out-of-band" DB access) — this page is that admin path made
 * self-service.
 */

import { useCallback, useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { usersApi } from '../lib/api';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { Input, Select } from '../components/ui/form';
import { Badge, EmptyState, ErrorBanner, Skeleton } from '../components/ui/feedback';

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
];

const HEAD_CLASS =
  'whitespace-nowrap border-b border-hairline bg-panel-raised/90 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const EMPTY_FORM = { name: '', email: '', password: '', role: 'editor' };

/** Add-user modal. Owns its own form state so closing it always resets. */
function AddUserModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setError(null);
    }
  }, [open]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const user = await usersApi.create(form);
      onCreated(user);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title="Add user"
      subtitle="Creates a Scriptura account that can sign in immediately."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={saving}>
            Create user
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
        />
        <Input
          label="Email"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
        />
        <Input
          label="Password"
          type="password"
          required
          minLength={8}
          hint="At least 8 characters. Share it with them directly — it is never shown again."
          value={form.password}
          onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
        />
        <Select
          label="Role"
          options={ROLE_OPTIONS}
          value={form.role}
          onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}
        />
        {/* Submits the form on Enter without a second visible button. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

function UserRow({ user, isSelf, onChange }) {
  const [busyField, setBusyField] = useState(null);
  const [rowError, setRowError] = useState(null);

  async function save(patch, field) {
    setBusyField(field);
    setRowError(null);
    const previous = user;
    onChange({ ...user, ...patch }); // optimistic
    try {
      const updated = await usersApi.update(user.id, patch);
      onChange(updated);
    } catch (err) {
      onChange(previous); // revert
      setRowError(err.message || 'Could not save that change.');
    } finally {
      setBusyField(null);
    }
  }

  return (
    <tr className="border-b border-hairline/40 last:border-0">
      <th scope="row" className="px-4 py-3.5 text-left font-normal">
        <p className="text-sm text-ink">{user.name}</p>
        {isSelf ? <p className="mt-0.5 text-xs text-ink-faint">You</p> : null}
      </th>
      <td className="px-4 py-3.5 text-sm text-ink-secondary">{user.email}</td>
      <td className="px-4 py-3.5">
        <Select
          aria-label={`Role for ${user.name}`}
          options={ROLE_OPTIONS}
          value={user.role}
          disabled={isSelf || busyField === 'role'}
          title={isSelf ? "You cannot change your own role." : undefined}
          onChange={(e) => save({ role: e.target.value }, 'role')}
          className="!py-1.5 text-xs"
        />
      </td>
      <td className="px-4 py-3.5">
        <button
          type="button"
          disabled={isSelf || busyField === 'is_active'}
          title={isSelf ? 'You cannot deactivate your own account.' : 'Toggle active'}
          onClick={() => save({ is_active: !user.is_active }, 'is_active')}
          className="disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Badge tone={user.is_active ? 'good' : 'neutral'}>{user.is_active ? 'Active' : 'Inactive'}</Badge>
        </button>
      </td>
      <td className="px-4 py-3.5 text-sm text-ink-muted">{formatDate(user.created_at)}</td>
      {rowError ? (
        <td className="px-4 py-3.5 text-xs text-status-critical" colSpan={1}>
          {rowError}
        </td>
      ) : null}
    </tr>
  );
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await usersApi.list({ limit: 100 });
      setUsers(res.data);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleRowChange(updated) {
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
  }

  function handleCreated(created) {
    setUsers((prev) => [created, ...(prev || [])]);
  }

  return (
    <div className="space-y-8 animate-fade-in-up">
      <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Users</h1>
          <p className="max-w-2xl text-base text-ink-secondary">
            Team members who can sign in to Scriptura. Admins can create accounts, change roles, and
            deactivate access without touching the database.
          </p>
        </div>
        <Button variant="primary" onClick={() => setModalOpen(true)}>
          <UserPlus className="h-4 w-4" strokeWidth={2} />
          Add user
        </Button>
      </header>

      <ErrorBanner error={error} onRetry={load} onDismiss={() => setError(null)} />

      {!users ? (
        <Skeleton rows={4} />
      ) : users.length === 0 ? (
        <EmptyState
          title="No users yet"
          message="Add the first account so someone can sign in."
          action={
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              <UserPlus className="h-4 w-4" strokeWidth={2} />
              Add user
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-hairline bg-panel shadow-panel">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="sr-only">{`${users.length} platform users.`}</caption>
            <thead>
              <tr>
                <th scope="col" className={HEAD_CLASS}>Name</th>
                <th scope="col" className={HEAD_CLASS}>Email</th>
                <th scope="col" className={HEAD_CLASS}>Role</th>
                <th scope="col" className={HEAD_CLASS}>Status</th>
                <th scope="col" className={HEAD_CLASS}>Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/40">
              {users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  isSelf={currentUser?.id === user.id}
                  onChange={handleRowChange}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddUserModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={handleCreated} />
    </div>
  );
}
