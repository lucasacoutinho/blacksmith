import { useRef, useState, useMemo, useCallback, memo, type MouseEvent } from 'react';
import { pipe, Array as A, Option } from 'effect';
import { useProfileStore, useFunctionCost } from '../store';
import { useResizeObserver, useStatsData, useEdges, useEdgeIndex, useTotalCost } from '../hooks';
import { getCostColor } from '../utils';
import { LAYOUT, LIMITS } from '../constants';
import { Tooltip } from './Tooltip';
import type { Cost, FunctionStats, CallEdge } from '../../types';
import type { EdgeIndex } from '../utils/edge-index';
import { ZERO_COST, addCosts, compareCosts, costRatio, isZeroCost } from '../../cost';

interface FlameFrame {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly width: number;
  readonly depth: number;
  readonly cost: Cost;
}

interface ZoomState {
  readonly x: number;
  readonly width: number;
}

const findRoots = (
  stats: readonly FunctionStats[],
  edges: readonly CallEdge[],
  getTotalCost: (fn: FunctionStats) => Cost,
): readonly FunctionStats[] => {
  const hasCallers = new Set(edges.map((e) => e.calleeId));
  const roots = pipe(
    stats,
    A.filter((s) => !hasCallers.has(s.id)),
    (arr) => [...arr].sort((a, b) => compareCosts(getTotalCost(b), getTotalCost(a))),
  );
  return roots.length > 0
    ? roots
    : [...stats].sort((a, b) => compareCosts(getTotalCost(b), getTotalCost(a))).slice(0, 5);
};

const buildFrames = (
  stats: readonly FunctionStats[],
  edges: readonly CallEdge[],
  edgeIndex: EdgeIndex,
  statsMap: ReadonlyMap<number, FunctionStats>,
  getTotalCost: (fn: FunctionStats) => Cost,
  getEdgeCost: (edge: CallEdge) => Cost,
): readonly FlameFrame[] => {
  const roots = findRoots(stats, edges, getTotalCost);
  const rootTotalCost = roots.reduce((sum, root) => addCosts(sum, getTotalCost(root)), ZERO_COST);

  const result: FlameFrame[] = [];
  const visited = new Set<number>();
  const stack: { fnId: number; x: number; width: number; depth: number }[] = [];

  let x = 0;
  for (const root of roots) {
    const width = isZeroCost(rootTotalCost)
      ? 1 / roots.length
      : costRatio(getTotalCost(root), rootTotalCost);
    stack.push({ fnId: root.id, x, width, depth: 0 });
    x += width;
  }

  while (stack.length > 0) {
    const { fnId, x: frameX, width, depth } = stack.pop()!;
    if (visited.has(fnId)) continue;
    visited.add(fnId);

    const fn = statsMap.get(fnId);
    if (!fn) continue;

    result.push({ id: fnId, name: fn.name, x: frameX, width, depth, cost: getTotalCost(fn) });

    const calleeEdges = edgeIndex.get(fnId);
    if (!calleeEdges || calleeEdges.length === 0) continue;

    const sorted = [...calleeEdges].sort((a, b) => compareCosts(getEdgeCost(a), getEdgeCost(b)));
    const totalCalleeCost = sorted.reduce(
      (sum, edge) => addCosts(sum, getEdgeCost(edge)),
      ZERO_COST,
    );
    let currentX = frameX;

    for (const edge of sorted) {
      const edgeCost = getEdgeCost(edge);
      const calleeWidth = isZeroCost(totalCalleeCost)
        ? width / sorted.length
        : costRatio(edgeCost, totalCalleeCost) * width;

      if (calleeWidth > LIMITS.MIN_FRAME_WIDTH) {
        stack.push({ fnId: edge.calleeId, x: currentX, width: calleeWidth, depth: depth + 1 });
      }
      currentX += calleeWidth;
    }
  }

  return result;
};

const findFrameAtPosition = (
  frames: readonly FlameFrame[],
  zoom: ZoomState,
  canvasRect: DOMRect,
  clientX: number,
  clientY: number,
): Option.Option<FlameFrame> => {
  const x = (clientX - canvasRect.left) / canvasRect.width;
  const y = clientY - canvasRect.top;
  const depth = Math.floor((canvasRect.height - y) / LAYOUT.FRAME_HEIGHT);

  return pipe(
    frames,
    A.findFirst((f) => {
      const frameX = (f.x - zoom.x) / zoom.width;
      const frameW = f.width / zoom.width;
      return f.depth === depth && x >= frameX && x < frameX + frameW;
    }),
  );
};

const drawFlameGraph = (
  ctx: CanvasRenderingContext2D,
  frames: readonly FlameFrame[],
  zoom: ZoomState,
  totalCost: Cost,
  width: number,
  height: number,
): void => {
  const bgColor =
    getComputedStyle(document.body).getPropertyValue('--vscode-editor-background') || '#1e1e1e';
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  for (const frame of frames) {
    const frameX = (frame.x - zoom.x) / zoom.width;
    const frameW = frame.width / zoom.width;

    if (frameX + frameW < 0 || frameX > 1) continue;

    const x = frameX * width;
    const w = frameW * width;
    const y = height - (frame.depth + 1) * LAYOUT.FRAME_HEIGHT;

    if (w < 1) continue;

    ctx.fillStyle = getCostColor(frame.cost, totalCost);
    ctx.fillRect(x + 1, y + 1, w - 2, LAYOUT.FRAME_HEIGHT - 2);

    if (w > 40) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px monospace';
      ctx.textBaseline = 'middle';

      const maxChars = Math.floor((w - 8) / 7);
      const displayText =
        frame.name.length > maxChars ? `${frame.name.slice(0, maxChars - 2)}..` : frame.name;

      ctx.fillText(displayText, x + 4, y + LAYOUT.FRAME_HEIGHT / 2);
    }
  }
};

export const FlameGraph = memo(function FlameGraph() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [containerRef, dimensions] = useResizeObserver<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; frame: FlameFrame } | null>(null);
  const [zoom, setZoom] = useState<ZoomState>({ x: 0, width: 1 });

  const totalCost = useTotalCost();
  const selectFunction = useProfileStore((s) => s.selectFunction);
  const { stats, statsMap } = useStatsData();
  const edges = useEdges();
  const edgeIndex = useEdgeIndex();
  const { getTotalCost, getEdgeCost } = useFunctionCost();

  const frames = useMemo(
    () => buildFrames(stats, edges, edgeIndex, statsMap, getTotalCost, getEdgeCost),
    [stats, edges, edgeIndex, statsMap, getTotalCost, getEdgeCost],
  );

  const maxDepth = useMemo(() => frames.reduce((max, f) => Math.max(max, f.depth), 0), [frames]);

  const drawCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      canvasRef.current = canvas;
      if (!canvas || dimensions.width <= 0 || dimensions.height <= 0) return;

      const context = canvas.getContext('2d');
      if (!context) return;

      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = dimensions.width * pixelRatio;
      canvas.height = dimensions.height * pixelRatio;
      canvas.style.width = `${dimensions.width}px`;
      canvas.style.height = `${dimensions.height}px`;
      context.scale(pixelRatio, pixelRatio);
      drawFlameGraph(context, frames, zoom, totalCost, dimensions.width, dimensions.height);
    },
    [frames, zoom, totalCost, dimensions.width, dimensions.height],
  );

  const findFrame = useCallback(
    (clientX: number, clientY: number): Option.Option<FlameFrame> => {
      const canvas = canvasRef.current;
      if (!canvas) return Option.none();
      return findFrameAtPosition(frames, zoom, canvas.getBoundingClientRect(), clientX, clientY);
    },
    [frames, zoom],
  );

  const onMouseMove = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      pipe(
        findFrame(e.clientX, e.clientY),
        Option.match({
          onNone: () => setTooltip(null),
          onSome: (frame) => setTooltip({ x: e.clientX, y: e.clientY, frame }),
        }),
      );
    },
    [findFrame],
  );

  const onClick = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      pipe(
        findFrame(e.clientX, e.clientY),
        Option.map((frame) => {
          setZoom({ x: frame.x, width: frame.width });
          selectFunction(frame.id);
        }),
      );
    },
    [findFrame, selectFunction],
  );

  const onReset = useCallback(() => setZoom({ x: 0, width: 1 }), []);

  return (
    <div className="flamegraph-container">
      <div className="flamegraph-controls">
        <button className="callgraph-back" onClick={onReset}>
          Reset Zoom
        </button>
        <span className="stats">
          {frames.length} frames | Max depth: {maxDepth + 1}
        </span>
      </div>
      <div className="flamegraph-canvas-container" ref={containerRef}>
        <canvas
          ref={drawCanvas}
          className="flamegraph-canvas"
          role="img"
          aria-label={`Flame graph visualization with ${frames.length} frames, max depth ${maxDepth + 1}`}
          onMouseMove={onMouseMove}
          onMouseLeave={() => setTooltip(null)}
          onClick={onClick}
        />
      </div>
      {tooltip && (
        <Tooltip
          x={tooltip.x}
          y={tooltip.y}
          name={tooltip.frame.name}
          cost={tooltip.frame.cost}
          totalCost={totalCost}
        />
      )}
    </div>
  );
});
