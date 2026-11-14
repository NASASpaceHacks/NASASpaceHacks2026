import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import './admin.css';
import { loadArea } from '../shared/data';
import { App } from './App';

const root = createRoot(document.getElementById('root')!);
loadArea()
  .then((area) => root.render(<App area={area} />))
  .catch((e) => root.render(<div className="loading">Failed to load area data: {String(e)}</div>));
