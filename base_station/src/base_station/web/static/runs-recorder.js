const recorder = document.querySelector('[data-runs-recorder]');

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
      const response = await fetch(`/api/labjack/stream/${action}`, { method: 'POST' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail ?? `Request failed (${response.status})`);
      }
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
    const rate = recorder.querySelector('[data-run-rate]');
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
    if (rate) rate.textContent = `${active ? status.scan_rate : recorder.dataset.configuredRate} samples/s`;
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

function initialState() {
  return recorder?.querySelector('[data-run-state]')?.textContent.trim().toLowerCase() || 'idle';
}

function activeState(state) {
  return ['starting', 'running', 'stopping'].includes(state);
}

async function refreshRunTable() {
  const target = document.querySelector('#run-table-fragment');
  if (!target) return;
  const response = await fetch('/fragments/run-table');
  if (!response.ok) return;
  const template = document.createElement('template');
  template.innerHTML = await response.text();
  const replacement = template.content.firstElementChild;
  if (!replacement) return;
  target.replaceWith(replacement);
  if (globalThis.htmx) htmx.process(replacement);
}

function formatDuration(seconds) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const remainder = Math.max(0, seconds) - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}

function titleCase(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : '';
}
