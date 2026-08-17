// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/webview/components/App';
import { useProfileStore } from '../src/webview/store';
import { handleExtensionMessage } from '../src/webview/webview-runtime';
import { initializeVsCodeBridge } from '../src/webview/vscode-bridge';
import { Cost, FunctionId, type DiffResult, type SerializedProfileData } from '../src/types';
import { subtractCosts } from '../src/cost';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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
  beforeEach(() => {
    resetStore();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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

  it('renders virtualized flat and diff rows', async () => {
    const id = FunctionId(1);
    const data: SerializedProfileData = {
      functions: [[1, { id, name: 'hotFunction', file: '/src/hot.ts', line: 12 }]],
      edges: [],
      stats: [
        [
          1,
          {
            id,
            name: 'hotFunction',
            file: '/src/hot.ts',
            line: 12,
            selfCost: Cost(40),
            totalCost: Cost(100),
            selfCosts: [Cost(40)],
            totalCosts: [Cost(100)],
            lineCosts: [],
            calls: Cost(3),
            callers: [],
            callees: [],
          },
        ],
      ],
      totalCost: Cost(100),
      eventType: 'Time',
      eventTypes: ['Time'],
      totalCosts: [Cost(100)],
    };

    act(() => handleExtensionMessage({ type: 'data', data }));
    render(<App />);

    expect(await screen.findByText('hotFunction')).toBeTruthy();

    const diff: DiffResult = {
      entries: [
        {
          key: 'hotFunction:/src/hot.ts',
          name: 'hotFunction',
          file: '/src/hot.ts',
          line: 12,
          selfCostA: Cost(40),
          selfCostB: Cost(45),
          totalCostA: Cost(100),
          totalCostB: Cost(120),
          selfDelta: subtractCosts(Cost(45), Cost(40)),
          totalDelta: subtractCosts(Cost(120), Cost(100)),
          selfDeltaPct: 12.5,
          totalDeltaPct: 20,
          callsA: Cost(3),
          callsB: Cost(4),
          status: 'regressed',
        },
      ],
      totalCostA: Cost(100),
      totalCostB: Cost(120),
      totalDelta: subtractCosts(Cost(120), Cost(100)),
      totalDeltaPct: 20,
      metricName: 'Time',
      filenameA: 'before.callgrind',
      filenameB: 'after.callgrind',
    };

    act(() => handleExtensionMessage({ type: 'diffData', diff }));

    expect(await screen.findByText('regressed')).toBeTruthy();
  });
});
