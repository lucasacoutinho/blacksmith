import { memo, useState, useCallback, useRef, useEffect, type ChangeEvent } from 'react';
import { pipe, Option } from 'effect';
import { useProfileStore, useFunctionCost } from '../store';
import { useFilteredStats, useTotalCost, useEventTypes, useCurrentMetric, useDebouncedCallback } from '../hooks';
import { formatCost, exportCSV, exportJSON } from '../utils';

const getVscode = (): Option.Option<{ postMessage: (m: unknown) => void }> =>
  Option.fromNullable((window as unknown as { vscode?: { postMessage: (m: unknown) => void } }).vscode);

export const Header = memo(function Header() {
  const filename = useProfileStore((s) => s.filename);
  const search = useProfileStore((s) => s.search);
  const setSearch = useProfileStore((s) => s.setSearch);
  const selectedMetricIndex = useProfileStore((s) => s.selectedMetricIndex);
  const setMetricIndex = useProfileStore((s) => s.setMetricIndex);
  const searchRef = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const eventTypes = useEventTypes();
  const totalCost = useTotalCost();
  const currentMetric = useCurrentMetric();
  const filteredStats = useFilteredStats();
  const { getSelfCost, getTotalCost } = useFunctionCost();

  const [localSearch, setLocalSearch] = useState(search);
  const debouncedSetSearch = useDebouncedCallback(setSearch, 200);

  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  // Auto-focus search on profile load
  useEffect(() => {
    const timer = setTimeout(() => searchRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  const onSearchChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setLocalSearch(value);
      debouncedSetSearch(value);
    },
    [debouncedSetSearch]
  );

  const onMetricChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => setMetricIndex(parseInt(e.target.value, 10)),
    [setMetricIndex]
  );

  const onExport = useCallback(
    (format: 'csv' | 'json') => {
      const getCosts = (fn: typeof filteredStats[number]) => ({
        selfCost: getSelfCost(fn),
        totalCost: getTotalCost(fn),
      });
      const content = format === 'csv'
        ? exportCSV(filteredStats, getCosts)
        : exportJSON(filteredStats, getCosts);

      pipe(
        getVscode(),
        Option.map((vs) => vs.postMessage({ type: 'export', format, content }))
      );
      setExportOpen(false);
    },
    [filteredStats, getSelfCost, getTotalCost]
  );

  return (
    <div className="header">
      <h1>{filename}</h1>
      <input
        ref={searchRef}
        className="search-box"
        type="text"
        placeholder="Search functions..."
        aria-label="Search functions by name or file path"
        value={localSearch}
        onChange={onSearchChange}
      />
      {eventTypes.length > 1 && (
        <select
          className="metric-selector"
          value={selectedMetricIndex}
          onChange={onMetricChange}
        >
          {eventTypes.map((name, idx) => (
            <option key={idx} value={idx}>{name}</option>
          ))}
        </select>
      )}
      <div className="export-container">
        <button
          className="export-btn"
          onClick={() => setExportOpen(!exportOpen)}
          aria-label="Export profile data"
        >
          Export ▾
        </button>
        {exportOpen && (
          <div className="export-dropdown">
            <button className="export-option" onClick={() => onExport('csv')}>Export as CSV</button>
            <button className="export-option" onClick={() => onExport('json')}>Export as JSON</button>
          </div>
        )}
      </div>
      <span className="stats">
        {filteredStats.length} functions | Total: {formatCost(totalCost)} {currentMetric}
      </span>
    </div>
  );
});
