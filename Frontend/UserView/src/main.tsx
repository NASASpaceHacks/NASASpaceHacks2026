import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'ol/ol.css';
import './index.css';
import { VisorController } from './core/visor';
import { App } from './ui/App';
import { useVisor } from './state/store';

// The flight software lives outside React so StrictMode double-mounts never start two links/simulators.
const ctl = new VisorController(location.search);
void ctl.init();
// Dev/QA hooks (Playwright e2e): the controller and the published 10 Hz snapshot.
if (import.meta.env.DEV) Object.assign(window, { __visor: ctl, __visorSnap: () => useVisor.getState().snap });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App ctl={ctl} />
  </StrictMode>,
);
