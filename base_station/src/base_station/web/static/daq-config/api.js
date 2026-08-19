/** Thin fetch client for the DAQ configuration endpoints. */

export async function loadCapabilities() {
  return request('/api/daq/capabilities');
}

export async function loadConfiguration() {
  return request('/api/daq/configuration');
}

/** @param {Object} graph */
export async function saveConfiguration(graph) {
  return request('/api/daq/configuration', { method: 'PUT', body: JSON.stringify(graph) });
}

/** @param {Object} graph */
export async function previewConfiguration(graph) {
  return request('/api/daq/preview', { method: 'POST', body: JSON.stringify(graph) });
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
