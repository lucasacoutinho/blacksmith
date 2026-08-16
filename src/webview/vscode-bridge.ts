import type { WebviewMessage } from '../types';

export interface VsCodeApi {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
}

let vscodeApi: VsCodeApi | null = null;

export const initializeVsCodeBridge = (api: VsCodeApi): void => {
  vscodeApi = api;
};

export const postWebviewMessage = (message: WebviewMessage): void => {
  vscodeApi?.postMessage(message);
};
