import { useMemo, useCallback, useState, useRef, useEffect, memo, type MouseEvent, type WheelEvent } from 'react';
import { pipe, Array as A, Option } from 'effect';
import { useProfileStore, useFunctionCost } from '../store';
import { useResizeObserver, useStatsData, useEdges, useEdgeIndex, useTotalCost } from '../hooks';
import { formatCost, calculatePercent, truncateName, getCostColor } from '../utils';
import { LAYOUT, LIMITS } from '../constants';
import type { FunctionStats, CallEdge } from '../../types';
import type { EdgeIndex } from '../utils/edgeIndex';

interface GraphNode {
  readonly id: number;
  readonly fn: FunctionStats;
  readonly x: number;
  readonly y: number;
  readonly depth: number;
}

interface GraphEdge {
  readonly from: GraphNode;
  readonly to: GraphNode;
  readonly edge: CallEdge;
}

interface Transform {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

const getVscode = (): Option.Option<{ postMessage: (m: unknown) => void }> =>
  Option.fromNullable((window as unknown as { vscode?: { postMessage: (m: unknown) => void } }).vscode);

const nodeWidth = LAYOUT.NODE_WIDTH + 20;
const nodeHeight = LAYOUT.NODE_HEIGHT + 60;

const findDescendants = (rootId: number, edgeIndex: EdgeIndex): Set<number> => {
  const result = new Set<number>();
  const queue = [{ id: rootId, depth: 0 }];
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (result.has(id)) continue;
    if (result.size >= LIMITS.MAX_GRAPH_NODES) break;
    if (depth > LIMITS.MAX_GRAPH_DEPTH) continue;
    result.add(id);
    const children = edgeIndex.get(id);
    if (children) {
      for (const e of children) {
        if (!result.has(e.calleeId)) queue.push({ id: e.calleeId, depth: depth + 1 });
      }
    }
  }
  return result;
};

const buildGraph = (
  stats: readonly FunctionStats[],
  edges: readonly CallEdge[],
  edgeIndex: EdgeIndex,
  statsMap: ReadonlyMap<number, FunctionStats>,
  selectedId: number | null,
  getTotalCost: (fn: FunctionStats) => number
) => {
  const functionsToShow = selectedId !== null
    ? findDescendants(selectedId, edgeIndex)
    : new Set(stats.map((s) => s.id));

  const hasCallers = new Set<number>();
  for (const e of edges) {
    if (functionsToShow.has(e.callerId) && functionsToShow.has(e.calleeId)) {
      hasCallers.add(e.calleeId);
    }
  }

  const roots = pipe(
    [...functionsToShow],
    A.filter((id) => !hasCallers.has(id)),
    A.map((id) => statsMap.get(id)),
    A.filter((fn): fn is FunctionStats => fn !== undefined),
    (arr) => [...arr].sort((a, b) => getTotalCost(b) - getTotalCost(a))
  );

  const depths = new Map<number, number>();
  const visited = new Set<number>();

  for (const root of roots) {
    if (visited.has(root.id)) continue;
    const queue: { id: number; depth: number }[] = [{ id: root.id, depth: 0 }];
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      depths.set(id, Math.max(depths.get(id) ?? 0, depth));
      const children = edgeIndex.get(id);
      if (children) {
        for (const e of children) {
          if (functionsToShow.has(e.calleeId) && !visited.has(e.calleeId)) {
            queue.push({ id: e.calleeId, depth: depth + 1 });
          }
        }
      }
    }
  }

  const byDepth = new Map<number, number[]>();
  for (const [id, d] of depths) {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  }

  for (const [, ids] of byDepth) {
    ids.sort((a, b) => {
      const fnA = statsMap.get(a), fnB = statsMap.get(b);
      return fnA && fnB ? getTotalCost(fnB) - getTotalCost(fnA) : 0;
    });
  }

  const nodeMap = new Map<number, GraphNode>();
  const maxDepth = Math.max(...byDepth.keys(), 0);
  let maxNodesInLevel = 0;

  for (const [d, ids] of byDepth) {
    maxNodesInLevel = Math.max(maxNodesInLevel, ids.length);
    const levelWidth = ids.length * nodeWidth;
    const startX = -levelWidth / 2 + nodeWidth / 2;
    ids.forEach((id, i) => {
      const fn = statsMap.get(id);
      if (fn) nodeMap.set(id, { id, fn, x: startX + i * nodeWidth, y: d * nodeHeight, depth: d });
    });
  }

  const graphEdges: GraphEdge[] = [];
  for (const e of edges) {
    const from = nodeMap.get(e.callerId), to = nodeMap.get(e.calleeId);
    if (from && to) graphEdges.push({ from, to, edge: e });
  }

  return {
    nodes: Array.from(nodeMap.values()),
    graphEdges,
    graphWidth: maxNodesInLevel * nodeWidth,
    graphHeight: (maxDepth + 1) * nodeHeight,
  };
};

export const CallGraph = memo(function CallGraph() {
  const [containerRef, dimensions] = useResizeObserver<HTMLDivElement>(40);
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const totalCost = useTotalCost();
  const selectedId = useProfileStore((s) => s.selectedFunctionId);
  const historyLength = useProfileStore((s) => s.callGraphHistory.length);
  const selectFunction = useProfileStore((s) => s.selectFunction);
  const goBack = useProfileStore((s) => s.goBack);
  const clearSelection = useProfileStore((s) => s.clearSelection);
  const { stats, statsMap } = useStatsData();
  const edges = useEdges();
  const edgeIndex = useEdgeIndex();
  const { getTotalCost, getEdgeCost } = useFunctionCost();

  const { nodes, graphEdges, graphWidth, graphHeight } = useMemo(
    () => buildGraph(stats, edges, edgeIndex, statsMap, selectedId, getTotalCost),
    [stats, edges, edgeIndex, statsMap, selectedId, getTotalCost]
  );

  useEffect(() => {
    if (dimensions.width > 0 && dimensions.height > 0) {
      const scale = Math.min(dimensions.width / (graphWidth + 100), dimensions.height / (graphHeight + 100), 1);
      setTransform({ x: dimensions.width / 2, y: 50, scale: Math.max(0.3, scale) });
    }
  }, [dimensions.width, dimensions.height, graphWidth, graphHeight, selectedId]);

  const onOpenFile = useCallback(
    (path: string, line: number) =>
      pipe(
        getVscode(),
        Option.map((vs) => vs.postMessage({ type: 'openFile', path, line }))
      ),
    []
  );

  const onMouseDown = useCallback((e: MouseEvent) => {
    if (e.button === 0) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
    }
  }, [transform]);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (isPanning) setTransform((t) => ({ ...t, x: e.clientX - panStart.x, y: e.clientY - panStart.y }));
  }, [isPanning, panStart]);

  const onMouseUp = useCallback(() => setIsPanning(false), []);

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    pipe(
      Option.fromNullable(svgRef.current?.getBoundingClientRect()),
      Option.map((rect) => {
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(0.1, Math.min(3, transform.scale * delta));
        const scaleChange = newScale / transform.scale;
        setTransform((t) => ({ x: mx - (mx - t.x) * scaleChange, y: my - (my - t.y) * scaleChange, scale: newScale }));
      })
    );
  }, [transform.scale]);

  const onReset = useCallback(() => {
    const scale = Math.min(dimensions.width / (graphWidth + 100), dimensions.height / (graphHeight + 100), 1);
    setTransform({ x: dimensions.width / 2, y: 50, scale: Math.max(0.3, scale) });
  }, [dimensions, graphWidth, graphHeight]);

  return (
    <div className="callgraph-container" ref={containerRef}>
      <div className="callgraph-nav">
        {selectedId !== null ? (
          <>
            <button className="callgraph-back" onClick={goBack} disabled={historyLength === 0}>← Back</button>
            <button className="callgraph-back" onClick={clearSelection}>Show All</button>
          </>
        ) : (
          <span className="callgraph-hint">Click a function to focus on it and its callees</span>
        )}
        <button className="callgraph-back" onClick={onReset}>Reset View</button>
        <span className="callgraph-breadcrumb">{nodes.length} functions | Zoom: {(transform.scale * 100).toFixed(0)}%</span>
      </div>

      <svg
        ref={svgRef}
        className="callgraph-svg"
        width={dimensions.width}
        height={dimensions.height}
        role="img"
        aria-label={`Call graph visualization with ${nodes.length} functions`}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      >
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {graphEdges.map(({ from, to, edge }) => {
            const cost = getEdgeCost(edge);
            const strokeWidth = Math.max(1, Math.min(4, (cost / totalCost) * 40));
            const x1 = from.x, y1 = from.y + LAYOUT.NODE_HEIGHT, x2 = to.x, y2 = to.y, midY = (y1 + y2) / 2;
            return (
              <path
                key={`edge-${from.id}-${to.id}`}
                d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                fill="none"
                className="callgraph-edge"
                strokeWidth={strokeWidth}
              />
            );
          })}
          {nodes.map((node) => {
            const isSelected = node.id === selectedId;
            const cost = getTotalCost(node.fn);
            const percent = calculatePercent(cost, totalCost);
            return (
              <g
                key={`node-${node.id}`}
                className={`callgraph-node ${isSelected ? 'selected' : 'clickable'}`}
                onClick={(e) => { e.stopPropagation(); isSelected ? onOpenFile(node.fn.file, node.fn.line) : selectFunction(node.id); }}
                transform={`translate(${node.x - LAYOUT.NODE_WIDTH / 2}, ${node.y})`}
              >
                <title>{`${node.fn.name} - ${percent.toFixed(1)}% of total cost`}</title>
                <rect width={LAYOUT.NODE_WIDTH} height={LAYOUT.NODE_HEIGHT} rx="4" fill={getCostColor(cost, totalCost)} className={`callgraph-node-rect ${isSelected ? 'selected' : ''}`} />
                <text x={LAYOUT.NODE_WIDTH / 2} y={18} className={`callgraph-node-name ${isSelected ? 'selected' : ''}`}>{truncateName(node.fn.name, 20)}</text>
                <text x={LAYOUT.NODE_WIDTH / 2} y={35} className="callgraph-node-cost">{percent.toFixed(1)}% • {formatCost(cost)}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
});
