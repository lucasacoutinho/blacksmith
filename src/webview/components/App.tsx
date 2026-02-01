import { useEffect, memo, Component, type ReactNode, type ErrorInfo } from 'react';
import { pipe, Match } from 'effect';
import { useProfileStore } from '../store';
import { Header } from './Header';
import { TabBar } from './TabBar';
import { FlatProfile } from './FlatProfile';
import { CallGraph } from './CallGraph';
import { CallerMap } from './CallerMap';
import { FlameGraph } from './FlameGraph';
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
      <div className="progress-bar">
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

const ContentArea = memo(function ContentArea() {
  const activeTab = useProfileStore((s) => s.activeTab);

  return (
    <div className="content">
      {pipe(
        Match.value(activeTab),
        Match.when('flat', () => <FlatProfile />),
        Match.when('callgraph', () => <CallGraph />),
        Match.when('callermap', () => <CallerMap />),
        Match.when('flamegraph', () => <FlameGraph />),
        Match.exhaustive
      )}
    </div>
  );
});

export const App = memo(function App() {
  const profile = useProfileStore((s) => s.profile);
  const setLoading = useProfileStore((s) => s.setLoading);
  const setProgress = useProfileStore((s) => s.setProgress);
  const setData = useProfileStore((s) => s.setData);
  const setError = useProfileStore((s) => s.setError);
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
        Match.exhaustive
      );
    };

    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [setLoading, setProgress, setData, setError]);

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
    Match.when({ _tag: 'Loaded' }, () => (
      <ErrorBoundary>
        <Header />
        <TabBar />
        <ContentArea />
      </ErrorBoundary>
    )),
    Match.exhaustive
  );
});
