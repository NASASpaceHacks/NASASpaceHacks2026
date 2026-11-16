import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ar.css';
// Same flight software as the 1080p visor (UserView): hab link from the AdminView console, route package,
// local route model + simulator + onboard safety core. Only the presentation differs.
import { VisorController } from '@mw/visor/src/core/visor';
import { useVisor } from '@mw/visor/src/state/store';
import { App } from './App';
import { NavModel } from './nav';

const ctl = new VisorController(location.search);
// No GPS on Mars: the AR visor dead-reckons (true vs. estimated position, drift, fixes, local reroutes).
const nav = new NavModel(ctl);
ctl.posModel = nav;
void ctl.init();
if (import.meta.env.DEV) Object.assign(window, { __visor: ctl, __nav: nav, __visorSnap: () => useVisor.getState().snap });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App ctl={ctl} nav={nav} />
  </StrictMode>,
);
