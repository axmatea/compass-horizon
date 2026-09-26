import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Presentation from './story/Presentation';

const root = document.getElementById('root');
if (!root) throw new Error('COMPASS office root element is missing.');

const isTour = /^\/studio\/tour\/?$/.test(window.location.pathname);

createRoot(root).render(
  <StrictMode>{isTour ? <Presentation /> : <App />}</StrictMode>,
);
