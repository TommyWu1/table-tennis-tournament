import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ProjectorDemo } from './pages/ProjectorDemo';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).get('view') === 'projector-demo' ? <ProjectorDemo /> : <App />}
  </StrictMode>,
);
