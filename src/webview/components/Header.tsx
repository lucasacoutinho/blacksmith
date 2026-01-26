import { memo, useCallback, type ChangeEvent } from 'react';
import { useProfileStore } from '../store';
import { useFilteredStats, useTotalCost, useEventTypes, useCurrentMetric } from '../hooks';
import { formatCost } from '../utils';

export const Header = memo(function Header() {
  const filename = useProfileStore((s) => s.filename);
  const search = useProfileStore((s) => s.search);
  const setSearch = useProfileStore((s) => s.setSearch);
  const selectedMetricIndex = useProfileStore((s) => s.selectedMetricIndex);
  const setMetricIndex = useProfileStore((s) => s.setMetricIndex);

  const eventTypes = useEventTypes();
  const totalCost = useTotalCost();
  const currentMetric = useCurrentMetric();
  const filteredStats = useFilteredStats();

  const onSearchChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value),
    [setSearch]
  );

  const onMetricChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => setMetricIndex(parseInt(e.target.value, 10)),
    [setMetricIndex]
  );

  return (
    <div className="header">
      <h1>{filename}</h1>
      <input
        className="search-box"
        type="text"
        placeholder="Search functions..."
        value={search}
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
      <span className="stats">
        {filteredStats.length} functions | Total: {formatCost(totalCost)} {currentMetric}
      </span>
    </div>
  );
});
