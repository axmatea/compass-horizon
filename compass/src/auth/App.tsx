import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { afterSignupLocation, workspaceReturn } from './login-return.ts';
import { authReady, getSession, registerInvite, signIn } from './api.ts';
import './styles.css';

export default function App() {
  const [kind, setKind] = useState<'sign-in' | 'invite'>(() => new URLSearchParams(location.search).has('token') ? 'invite' : 'sign-in');
  const [readiness, setReadiness] = useState<'checking' | 'ready' | 'blocked' | 'error'>('checking');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lock = useRef(false);
  const registrationToken = new URLSearchParams(location.search).get('token') ?? '';

  useEffect(() => {
    const controller = new AbortController();
    setReadiness('checking'); setError('');
    async function check() {
      try {
        if (!await authReady(controller.signal)) { setReadiness('blocked'); return; }
        const session = await getSession(controller.signal);
        if (controller.signal.aborted) return;
        if (session) { location.replace(workspaceReturn() ?? '/app'); return; }
        setReadiness('ready');
      } catch (cause) {
        if (!controller.signal.aborted) { setReadiness('error'); setError(cause instanceof Error ? cause.message : 'Authentication is unavailable.'); }
      }
    }
    void check();
    return () => controller.abort();
  }, [attempt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || readiness !== 'ready') return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get('email') ?? '').trim();
    const password = String(data.get('password') ?? '');
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (kind === 'invite') {
        const token = String(data.get('token') ?? '').trim();
        await registerInvite({ token, email, password, name: String(data.get('name') ?? '').trim() });
        // Registration creates an account, not workspace membership. Keep the second acceptance explicit.
        const destination = new URL(afterSignupLocation(), location.origin);
        if (!destination.searchParams.has('workspaceInvite') && /^[A-Za-z0-9_-]{43}$/.test(token)) destination.searchParams.set('workspaceInvite', token);
        history.replaceState(null, '', destination.pathname + destination.search);
        form.reset(); setKind('sign-in');
        setNotice('Account created. Sign in, then accept your workspace invitation in the office.');
      } else {
        await signIn(email, password);
        location.assign(workspaceReturn() ?? '/app');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Authentication failed. No success was confirmed.'); }
    finally { lock.current = false; setBusy(false); }
  }

  return <main className="auth-page">
    <a className="auth-brand" href="/">COMPASS<span>.</span></a>
    <section className="auth-card" aria-labelledby="auth-heading">
      <p className="auth-eyebrow">YOUR PEOPLE. YOUR PRIVATE OFFICE.</p>
      <h1 id="auth-heading">{kind === 'invite' ? 'Make room for you.' : 'A shared direction.'}</h1>
      <p>{kind === 'invite' ? 'Register with your private invitation, then sign in to join the workspace.' : 'Sign in to your invited COMPASS account.'}</p>
      {readiness === 'checking' && <p role="status">Checking account access...</p>}
      {readiness === 'blocked' && <p className="auth-alert" role="alert">Private accounts are unavailable because persistent storage is not configured. No demo workspace or local account will be substituted.</p>}
      {error && <p className="auth-alert" role="alert">{error}</p>}
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      {(readiness === 'blocked' || readiness === 'error') && <button className="auth-retry" type="button" onClick={() => setAttempt(value => value + 1)}>Check again</button>}
      <div className="auth-tabs" role="group" aria-label="Account access">
        <button type="button" disabled={busy} aria-pressed={kind === 'sign-in'} onClick={() => { setKind('sign-in'); setError(''); }}>Sign in</button>
        <button type="button" disabled={busy} aria-pressed={kind === 'invite'} onClick={() => { setKind('invite'); setError(''); }}>Register with invitation</button>
      </div>
      <form key={kind} onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy || readiness !== 'ready'}>
          {kind === 'invite' && <>
            <label>Invitation token<input name="token" required pattern="[A-Za-z0-9_-]{43}" defaultValue={registrationToken} autoComplete="off" spellCheck={false} /></label>
            <label>Your name<input name="name" required maxLength={120} autoComplete="name" /></label>
          </>}
          <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
          <label>Password<input name="password" type="password" required minLength={kind === 'invite' ? 12 : undefined} maxLength={128} autoComplete={kind === 'invite' ? 'new-password' : 'current-password'} /></label>
          <button className="auth-submit" type="submit">{busy ? 'Confirming...' : kind === 'invite' ? 'Create invited account' : 'Open workspace'}</button>
        </fieldset>
      </form>
      <p className="auth-fine">Invitation-only access. No public signup, automatic email, or billing. Expired or used invitations require a fresh link from your workspace owner.</p>
      <a className="auth-office" href="/app">Return to the office</a>
    </section>
  </main>;
}
