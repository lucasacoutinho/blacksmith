import { useEffect, useState, memo, Component, type ReactNode, type ErrorInfo } from 'react';
import { pipe, Match } from 'effect';
import { useProfileStore, type TabId } from '../store';
import { useFilteredCount } from '../hooks';
import { Header } from './Header';
import { TabBar } from './TabBar';
import { FlatProfile } from './FlatProfile';
import { CallGraph } from './CallGraph';
import { CallerMap } from './CallerMap';
import { FlameGraph } from './FlameGraph';
import { DiffProfile } from './DiffProfile';
import type { ExtensionMessage } from '../../types';

declare const acquireVsCodeApi: () => {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

const vscode = acquireVsCodeApi();
(window as unknown as { vscode: typeof vscode }).vscode = vscode;

interface ErrorBoundaryState {
  readonly hasError: boolean;
  readonly error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('React Error Boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error">
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '11px' }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const LoadingScreen = memo(function LoadingScreen({ filename, progress }: { filename: string; progress: number }) {
  return (
    <div className="loading">
      <div className="loading-spinner" />
      <div>Loading {filename}...</div>
      <div
        className="progress-bar"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Loading ${filename}`}
      >
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="stats">{progress}%</div>
    </div>
  );
});

const ErrorScreen = memo(function ErrorScreen({ message }: { message: string }) {
  return <div className="error">Error: {message}</div>;
});

const EmptyScreen = memo(function EmptyScreen() {
  return (
    <div className="loading">
      <div>Open a callgrind file to get started</div>
    </div>
  );
});

const TAB_KEYS: Record<string, TabId> = { '1': 'flat', '2': 'callgraph', '3': 'callermap', '4': 'flamegraph' };

const LiveRegion = memo(function LiveRegion() {
  const filteredCount = useFilteredCount();
  const search = useProfileStore((s) => s.search);
  const sortKey = useProfileStore((s) => s.sortKey);
  const sortDir = useProfileStore((s) => s.sortDir);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (search) {
      setAnnouncement(`${filteredCount} results for "${search}"`);
    } else {
      setAnnouncement('');
    }
  }, [search, filteredCount]);

  useEffect(() => {
    setAnnouncement(`Sorted by ${sortKey} ${sortDir === 'asc' ? 'ascending' : 'descending'}`);
  }, [sortKey, sortDir]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  );
});

const ContentArea = memo(function ContentArea() {
  const activeTab = useProfileStore((s) => s.activeTab);

  return (
    <div
      className="content"
      role="tabpanel"
      id={`tabpanel-${activeTab}`}
      aria-labelledby={`tab-${activeTab}`}
    >
      {pipe(
        Match.value(activeTab),
        Match.when('flat', () => <FlatProfile />),
        Match.when('callgraph', () => <CallGraph />),
        Match.when('callermap', () => <CallerMap />),
        Match.when('flamegraph', () => <FlameGraph />),
        Match.when('diff', () => <DiffProfile />),
        Match.exhaustive
      )}
    </div>
  );
});

const LoadedView = memo(function LoadedView() {
  const setActiveTab = useProfileStore((s) => s.setActiveTab);
  const setSearch = useProfileStore((s) => s.setSearch);
  const clearSelection = useProfileStore((s) => s.clearSelection);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd+F → focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        (document.querySelector('.search-box') as HTMLInputElement)?.focus();
        return;
      }

      // Escape → clear search and selection
      if (e.key === 'Escape') {
        setSearch('');
        clearSelection();
        (document.querySelector('.search-box') as HTMLInputElement)?.blur();
        return;
      }

      // 1-4 → switch tabs (only when not in an input/select)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const tab = TAB_KEYS[e.key];
      if (tab) {
        e.preventDefault();
        setActiveTab(tab);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setActiveTab, setSearch, clearSelection]);

  return (
    <ErrorBoundary>
      <header>
        <Header />
      </header>
      <nav aria-label="Profile views">
        <TabBar />
      </nav>
      <main>
        <ContentArea />
      </main>
      <LiveRegion />
    </ErrorBoundary>
  );
});

export const App = memo(function App() {
  const profile = useProfileStore((s) => s.profile);
  const setLoading = useProfileStore((s) => s.setLoading);
  const setProgress = useProfileStore((s) => s.setProgress);
  const setData = useProfileStore((s) => s.setData);
  const setError = useProfileStore((s) => s.setError);
  const setDiff = useProfileStore((s) => s.setDiff);
  const selectedMetricIndex = useProfileStore((s) => s.selectedMetricIndex);
  const selectedFunctionId = useProfileStore((s) => s.selectedFunctionId);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionMessage>) => {
      pipe(
        Match.value(event.data),
        Match.when({ type: 'loading' }, (m) => setLoading(m.filename)),
        Match.when({ type: 'progress' }, (m) => setProgress(m.progress.percent)),
        Match.when({ type: 'data' }, (m) => setData(m.data)),
        Match.when({ type: 'error' }, (m) => setError(m.message)),
        Match.when({ type: 'diffData' }, (m) => setDiff(m.diff)),
        Match.exhaustive
      );
    };

    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [setLoading, setProgress, setData, setError, setDiff]);

  useEffect(() => {
    vscode.postMessage({ type: 'setMetricIndex', index: selectedMetricIndex });
  }, [selectedMetricIndex]);

  useEffect(() => {
    vscode.postMessage({ type: 'selectFunction', id: selectedFunctionId });
  }, [selectedFunctionId]);

  return pipe(
    Match.value(profile),
    Match.when({ _tag: 'Loading' }, (p) => <LoadingScreen filename={p.filename} progress={p.progress} />),
    Match.when({ _tag: 'Error' }, (p) => <ErrorScreen message={p.message} />),
    Match.when({ _tag: 'Empty' }, () => <EmptyScreen />),
    Match.when({ _tag: 'Loaded' }, () => <LoadedView />),
    Match.exhaustive
  );
});
