import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { browserStorage, createStore } from './store/store';
import { App } from './ui/App';
import './ui/app.css';

const store = createStore(browserStorage());
const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
