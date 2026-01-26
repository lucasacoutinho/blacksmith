import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
