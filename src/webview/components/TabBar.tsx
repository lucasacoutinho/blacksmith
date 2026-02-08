import { memo, useCallback, useMemo, useRef, type KeyboardEvent } from 'react';
import { useProfileStore, type TabId } from '../store';

const BASE_TABS: ReadonlyArray<{ readonly id: TabId; readonly label: string }> = [
  { id: 'flat', label: 'Flat Profile' },
  { id: 'callgraph', label: 'Call Graph' },
  { id: 'callermap', label: 'Caller Map' },
  { id: 'flamegraph', label: 'Flame Graph' },
];

const DIFF_TAB: { readonly id: TabId; readonly label: string } = { id: 'diff', label: 'Diff' };

export const TabBar = memo(function TabBar() {
  const activeTab = useProfileStore((s) => s.activeTab);
  const setActiveTab = useProfileStore((s) => s.setActiveTab);
  const hasDiff = useProfileStore((s) => s.diff !== null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const TABS = useMemo(
    () => hasDiff ? [...BASE_TABS, DIFF_TAB] : BASE_TABS,
    [hasDiff]
  );

  const onClick = useCallback((id: TabId) => setActiveTab(id), [setActiveTab]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;

      switch (e.key) {
        case 'ArrowRight':
          nextIndex = (index + 1) % TABS.length;
          break;
        case 'ArrowLeft':
          nextIndex = (index - 1 + TABS.length) % TABS.length;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = TABS.length - 1;
          break;
        default:
          return;
      }

      e.preventDefault();
      const tab = TABS[nextIndex];
      setActiveTab(tab.id);
      tabRefs.current[nextIndex]?.focus();
    },
    [setActiveTab, TABS]
  );

  return (
    <div className="tabs" role="tablist" aria-label="Profile views">
      {TABS.map((tab, index) => (
        <button
          key={tab.id}
          ref={(el) => { tabRefs.current[index] = el; }}
          id={`tab-${tab.id}`}
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`tabpanel-${tab.id}`}
          tabIndex={activeTab === tab.id ? 0 : -1}
          className={`tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onClick(tab.id)}
          onKeyDown={(e) => onKeyDown(e, index)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
});
