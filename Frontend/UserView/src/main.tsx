import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'ol/ol.css';
import './index.css';
import { VisorController } from './core/visor';
import { App } from './ui/App';

// The flight software lives outside React so StrictMode double-mounts never start two links/simulators.
const ctl = new VisorController(location.search);
void ctl.init();
if (import.meta.env.DEV) (window as unknown as { __visor: VisorController }).__visor = ctl;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App ctl={ctl} />
  </StrictMode>,
);
