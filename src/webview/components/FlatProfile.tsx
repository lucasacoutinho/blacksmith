import { useCallback, memo, type CSSProperties } from 'react';
import { FixedSizeList as List } from 'react-window';
import { pipe, Option } from 'effect';
import { useProfileStore, useFunctionCost, type SortKey } from '../store';
import { useResizeObserver, useFilteredStats, useTotalCost } from '../hooks';
import { formatCost, shortenPath, calculatePercent } from '../utils';
import { LAYOUT } from '../constants';
import type { FunctionStats } from '../../types';

const getVscode = (): Option.Option<{ postMessage: (m: unknown) => void }> =>
  Option.fromNullable((window as unknown as { vscode?: { postMessage: (m: unknown) => void } }).vscode);

interface RowProps {
  readonly index: number;
  readonly style: CSSProperties;
  readonly stats: readonly FunctionStats[];
  readonly totalCost: number;
  readonly onOpenFile: (path: string, line: number) => void;
  readonly onSelectFunction: (id: number) => void;
}

const Row = memo(function Row({ index, style, stats, totalCost, onOpenFile, onSelectFunction }: RowProps) {
  const { getSelfCost, getTotalCost } = useFunctionCost();
  const fn = stats[index];
  const selfCost = getSelfCost(fn);
  const fnTotalCost = getTotalCost(fn);
  const percent = calculatePercent(fnTotalCost, totalCost);

  return (
    <div className="virtual-row" style={style}>
      <div className="virtual-cell function-name" onClick={() => onSelectFunction(fn.id)} title={`${fn.name} - Click to view in Call Graph`}>
        {fn.name}
      </div>
      <div className="virtual-cell file-path" onClick={() => onOpenFile(fn.file, fn.line)} title={`${fn.file} - Click to open file`}>
        {shortenPath(fn.file)}
      </div>
      <div className="virtual-cell number">{formatCost(selfCost)}</div>
      <div className="virtual-cell number">{formatCost(fnTotalCost)}</div>
      <div className="virtual-cell number">{fn.calls.toLocaleString()}</div>
      <div className="virtual-cell percent">{percent.toFixed(1)}%</div>
      <div className="virtual-cell bar-cell">
        <div className="bar" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
});

export const FlatProfile = memo(function FlatProfile() {
  const [containerRef, { height }] = useResizeObserver<HTMLDivElement>(32);

  const stats = useFilteredStats();
  const totalCost = useTotalCost();
  const sortKey = useProfileStore((s) => s.sortKey);
  const sortDir = useProfileStore((s) => s.sortDir);
  const setSort = useProfileStore((s) => s.setSort);
  const selectFunction = useProfileStore((s) => s.selectFunction);
  const setActiveTab = useProfileStore((s) => s.setActiveTab);

  const onOpenFile = useCallback(
    (path: string, line: number) =>
      pipe(
        getVscode(),
        Option.map((vs) => vs.postMessage({ type: 'openFile', path, line }))
      ),
    []
  );

  const onSelectFunction = useCallback((id: number) => {
    selectFunction(id);
    setActiveTab('callgraph');
  }, [selectFunction, setActiveTab]);

  const sortClass = useCallback(
    (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? 'sorted asc' : 'sorted') : '',
    [sortKey, sortDir]
  );

  return (
    <div className="table-container" ref={containerRef}>
      <div className="virtual-header">
        <div className={`virtual-cell ${sortClass('name')}`} onClick={() => setSort('name')}>Function</div>
        <div className={`virtual-cell ${sortClass('file')}`} onClick={() => setSort('file')}>File</div>
        <div className={`virtual-cell number ${sortClass('selfCost')}`} onClick={() => setSort('selfCost')}>Self</div>
        <div className={`virtual-cell number ${sortClass('totalCost')}`} onClick={() => setSort('totalCost')}>Total</div>
        <div className={`virtual-cell number ${sortClass('calls')}`} onClick={() => setSort('calls')}>Calls</div>
        <div className={`virtual-cell percent ${sortClass('percent')}`} onClick={() => setSort('percent')}>% Total</div>
        <div className="virtual-cell bar-cell" />
      </div>
      <List height={height || 400} itemCount={stats.length} itemSize={LAYOUT.ROW_HEIGHT} width="100%">
        {({ index, style }) => (
          <Row
            index={index}
            style={style}
            stats={stats}
            totalCost={totalCost}
            onOpenFile={onOpenFile}
            onSelectFunction={onSelectFunction}
          />
        )}
      </List>
    </div>
  );
});
