/** Thin fetch client for section-owned DAQ configuration APIs. */

export async function loadCapabilities() {
  return request('/api/daq/capabilities');
}

export async function loadGraph() {
  return request('/api/daq/graph');
}

/** @param {Object} graph */
export async function saveGraph(graph) {
  return request('/api/daq/graph', { method: 'PUT', body: JSON.stringify(graph) });
}

export async function loadLabJackSettings() {
  return request('/api/sources/labjack/settings');
}

/** @param {Object} settings */
export async function saveLabJackSettings(settings) {
  return request('/api/sources/labjack/settings', { method: 'PUT', body: JSON.stringify(settings) });
}

export async function loadDashboardLayout() {
  return request('/api/dashboard/layout');
}

/** @param {Object} layout */
export async function saveDashboardLayout(layout) {
  return request('/api/dashboard/layout', { method: 'PUT', body: JSON.stringify(layout) });
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.detail?.message ?? `Request failed (${response.status})`);
    error.status = response.status;
    error.detail = payload.detail;
    throw error;
  }
  return payload;
}
