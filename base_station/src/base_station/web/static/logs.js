import { bindPageResource } from './page-resource-lifecycle.js';

(() => {
  const workspace = document.querySelector('#logs-workspace');
  const body = workspace?.querySelector('[data-log-body]');
  const filters = workspace?.querySelector('.log-filters');
  if (!workspace || !body || !filters || !('EventSource' in window)) return;

  let logs = [];
  const render = () => {
    const component = filters.elements.component.value;
    const level = filters.elements.level.value;
    const visible = logs.filter((entry) => (
      (!component || entry.component === component) && (!level || entry.level === level)
    ));
    body.replaceChildren(...visible.slice().reverse().map(logRow));
  };

  filters.addEventListener('change', render);
  filters.addEventListener('submit', (event) => event.preventDefault());
  let source = null;
  const onLogs = (event) => {
    try {
      const payload = JSON.parse(event.data);
      logs = Array.isArray(payload?.logs) ? payload.logs : [];
      render();
    } catch { /* Ignore a malformed event and keep the last good log view. */ }
  };
  const start = () => {
    if (source) return;
    source = new EventSource('/api/logs/events');
    source.addEventListener('logs', onLogs);
  };
  const stop = () => {
    source?.close();
    source = null;
  };
  bindPageResource({ start, stop });
})();

function logRow(entry) {
  const row = document.createElement('tr');
  row.append(
    cell(entry.time),
    cell(entry.level, `level ${entry.level}`),
    cell(entry.component),
    cell(entry.message),
  );
  return row;
}

function cell(value, className = '') {
  const element = document.createElement('td');
  if (className) element.className = className;
  element.textContent = String(value ?? '');
  return element;
}
