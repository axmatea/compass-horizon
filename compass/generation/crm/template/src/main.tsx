import {useEffect, useMemo, useState, type FormEvent} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import {currentUser, getConfig, localRequest, previewClient, standaloneClient} from './client';
import type {CrmConfig} from './types';
import './styles.css';

function Login({title, signedIn}: {title: string; signedIn(user: string): void}) {
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const form = {email: fields.get('email'), password: fields.get('password'),
      ...(creating ? {name: fields.get('name')} : {})};
    setBusy(true);
    setError('');
    try {
      await localRequest('/api/auth/' + (creating ? 'sign-up/email' : 'sign-in/email'),
        {method: 'POST', body: JSON.stringify(form)});
      const user = await currentUser();
      if (!user) throw Error();
      signedIn(user);
    } catch {
      setError(creating ? 'Use a .test email and a password with at least 12 characters.' : 'Sign-in failed. Check your email and password.');
    } finally {setBusy(false);}
  }
  return <main className="login">
    <div className="brand"><span className="brand-mark" aria-hidden="true"></span><h1>{title}</h1></div>
    <h2>{creating ? 'Create a local account' : 'Sign in'}</h2>
    <form onSubmit={submit}>
      {creating && <label>Name<input name="name" autoComplete="name" required maxLength={80}/></label>}
      <label>Email<input name="email" type="email" autoComplete="username" required maxLength={254}/></label>
      <label>Password<input name="password" type="password" autoComplete={creating ? 'new-password' : 'current-password'} required minLength={12} maxLength={128}/></label>
      {error && <p className="problem" role="alert">{error}</p>}
      <button className="button primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : creating ? 'Create account' : 'Sign in'}</button>
    </form>
    <button className="button quiet" type="button" disabled={busy} onClick={() => {setCreating(!creating);setError('');}}>
      {creating ? 'Back to sign in' : 'Create local account'}
    </button>
  </main>;
}

function Standalone() {
  const [config, setConfig] = useState<CrmConfig | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const client = useMemo(() => user ? standaloneClient(user) : null, [user]);
  useEffect(() => {
    let active = true;
    Promise.all([getConfig(), currentUser()]).then(([nextConfig, nextUser]) => {
      if (active) {
        document.title = nextConfig.title;
        setConfig(nextConfig);
        setUser(nextUser);
      }
    }).catch(() => {if (active) setProblem('Could not load this CRM. Refresh to try again.');});
    return () => {active = false;};
  }, []);
  if (problem) return <p className="problem" role="alert">{problem}</p>;
  if (!config) return <p className="empty" role="status">Loading workspace…</p>;
  if (!client || !user) return <Login title={config.title} signedIn={setUser}/>;
  return <App config={config} client={client} signOut={async () => {
    await localRequest('/api/auth/sign-out', {method: 'POST', body: '{}', headers: {'x-crm-user': user}});
    setUser(null);
  }}/>;
}

const rootElement = document.getElementById('crm-root');
if (rootElement) {
  const root = createRoot(rootElement);
  const manifest = document.getElementById('crm-manifest');
  try {
    root.render(manifest ? <App client={previewClient()} config={JSON.parse(manifest.textContent || '')}/> : <Standalone/>);
  } catch {
    root.render(<p className="problem" role="alert">Could not open this CRM.</p>);
  }
}
