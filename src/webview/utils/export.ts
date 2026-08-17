import type { Cost, FunctionStats } from '../../types';

export const exportCSV = (
  stats: readonly FunctionStats[],
  getCosts: (fn: FunctionStats) => { selfCost: Cost; totalCost: Cost },
): string => {
  const header = 'Function,File,Line,Self Cost,Total Cost,Calls';
  const rows = stats.map((fn) => {
    const { selfCost, totalCost } = getCosts(fn);
    const name = fn.name.includes(',') ? `"${fn.name}"` : fn.name;
    const file = fn.file.includes(',') ? `"${fn.file}"` : fn.file;
    return `${name},${file},${fn.line},${selfCost},${totalCost},${fn.calls}`;
  });
  return [header, ...rows].join('\n');
};

export const exportJSON = (
  stats: readonly FunctionStats[],
  getCosts: (fn: FunctionStats) => { selfCost: Cost; totalCost: Cost },
): string => {
  const data = stats.map((fn) => {
    const { selfCost, totalCost } = getCosts(fn);
    return {
      name: fn.name,
      file: fn.file,
      line: fn.line,
      selfCost,
      totalCost,
      calls: fn.calls,
    };
  });
  return JSON.stringify(data, null, 2);
};
