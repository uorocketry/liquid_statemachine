/** Thin fetch client for section-owned DAQ configuration APIs. */
import { requestJson } from '../json-request.js';

export async function loadCapabilities() {
  return requestJson('/api/daq/capabilities');
}

export async function loadGraph() {
  return requestJson('/api/daq/graph');
}

/** @param {Object} graph */
export async function saveGraph(graph) {
  return requestJson('/api/daq/graph', { method: 'PUT', body: graph });
}

export async function loadLabJackSettings() {
  return requestJson('/api/sources/labjack/settings');
}

/** @param {Object} settings */
export async function saveLabJackSettings(settings) {
  return requestJson('/api/sources/labjack/settings', { method: 'PUT', body: settings });
}

export async function loadDashboardLayout() {
  return requestJson('/api/dashboard/layout');
}

/** @param {Object} layout */
export async function saveDashboardLayout(layout) {
  return requestJson('/api/dashboard/layout', { method: 'PUT', body: layout });
}

export async function saveDashboardItems(items) {
  return requestJson('/api/dashboard/layout/items', { method: 'PUT', body: items });
}

export async function saveDashboardViews(views) {
  return requestJson('/api/dashboard/layout/views', { method: 'PUT', body: views });
}

export async function resetDashboardHistory() {
  return requestJson('/api/dashboard/history/reset', { method: 'POST' });
}
