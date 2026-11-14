import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import './hud.css';
import { loadArea } from '../shared/data';
import { Hud } from './Hud';

const root = createRoot(document.getElementById('root')!);
loadArea()
  .then((area) => root.render(<Hud area={area} />))
  .catch((e) => root.render(<div className="loading">Failed to load area data: {String(e)}</div>));
