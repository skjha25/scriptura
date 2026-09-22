// frontend/src/components/auth/LoginForm.js
/**
 * Sign-in form. Extracted verbatim out of LoginPage.js — this is a pure
 * layout extraction, no auth logic changed (same useAuth() calls, same
 * redirect-back-to-`from` behaviour, same disabled-until-filled gating).
 *
 * There is no registration link — accounts are created by an admin
 * out-of-band, because this is an internal tool and self-serve signup would
 * be a way in for anyone who found the URL.
 */

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import Button from '../ui/Button';
import { Input } from '../ui/form';
import { ErrorBanner } from '../ui/feedback';

export default function LoginForm() {
  const { login, error, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    clearError();
    try {
      await login(email, password);
      // Return the user to wherever they were headed before the redirect.
      navigate(location.state?.from || '/', { replace: true });
    } catch {
      // AuthContext already holds the normalised error for the banner; there is
      // nothing useful to add here.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-hairline bg-panel p-6 shadow-panel"
      noValidate
    >
      <ErrorBanner error={error} onDismiss={clearError} />

      <Input
        label="Email"
        type="email"
        name="email"
        autoComplete="username"
        // The first field on a login screen is the one place autofocus is
        // unambiguously right: it is why the user is here.
        autoFocus
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@divinetalk.in"
      />

      <Input
        label="Password"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="••••••••"
      />

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={submitting}
        // Disabled until both fields have content, so the obvious mistake is
        // caught before a network round trip.
        disabled={email.trim() === '' || password === ''}
        className="w-full"
      >
        {submitting ? 'Signing in' : 'Sign in'}
      </Button>

      <p className="pt-1 text-center text-[11px] leading-relaxed text-ink-faint">
        Accounts are provisioned by an administrator. Ask in the team channel if
        you need access.
      </p>
    </form>
  );
}
