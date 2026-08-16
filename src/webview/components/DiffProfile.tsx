import { useCallback, memo, type CSSProperties } from 'react';
import { FixedSizeList as List } from 'react-window';
import { useProfileStore, type SortKey } from '../store';
import { useResizeObserver } from '../hooks';
import { formatCost, shortenPath } from '../utils';
import { LAYOUT } from '../constants';
import type { DiffEntry, DiffResult } from '../../types';
import { postWebviewMessage } from '../vscode-bridge';

const statusColor = (status: DiffEntry['status']): string => {
  switch (status) {
    case 'improved':
      return 'var(--vscode-charts-green, #4ec9b0)';
    case 'regressed':
      return 'var(--vscode-charts-red, #f44747)';
    case 'added':
      return 'var(--vscode-charts-yellow, #cca700)';
    case 'removed':
      return 'var(--vscode-charts-purple, #b180d7)';
    case 'unchanged':
      return 'var(--vscode-foreground)';
  }
};

const formatDelta = (delta: number): string => {
  const prefix = delta > 0 ? '+' : '';
  return `${prefix}${formatCost(delta)}`;
};

const formatDeltaPct = (pct: number): string => {
  if (!isFinite(pct)) return 'new';
  const prefix = pct > 0 ? '+' : '';
  return `${prefix}${pct.toFixed(1)}%`;
};

interface DiffRowProps {
  readonly index: number;
  readonly style: CSSProperties;
  readonly entries: readonly DiffEntry[];
  readonly onOpenFile: (path: string, line: number) => void;
}

const DiffRow = memo(function DiffRow({ index, style, entries, onOpenFile }: DiffRowProps) {
  const entry = entries[index];
  const color = statusColor(entry.status);

  return (
    <div className="virtual-row diff-row" style={style}>
      <div className="diff-cell diff-fn" title={entry.name}>
        {entry.name}
      </div>
      <div
        className="diff-cell diff-file"
        onClick={() => onOpenFile(entry.file, entry.line)}
        title={`${entry.file} - Click to open`}
      >
        {shortenPath(entry.file)}
      </div>
      <div className="diff-cell diff-num">{formatCost(entry.selfCostA)}</div>
      <div className="diff-cell diff-num">{formatCost(entry.selfCostB)}</div>
      <div className="diff-cell diff-num" style={{ color }}>
        {formatDelta(entry.selfDelta)}
      </div>
      <div className="diff-cell diff-num">{formatCost(entry.totalCostA)}</div>
      <div className="diff-cell diff-num">{formatCost(entry.totalCostB)}</div>
      <div className="diff-cell diff-num" style={{ color }}>
        {formatDelta(entry.totalDelta)}
      </div>
      <div className="diff-cell diff-status" style={{ color }}>
        {entry.status}
      </div>
    </div>
  );
});

const DiffSummary = memo(function DiffSummary({ diff }: { diff: DiffResult }) {
  const clearDiff = useProfileStore((s) => s.clearDiff);
  const deltaColor =
    diff.totalDelta > 0
      ? 'var(--vscode-charts-red, #f44747)'
      : diff.totalDelta < 0
        ? 'var(--vscode-charts-green, #4ec9b0)'
        : 'var(--vscode-foreground)';

  return (
    <div className="diff-summary">
      <span className="diff-summary-text">
        Comparing <strong>{diff.filenameA}</strong> vs <strong>{diff.filenameB}</strong>
        {' | '}
        Total: {formatCost(diff.totalCostA)} → {formatCost(diff.totalCostB)}{' '}
        <span style={{ color: deltaColor }}>({formatDeltaPct(diff.totalDeltaPct)})</span>
        {' | '}
        Metric: {diff.metricName}
      </span>
      <button className="diff-clear-btn" onClick={clearDiff}>
        Clear Comparison
      </button>
    </div>
  );
});

export const DiffProfile = memo(function DiffProfile() {
  const [containerRef, { height }] = useResizeObserver<HTMLDivElement>(32);
  const diff = useProfileStore((s) => s.diff);
  const search = useProfileStore((s) => s.search);
  const sortKey = useProfileStore((s) => s.sortKey);
  const sortDir = useProfileStore((s) => s.sortDir);
  const setSort = useProfileStore((s) => s.setSort);

  const onOpenFile = useCallback(
    (path: string, line: number) => postWebviewMessage({ type: 'openFile', path, line }),
    [],
  );

  if (!diff) return null;

  const filtered = search
    ? diff.entries.filter((e) => {
        const q = search.toLowerCase();
        return e.name.toLowerCase().includes(q) || e.file.toLowerCase().includes(q);
      })
    : diff.entries;

  const sorted = [...filtered].sort((a, b) => {
    let cmp: number;
    switch (sortKey) {
      case 'name':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'file':
        cmp = a.file.localeCompare(b.file);
        break;
      case 'selfCost':
        cmp = a.selfDelta - b.selfDelta;
        break;
      case 'totalCost':
        cmp = a.totalDelta - b.totalDelta;
        break;
      case 'calls':
        cmp = a.callsB - a.callsA - (b.callsB - b.callsA);
        break;
      default:
        cmp = a.totalDelta - b.totalDelta;
        break;
    }
    return sortDir === 'desc' ? -cmp : cmp;
  });

  const sortClass = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? 'sorted asc' : 'sorted') : '';

  return (
    <div className="table-container" ref={containerRef}>
      <DiffSummary diff={diff} />
      <div className="virtual-header diff-header">
        <div className={`diff-cell ${sortClass('name')}`} onClick={() => setSort('name')}>
          Function
        </div>
        <div className={`diff-cell ${sortClass('file')}`} onClick={() => setSort('file')}>
          File
        </div>
        <div className="diff-cell diff-num">Self A</div>
        <div className="diff-cell diff-num">Self B</div>
        <div
          className={`diff-cell diff-num ${sortClass('selfCost')}`}
          onClick={() => setSort('selfCost')}
        >
          Self Δ
        </div>
        <div className="diff-cell diff-num">Total A</div>
        <div className="diff-cell diff-num">Total B</div>
        <div
          className={`diff-cell diff-num ${sortClass('totalCost')}`}
          onClick={() => setSort('totalCost')}
        >
          Total Δ
        </div>
        <div className="diff-cell diff-status">Status</div>
      </div>
      <List
        height={height || 400}
        itemCount={sorted.length}
        itemSize={LAYOUT.ROW_HEIGHT}
        width="100%"
      >
        {({ index, style }) => (
          <DiffRow index={index} style={style} entries={sorted} onOpenFile={onOpenFile} />
        )}
      </List>
    </div>
  );
});
