import { memo, useCallback } from 'react';
import { useProfileStore, type TabId } from '../store';

const TABS: ReadonlyArray<{ readonly id: TabId; readonly label: string }> = [
  { id: 'flat', label: 'Flat Profile' },
  { id: 'callgraph', label: 'Call Graph' },
  { id: 'callermap', label: 'Caller Map' },
  { id: 'flamegraph', label: 'Flame Graph' },
];

export const TabBar = memo(function TabBar() {
  const activeTab = useProfileStore((s) => s.activeTab);
  const setActiveTab = useProfileStore((s) => s.setActiveTab);

  const onClick = useCallback((id: TabId) => setActiveTab(id), [setActiveTab]);

  return (
    <div className="tabs">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onClick(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
});
