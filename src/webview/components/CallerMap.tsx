import { useMemo, useState, useCallback, memo, type MouseEvent } from 'react';
import { pipe, Array as A } from 'effect';
import { useProfileStore, useFunctionCost } from '../store';
import { useResizeObserver, useStats, useTotalCost } from '../hooks';
import { getCostColor, calculatePercent } from '../utils';
import { LIMITS } from '../constants';
import { Tooltip } from './Tooltip';

interface TreemapRect {
  readonly id: number;
  readonly name: string;
  readonly cost: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface TreemapItem {
  readonly id: number;
  readonly name: string;
  readonly cost: number;
}

const aspectRatio = (size1: number, size2: number): number =>
  Math.max(size1 / size2, size2 / size1);

const truncateName = (name: string, width: number): string =>
  pipe(Math.floor(width / 8), (maxLen) =>
    name.length > maxLen ? `${name.slice(0, maxLen - 2)}..` : name,
  );

const worstAspect = (
  items: readonly TreemapItem[],
  totalCost: number,
  rowCost: number,
  rowSize: number,
  isHorizontal: boolean,
  containerSize: number,
): number =>
  Math.max(
    ...items.map((item) => {
      const itemFraction = item.cost / rowCost;
      const itemSize = isHorizontal ? containerSize * itemFraction : containerSize * itemFraction;
      return aspectRatio(rowSize, itemSize);
    }),
  );

const squarifyLayout = (
  items: readonly TreemapItem[],
  x: number,
  y: number,
  width: number,
  height: number,
): TreemapRect[] => {
  if (items.length === 0 || width <= 0 || height <= 0) return [];

  if (items.length === 1) {
    return [{ ...items[0], x, y, width: Math.max(0, width), height: Math.max(0, height) }];
  }

  const itemsCost = items.reduce((sum, f) => sum + f.cost, 0);
  const isHorizontal = width >= height;

  let row: TreemapItem[] = [];
  let rowCost = 0;
  let splitIndex = items.length;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const testRow = [...row, item];
    const testCost = rowCost + item.cost;
    const rowFraction = testCost / itemsCost;
    const rowSize = isHorizontal ? width * rowFraction : height * rowFraction;
    const containerSize = isHorizontal ? height : width;
    const worst = worstAspect(testRow, itemsCost, testCost, rowSize, isHorizontal, containerSize);

    if (row.length > 0 && worst > 4) {
      splitIndex = i;
      break;
    }

    row = testRow;
    rowCost = testCost;
  }

  const rowFraction = rowCost / itemsCost;
  let currentPos = 0;
  const result: TreemapRect[] = [];

  for (const item of row) {
    const itemFraction = item.cost / rowCost;
    if (isHorizontal) {
      const itemHeight = height * itemFraction;
      const rowWidth = width * rowFraction;
      result.push({ ...item, x, y: y + currentPos, width: rowWidth, height: itemHeight });
      currentPos += itemHeight;
    } else {
      const itemWidth = width * itemFraction;
      const rowHeight = height * rowFraction;
      result.push({ ...item, x: x + currentPos, y, width: itemWidth, height: rowHeight });
      currentPos += itemWidth;
    }
  }

  const remaining = items.slice(splitIndex);
  if (remaining.length > 0) {
    const rects = isHorizontal
      ? squarifyLayout(remaining, x + width * rowFraction, y, width * (1 - rowFraction), height)
      : squarifyLayout(remaining, x, y + height * rowFraction, width, height * (1 - rowFraction));
    result.push(...rects);
  }

  return result;
};

export const CallerMap = memo(function CallerMap() {
  const [containerRef, dimensions] = useResizeObserver<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; rect: TreemapRect } | null>(null);

  const totalCost = useTotalCost();
  const selectedId = useProfileStore((s) => s.selectedFunctionId);
  const selectFunction = useProfileStore((s) => s.selectFunction);
  const setActiveTab = useProfileStore((s) => s.setActiveTab);
  const stats = useStats();
  const { getTotalCost } = useFunctionCost();

  const rects = useMemo(() => {
    if (dimensions.width === 0) return [];

    return pipe(
      stats,
      A.map((fn) => ({ id: fn.id, name: fn.name, cost: getTotalCost(fn) })),
      A.filter((f) => f.cost > 0),
      (arr) => [...arr].sort((a, b) => b.cost - a.cost),
      A.take(LIMITS.MAX_TREEMAP_ITEMS),
      (items) => squarifyLayout(items, 0, 0, dimensions.width, dimensions.height),
    );
  }, [stats, dimensions, getTotalCost]);

  const onSelect = useCallback(
    (id: number) => {
      selectFunction(id);
      setActiveTab('callgraph');
    },
    [selectFunction, setActiveTab],
  );

  const onMouseMove = useCallback((e: MouseEvent, rect: TreemapRect) => {
    setTooltip({ x: e.clientX, y: e.clientY, rect });
  }, []);

  const onMouseLeave = useCallback(() => setTooltip(null), []);

  return (
    <div className="callermap-container" ref={containerRef}>
      <svg
        className="callermap-svg"
        width={dimensions.width}
        height={dimensions.height}
        role="img"
        aria-label={`Caller map treemap visualization with ${rects.length} functions`}
      >
        {rects.map((rect) => (
          <g
            key={rect.id}
            className={`callermap-rect ${selectedId === rect.id ? 'selected' : ''}`}
            onClick={() => onSelect(rect.id)}
            onMouseMove={(e) => onMouseMove(e, rect)}
            onMouseLeave={onMouseLeave}
          >
            <title>{`${rect.name} - ${calculatePercent(rect.cost, totalCost).toFixed(1)}% of total cost`}</title>
            <rect
              x={rect.x + 1}
              y={rect.y + 1}
              width={Math.max(0, rect.width - 2)}
              height={Math.max(0, rect.height - 2)}
              fill={getCostColor(rect.cost, totalCost)}
              className="callermap-rect-bg"
            />
            {rect.width > 60 && rect.height > 30 && (
              <text
                x={rect.x + rect.width / 2}
                y={rect.y + rect.height / 2}
                className="callermap-text"
              >
                {truncateName(rect.name, rect.width)}
              </text>
            )}
          </g>
        ))}
      </svg>
      {tooltip && (
        <Tooltip
          x={tooltip.x}
          y={tooltip.y}
          name={tooltip.rect.name}
          cost={tooltip.rect.cost}
          totalCost={totalCost}
        />
      )}
    </div>
  );
});
