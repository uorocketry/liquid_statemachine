import { requestJson } from './json-request.js';

const recorder = document.querySelector('[data-runs-recorder]');
const runTableBody = document.querySelector('[data-run-table-body]');
const runTableState = document.querySelector('[data-run-table-state]');

if (recorder) {
  let previousActive = activeState(initialState());
  let busy = false;

  recorder.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-record-action]');
    if (!button || busy) return;
    busy = true;
    button.disabled = true;
    const operation = recorder.querySelector('[data-run-operation]');
    try {
      const action = button.dataset.recordAction;
      await requestJson(`/api/labjack/stream/${action}`, { method: 'POST' });
    } catch (error) {
      if (operation) {
        operation.textContent = error.message;
        operation.hidden = false;
      }
    } finally {
      busy = false;
      button.disabled = false;
    }
  });

  document.addEventListener('liquid:status', (event) => {
    const detail = event.detail?.device;
    if (detail?.id !== 'labjack' || !detail.status) return;
    updateRecorder(detail.status);
  });

  function updateRecorder(status) {
    const active = activeState(status.acquisition_state);
    const start = recorder.querySelector('[data-record-action="start"]');
    const stop = recorder.querySelector('[data-record-action="stop"]');
    const badge = recorder.querySelector('[data-run-state]');
    const link = recorder.querySelector('[data-run-link]');
    const duration = recorder.querySelector('[data-run-duration]');
    const operation = recorder.querySelector('[data-run-operation]');

    if (start) start.hidden = !status.connected || active;
    if (stop) {
      stop.hidden = !active;
      stop.disabled = busy || status.acquisition_state === 'stopping';
    }
    if (badge) {
      badge.hidden = !active;
      badge.textContent = titleCase(status.acquisition_state || 'idle');
      badge.classList.toggle('active', status.acquisition_state === 'running');
    }
    if (duration) duration.textContent = formatDuration((status.sample_count || 0) / Math.max(1, status.scan_rate || 1));
    if (link) {
      link.hidden = !status.current_run_id;
      if (status.current_run_id) {
        link.href = `/runs/${status.current_run_id}`;
        link.textContent = `Run ${status.current_run_id}`;
      }
    }
    if (operation) {
      operation.textContent = active ? (status.operation_message || '') : '';
      operation.hidden = !active || !status.operation_message;
      operation.classList.toggle('pending', ['starting', 'stopping'].includes(status.acquisition_state));
    }
    if (previousActive && !active) refreshRunTable();
    previousActive = active;
  }
}

runTableBody?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-run-delete]');
  if (!button || button.disabled) return;
  const runId = Number(button.dataset.runDelete);
  if (!Number.isInteger(runId) || !window.confirm(`Delete run ${runId} and all of its samples?`)) return;
  button.disabled = true;
  if (runTableState) runTableState.textContent = '';
  try {
    await requestJson(`/api/runs/${runId}`, { method: 'DELETE' });
    await refreshRunTable();
  } catch (error) {
    if (runTableState) runTableState.textContent = error.message;
    button.disabled = false;
  }
});

function initialState() {
  return recorder?.querySelector('[data-run-state]')?.textContent.trim().toLowerCase() || 'idle';
}

function activeState(state) {
  return ['starting', 'running', 'stopping'].includes(state);
}

async function refreshRunTable() {
  if (!runTableBody) return;
  try {
    const payload = await requestJson('/api/runs');
    renderRunTable(payload.runs ?? []);
    if (runTableState) runTableState.textContent = '';
  } catch { /* Keep the last good table if refresh fails. */ }
}

function renderRunTable(runs) {
  if (!runTableBody) return;
  if (!runs.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    row.dataset.runEmpty = '';
    cell.className = 'empty-table';
    cell.colSpan = 7;
    cell.textContent = 'No runs recorded yet.';
    row.append(cell);
    runTableBody.replaceChildren(row);
    return;
  }
  runTableBody.replaceChildren(...runs.map(runRow));
}

function runRow(run) {
  const row = document.createElement('tr');
  row.dataset.runId = String(run.id);
  const runLink = document.createElement('a');
  runLink.href = `/runs/${run.id}`;
  runLink.textContent = `#${run.id}`;
  row.append(
    tableCell(runLink),
    tableCell(String(run.started_at ?? '').replace('T', ' ')),
    statusCell(run.status),
    tableCell(`${Number(run.scan_rate ?? 0).toLocaleString()} Hz`),
    tableCell(Number(run.sample_count ?? 0).toLocaleString()),
    tableCell(`${(Number(run.sample_count ?? 0) / Math.max(1, Number(run.scan_rate ?? 1))).toFixed(2)} s`),
    actionCell(run.id),
  );
  return row;
}

function tableCell(value) {
  const cell = document.createElement('td');
  if (value instanceof Node) cell.append(value);
  else cell.textContent = String(value ?? '');
  return cell;
}

function statusCell(status) {
  const badge = document.createElement('span');
  badge.className = `run-status ${status ?? ''}`.trim();
  badge.textContent = status ?? '';
  return tableCell(badge);
}

function actionCell(runId) {
  const cell = document.createElement('td');
  cell.className = 'run-actions';
  const exportLink = document.createElement('a');
  exportLink.className = 'icon-button';
  exportLink.href = `/runs/${runId}/export.csv`;
  exportLink.title = 'Export CSV';
  exportLink.setAttribute('aria-label', `Export run ${runId} as CSV`);
  exportLink.append(icon('icon-export'));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-button danger';
  remove.dataset.runDelete = String(runId);
  remove.title = 'Delete run';
  remove.setAttribute('aria-label', `Delete run ${runId}`);
  remove.append(icon('icon-delete'));
  cell.append(exportLink, remove);
  return cell;
}

function icon(className) {
  const element = document.createElement('span');
  element.className = `ui-icon ${className}`;
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function formatDuration(seconds) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const remainder = Math.max(0, seconds) - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}

function titleCase(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : '';
}
