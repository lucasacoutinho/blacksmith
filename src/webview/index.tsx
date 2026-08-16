import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './components';
import { startWebviewRuntime } from './webview-runtime';

declare const acquireVsCodeApi: () => {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

const stopRuntime = startWebviewRuntime(acquireVsCodeApi());
window.addEventListener('pagehide', stopRuntime, { once: true });

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
