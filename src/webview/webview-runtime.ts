import { Match, pipe } from 'effect';
import { useProfileStore, type TabId } from './store';
import { initializeVsCodeBridge, postWebviewMessage, type VsCodeApi } from './vscode-bridge';
import type { ExtensionMessage } from '../types';

const tabKeys: Readonly<Record<string, TabId>> = {
  '1': 'flat',
  '2': 'callgraph',
  '3': 'callermap',
  '4': 'flamegraph',
};

export const handleExtensionMessage = (message: ExtensionMessage): void => {
  const state = useProfileStore.getState();
  pipe(
    Match.value(message),
    Match.when({ type: 'loading' }, (value) => state.setLoading(value.filename)),
    Match.when({ type: 'progress' }, (value) => state.setProgress(value.progress.percent)),
    Match.when({ type: 'data' }, (value) => state.setData(value.data)),
    Match.when({ type: 'error' }, (value) => state.setError(value.message)),
    Match.when({ type: 'diffData' }, (value) => state.setDiff(value.diff)),
    Match.exhaustive,
  );
};

export const handleKeyboardShortcut = (event: KeyboardEvent): void => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
    event.preventDefault();
    document.querySelector<HTMLInputElement>('.search-box')?.focus();
    return;
  }

  if (event.key === 'Escape') {
    useProfileStore.getState().clearSelection();
    document.querySelector<HTMLInputElement>('.search-box')?.blur();
    return;
  }

  const tagName = (event.target as HTMLElement | null)?.tagName;
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;

  const tab = tabKeys[event.key];
  if (tab) {
    event.preventDefault();
    useProfileStore.getState().setActiveTab(tab);
  }
};

export const startWebviewRuntime = (api: VsCodeApi): (() => void) => {
  initializeVsCodeBridge(api);

  const onMessage = (event: MessageEvent<ExtensionMessage>) => handleExtensionMessage(event.data);

  window.addEventListener('message', onMessage);
  window.addEventListener('keydown', handleKeyboardShortcut);
  postWebviewMessage({ type: 'ready' });

  return () => {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('keydown', handleKeyboardShortcut);
  };
};
