(() => {
  const workspace = document.querySelector('#logs-workspace');
  const body = workspace?.querySelector('[data-log-body]');
  const count = workspace?.querySelector('.log-count');
  const filters = workspace?.querySelector('.log-filters');
  if (!workspace || !body || !count || !filters || !('EventSource' in window)) return;

  let logs = [];
  const render = () => {
    const component = filters.elements.component.value;
    const level = filters.elements.level.value;
    const visible = logs.filter((entry) => (
      (!component || entry.component === component) && (!level || entry.level === level)
    ));
    count.textContent = `${visible.length} event${visible.length === 1 ? '' : 's'}`;
    body.replaceChildren(...visible.slice().reverse().map(logRow));
  };

  filters.addEventListener('change', render);
  filters.addEventListener('submit', (event) => event.preventDefault());
  const source = new EventSource('/api/logs/events');
  source.addEventListener('logs', (event) => {
    try {
      const payload = JSON.parse(event.data);
      logs = Array.isArray(payload?.logs) ? payload.logs : [];
      render();
    } catch { /* Ignore a malformed event and keep the last good log view. */ }
  });
  window.addEventListener('pagehide', () => source.close(), { once: true });
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
