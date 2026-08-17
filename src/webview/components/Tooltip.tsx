import { useCallback, useState, memo } from 'react';
import { pipe } from 'effect';
import { LAYOUT } from '../constants';
import { formatCost, formatPercent } from '../utils';
import type { Cost } from '../../types';

interface TooltipProps {
  readonly x: number;
  readonly y: number;
  readonly name: string;
  readonly cost: Cost;
  readonly totalCost: Cost;
}

const clamp =
  (min: number, max: number) =>
  (value: number): number =>
    Math.max(min, Math.min(max, value));

export const Tooltip = memo(function Tooltip({ x, y, name, cost, totalCost }: TooltipProps) {
  const [position, setPosition] = useState({
    left: x + LAYOUT.TOOLTIP_OFFSET,
    top: y + LAYOUT.TOOLTIP_OFFSET,
  });

  const ref = useCallback(
    (tooltip: HTMLDivElement | null) => {
      if (!tooltip) return;

      const rect = tooltip.getBoundingClientRect();
      const { innerWidth: vw, innerHeight: vh } = window;

      const left = pipe(
        x + rect.width > vw - LAYOUT.TOOLTIP_MARGIN
          ? x - rect.width - LAYOUT.TOOLTIP_OFFSET
          : x + LAYOUT.TOOLTIP_OFFSET,
        clamp(LAYOUT.TOOLTIP_MARGIN, vw - rect.width - LAYOUT.TOOLTIP_MARGIN),
      );

      const top = pipe(
        y + rect.height > vh - LAYOUT.TOOLTIP_MARGIN
          ? y - rect.height - LAYOUT.TOOLTIP_OFFSET
          : y + LAYOUT.TOOLTIP_OFFSET,
        clamp(LAYOUT.TOOLTIP_MARGIN, vh - rect.height - LAYOUT.TOOLTIP_MARGIN),
      );

      setPosition({ left, top });
    },
    [x, y],
  );

  return (
    <div ref={ref} className="flamegraph-tooltip" style={position}>
      <div className="flamegraph-tooltip-name">{name}</div>
      <div className="flamegraph-tooltip-stats">
        <span>Cost: {formatCost(cost)}</span>
        <span>{formatPercent(cost, totalCost)} of total</span>
      </div>
    </div>
  );
});
