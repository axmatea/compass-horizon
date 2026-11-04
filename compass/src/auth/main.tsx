import { Component } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <main role="alert"><h1>Account access could not open.</h1><p>No successful sign-in or registration is assumed.</p><button onClick={() => location.reload()}>Reload</button></main> : this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(<Boundary><App /></Boundary>);
