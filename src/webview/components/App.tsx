import { memo, Component, type ReactNode, type ErrorInfo } from 'react';
import { pipe, Match } from 'effect';
import { useProfileStore } from '../store';
import { useFilteredCount } from '../hooks';
import { Header } from './Header';
import { TabBar } from './TabBar';
import { FlatProfile } from './FlatProfile';
import { CallGraph } from './CallGraph';
import { CallerMap } from './CallerMap';
import { FlameGraph } from './FlameGraph';
import { DiffProfile } from './DiffProfile';

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

const LoadingScreen = memo(function LoadingScreen({
  filename,
  progress,
}: {
  filename: string;
  progress: number;
}) {
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

const LiveRegion = memo(function LiveRegion() {
  const filteredCount = useFilteredCount();
  const search = useProfileStore((s) => s.search);
  const sortKey = useProfileStore((s) => s.sortKey);
  const sortDir = useProfileStore((s) => s.sortDir);

  return (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {search ? `${filteredCount} results for "${search}"` : ''}
      </div>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        Sorted by {sortKey} {sortDir === 'asc' ? 'ascending' : 'descending'}
      </div>
    </>
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
        Match.exhaustive,
      )}
    </div>
  );
});

const LoadedView = memo(function LoadedView() {
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

  return pipe(
    Match.value(profile),
    Match.when({ _tag: 'Loading' }, (p) => (
      <LoadingScreen filename={p.filename} progress={p.progress} />
    )),
    Match.when({ _tag: 'Error' }, (p) => <ErrorScreen message={p.message} />),
    Match.when({ _tag: 'Empty' }, () => <EmptyScreen />),
    Match.when({ _tag: 'Loaded' }, () => <LoadedView />),
    Match.exhaustive,
  );
});
