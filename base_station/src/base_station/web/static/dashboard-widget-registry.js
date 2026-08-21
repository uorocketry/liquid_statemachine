import { createGaugeWidget, updateGaugeWidget } from './dashboard-gauge.js';
import { createNumberWidget, updateNumberWidget } from './dashboard-number.js';
import { createTimePlotWidget } from './dashboard-time-plot.js';

const WIDGETS = {
  number: { create: createNumberWidget, update: updateNumberWidget, timeline: false, history: false },
  gauge: { create: createGaugeWidget, update: updateGaugeWidget, timeline: false, history: true },
  'time-plot': { create: createTimePlotWidget, update: () => {}, timeline: true, history: true },
};

export const DASHBOARD_NODE_TYPES = new Set(Object.keys(WIDGETS));

export function createDashboardWidget(node) {
  const renderer = WIDGETS[node.nodeType];
  if (!renderer) throw new Error(`Unknown dashboard widget: ${node.nodeType}`);
  return renderer.create(node);
}

export function updateDashboardWidget(card, node, reading) {
  WIDGETS[node.nodeType]?.update(card, node, reading);
}

export function usesTimeline(node) {
  return Boolean(WIDGETS[node.nodeType]?.timeline);
}

export function usesHistory(node) {
  return Boolean(WIDGETS[node.nodeType]?.history);
}
