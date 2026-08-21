/** Small JSON request helper for operator commands and page data. */
export async function requestJson(url, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  const init = { ...options, headers };
  if (options.body !== undefined && typeof options.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.detail;
    const message = typeof detail === 'string' ? detail : detail?.message;
    const error = new Error(message ?? `Request failed (${response.status})`);
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  return payload;
}
