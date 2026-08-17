import { useCallback, useState, useRef, memo, type KeyboardEvent, type MouseEvent } from 'react';
import { List, type ListImperativeAPI, type RowComponentProps } from 'react-window';
import { useProfileStore, useFunctionCost, type SortKey } from '../store';
import { useResizeObserver, useFilteredStats, useTotalCost } from '../hooks';
import { formatCost, shortenPath, calculatePercent } from '../utils';
import { LAYOUT } from '../constants';
import type { Cost, FunctionStats } from '../../types';
import { postWebviewMessage } from '../vscode-bridge';
import { formatExactCost } from '../../cost';

const copyToClipboard = (text: string, e: MouseEvent) => {
  e.stopPropagation();
  navigator.clipboard.writeText(text);
};

interface FlatRowData {
  readonly stats: readonly FunctionStats[];
  readonly totalCost: Cost;
  readonly focusedIndex: number;
  readonly onOpenFile: (path: string, line: number) => void;
  readonly onSelectFunction: (id: number) => void;
}

type FlatRowProps = RowComponentProps<FlatRowData>;

const Row = function Row({
  index,
  style,
  stats,
  totalCost,
  focusedIndex,
  onOpenFile,
  onSelectFunction,
}: FlatRowProps) {
  const { getSelfCost, getTotalCost } = useFunctionCost();
  const fn = stats[index];
  const selfCost = getSelfCost(fn);
  const fnTotalCost = getTotalCost(fn);
  const percent = calculatePercent(fnTotalCost, totalCost);
  const isFocused = index === focusedIndex;

  return (
    <div
      className={`virtual-row${isFocused ? ' focused' : ''}`}
      style={style}
      role="row"
      aria-rowindex={index + 2}
      tabIndex={isFocused ? 0 : -1}
    >
      <div
        role="gridcell"
        className="virtual-cell function-name"
        onClick={() => onSelectFunction(fn.id)}
        title={`${fn.name} - Click to view in Call Graph`}
      >
        {fn.name}
        <button
          className="copy-btn"
          onClick={(e) => copyToClipboard(fn.name, e)}
          aria-label={`Copy function name ${fn.name}`}
          title="Copy function name"
        >
          ⧉
        </button>
      </div>
      <div
        role="gridcell"
        className="virtual-cell file-path"
        onClick={() => onOpenFile(fn.file, fn.line)}
        title={`${fn.file} - Click to open file`}
      >
        {shortenPath(fn.file)}
        <button
          className="copy-btn"
          onClick={(e) => copyToClipboard(fn.file, e)}
          aria-label={`Copy file path ${fn.file}`}
          title="Copy file path"
        >
          ⧉
        </button>
      </div>
      <div role="gridcell" className="virtual-cell number">
        {formatCost(selfCost)}
      </div>
      <div role="gridcell" className="virtual-cell number">
        {formatCost(fnTotalCost)}
      </div>
      <div role="gridcell" className="virtual-cell number">
        {formatExactCost(fn.calls)}
      </div>
      <div role="gridcell" className="virtual-cell percent">
        {percent.toFixed(1)}%
      </div>
      <div role="gridcell" className="virtual-cell bar-cell">
        <div className="bar" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
};

const ariaSort = (
  key: SortKey,
  sortKey: SortKey,
  sortDir: string,
): 'ascending' | 'descending' | 'none' =>
  sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

export const FlatProfile = memo(function FlatProfile() {
  const [containerRef, { height }] = useResizeObserver<HTMLDivElement>(32);
  const listRef = useRef<ListImperativeAPI>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const stats = useFilteredStats();
  const totalCost = useTotalCost();
  const sortKey = useProfileStore((s) => s.sortKey);
  const sortDir = useProfileStore((s) => s.sortDir);
  const setSort = useProfileStore((s) => s.setSort);
  const selectFunction = useProfileStore((s) => s.selectFunction);
  const setActiveTab = useProfileStore((s) => s.setActiveTab);

  const onOpenFile = useCallback(
    (path: string, line: number) => postWebviewMessage({ type: 'openFile', path, line }),
    [],
  );

  const onSelectFunction = useCallback(
    (id: number) => {
      selectFunction(id);
      setActiveTab('callgraph');
    },
    [selectFunction, setActiveTab],
  );

  const sortClass = useCallback(
    (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? 'sorted asc' : 'sorted') : ''),
    [sortKey, sortDir],
  );

  const focusRow = useCallback((index: number) => {
    setFocusedIndex(index);
    if (index >= 0) listRef.current?.scrollToRow({ index, align: 'smart' });
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          focusRow(Math.min(focusedIndex + 1, stats.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          focusRow(Math.max(focusedIndex - 1, 0));
          break;
        case 'Home':
          e.preventDefault();
          focusRow(0);
          break;
        case 'End':
          e.preventDefault();
          focusRow(stats.length - 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < stats.length) {
            onSelectFunction(stats[focusedIndex].id);
          }
          break;
      }
    },
    [stats, focusedIndex, onSelectFunction, focusRow],
  );

  return (
    <div
      className="table-container"
      ref={containerRef}
      role="grid"
      aria-label="Function profile data"
      aria-rowcount={stats.length + 1}
      onKeyDown={onKeyDown}
    >
      <div className="virtual-header" role="row" aria-rowindex={1}>
        <div
          role="columnheader"
          aria-sort={ariaSort('name', sortKey, sortDir)}
          className={`virtual-cell ${sortClass('name')}`}
          onClick={() => setSort('name')}
        >
          Function
        </div>
        <div
          role="columnheader"
          aria-sort={ariaSort('file', sortKey, sortDir)}
          className={`virtual-cell ${sortClass('file')}`}
          onClick={() => setSort('file')}
        >
          File
        </div>
        <div
          role="columnheader"
          aria-sort={ariaSort('selfCost', sortKey, sortDir)}
          className={`virtual-cell number ${sortClass('selfCost')}`}
          onClick={() => setSort('selfCost')}
        >
          Self
        </div>
        <div
          role="columnheader"
          aria-sort={ariaSort('totalCost', sortKey, sortDir)}
          className={`virtual-cell number ${sortClass('totalCost')}`}
          onClick={() => setSort('totalCost')}
        >
          Total
        </div>
        <div
          role="columnheader"
          aria-sort={ariaSort('calls', sortKey, sortDir)}
          className={`virtual-cell number ${sortClass('calls')}`}
          onClick={() => setSort('calls')}
        >
          Calls
        </div>
        <div
          role="columnheader"
          aria-sort={ariaSort('percent', sortKey, sortDir)}
          className={`virtual-cell percent ${sortClass('percent')}`}
          onClick={() => setSort('percent')}
        >
          % Total
        </div>
        <div role="columnheader" className="virtual-cell bar-cell">
          <span className="sr-only">Bar chart</span>
        </div>
      </div>
      <List
        listRef={listRef}
        role="presentation"
        style={{ height: height || 400 }}
        rowComponent={Row}
        rowCount={stats.length}
        rowHeight={LAYOUT.ROW_HEIGHT}
        rowProps={{
          stats,
          totalCost,
          focusedIndex,
          onOpenFile,
          onSelectFunction,
        }}
      />
    </div>
  );
});
