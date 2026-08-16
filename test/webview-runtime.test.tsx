// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/webview/components/App';
import { useProfileStore } from '../src/webview/store';
import { handleExtensionMessage } from '../src/webview/webview-runtime';
import { initializeVsCodeBridge } from '../src/webview/vscode-bridge';

const resetStore = () =>
  useProfileStore.setState({
    profile: { _tag: 'Empty' },
    filename: '',
    activeTab: 'flat',
    search: '',
    sortKey: 'totalCost',
    sortDir: 'desc',
    selectedMetricIndex: 0,
    selectedFunctionId: null,
    callGraphHistory: [],
    diff: null,
  });

describe('webview runtime', () => {
  beforeEach(resetStore);
  afterEach(cleanup);

  it('renders loading progress and errors received from the extension', () => {
    render(<App />);

    act(() =>
      handleExtensionMessage({
        type: 'loading',
        filename: 'profile.callgrind',
      }),
    );
    expect(screen.getByText('Loading profile.callgrind...')).toBeTruthy();

    act(() =>
      handleExtensionMessage({
        type: 'progress',
        progress: { percent: 42, functionCount: 7 },
      }),
    );
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');

    act(() => handleExtensionMessage({ type: 'error', message: 'Malformed profile' }));
    expect(screen.getByText('Error: Malformed profile')).toBeTruthy();
  });

  it('posts metric and selection changes at the store boundary', () => {
    const postMessage = vi.fn<(message: unknown) => void>();
    initializeVsCodeBridge({
      postMessage,
      getState: vi.fn<() => unknown>(),
      setState: vi.fn<(state: unknown) => void>(),
    });

    useProfileStore.getState().setMetricIndex(2);
    useProfileStore.getState().selectFunction(41);
    useProfileStore.getState().clearSelection();

    expect(postMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: 'setMetricIndex', index: 2 },
      { type: 'selectFunction', id: 41 },
      { type: 'selectFunction', id: null },
    ]);
  });
});
