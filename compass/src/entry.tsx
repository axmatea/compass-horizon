import { Component, lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

const Workspace = lazy(() => import('./workspace/App'));
const Remaster = lazy(() => import('./remaster/App'));
const Mission = lazy(() => import('./mission/App'));
const Finale = lazy(() => import('./finale/App'));

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <main role="alert"><h1>We couldn't open this workspace.</h1><p>No successful changes are assumed. Reload to retrieve the latest saved state.</p><button onClick={() => location.reload()}>Reload workspace</button></main> : this.props.children;
  }
}

const legacy = /^\/demo\/remaster(?:\/|$)/.test(location.pathname);
createRoot(document.getElementById('root')!).render(
  <Boundary><Suspense fallback={<main aria-busy="true">Opening COMPASS...</main>}>
    {legacy ? <Remaster /> : /^\/presentation\/finale\/?$/.test(location.pathname) ? <Finale /> : /^\/(office|demo\/workspace)\/?$/.test(location.pathname) ? <Mission /> : <Workspace />}
  </Suspense></Boundary>,
);
