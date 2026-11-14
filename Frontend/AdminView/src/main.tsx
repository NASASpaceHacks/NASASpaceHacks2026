import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'ol/ol.css';
import './index.css';
import { App } from './App';
import * as actions from './actions';
import { useConsole } from './store';

// QA/e2e hook (Playwright, B7): window.marswalk.state() and window.marswalk.actions.*
(window as unknown as { marswalk: unknown }).marswalk = { state: () => useConsole.getState(), actions };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
