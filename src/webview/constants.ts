export const LAYOUT = {
  ROW_HEIGHT: 28,
  NODE_WIDTH: 180,
  NODE_HEIGHT: 50,
  VERTICAL_GAP: 80,
  HORIZONTAL_GAP: 20,
  FRAME_HEIGHT: 20,
  TOOLTIP_OFFSET: 10,
  TOOLTIP_MARGIN: 10,
} as const;

export const LIMITS = {
  MAX_VISIBLE_CALLERS: 5,
  MAX_VISIBLE_CALLEES: 5,
  MAX_TREEMAP_ITEMS: 50,
  MIN_FRAME_WIDTH: 0.001,
  TOP_FUNCTIONS_COUNT: 10,
} as const;

export const COST_THRESHOLDS = {
  HOT: 0.3,
  WARM: 0.15,
  MEDIUM: 0.05,
  COOL: 0.01,
} as const;

export const COST_COLORS = {
  HOT: '#e74c3c',
  WARM: '#e67e22',
  MEDIUM: '#f1c40f',
  COOL: '#2ecc71',
  COLD: '#3498db',
} as const;

export type CostLevel = keyof typeof COST_COLORS;
