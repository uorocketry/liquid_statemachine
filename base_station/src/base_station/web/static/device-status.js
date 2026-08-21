document.addEventListener('liquid:status', (event) => {
  const detail = event.detail?.device;
  const status = detail?.status;
  if (!detail?.id || !status) return;
  const section = document.querySelector(`[data-device-detail="${detail.id}"]`);
  if (!section) return;
  if (detail.id === 'p1am') updateP1am(section, status);
  else if (detail.id === 'labjack') updateLabJack(section, status);
});

function updateP1am(section, status) {
  setHealth(section, status.health, status.health);
  setField(section, 'host', status.host || '—');
  setField(section, 'firmware_version', status.firmware_version || '—');
  setField(section, 'uptime_ms', status.uptime_ms == null ? '—' : `${Math.floor(status.uptime_ms / 1000)} seconds`);
  setField(section, 'response_time_ms', status.response_time_ms == null ? '—' : `${status.response_time_ms} ms`);
  setField(section, 'ethernet_link', status.ethernet_link ? 'Linked' : 'Not linked');
  setField(section, 'p1_rack', status.p1_initialized ? `${status.modules_detected ?? 0} I/O modules` : 'Not initialized');
  setField(section, 'consecutive_failures', String(status.consecutive_failures ?? 0));
  setField(section, 'last_seen', status.last_seen || '—');
  setField(section, 'error', status.error || '');
  const errorRow = section.querySelector('[data-device-row="error"]');
  if (errorRow) errorRow.hidden = !status.error;
  setField(section, 'initialization_status', initializationMessage(status));
  setField(section, 'reset_message', status.reset_message || '');

  const initialize = section.querySelector('.initialize-button');
  if (initialize) {
    initialize.disabled = !status.connected || status.p1_initialized || status.initialization_status === 'initializing';
    const label = initialize.querySelector('.button-label');
    if (label) label.textContent = status.p1_initialized ? 'Rack initialized' : 'Initialize P1 rack';
  }
  const reset = section.querySelector('.reset-controller');
  if (reset) reset.disabled = !status.connected;
}

function updateLabJack(section, status) {
  setHealth(section, status.connected ? 'healthy' : 'offline', status.connected ? 'Healthy' : 'Offline');
  setField(section, 'ip', status.ip || '—');
  setField(section, 'serial_number', status.serial_number ?? '—');
  setField(section, 'acquisition_state', titleCase(status.acquisition_state || 'idle'));
  setField(section, 'active_rate', status.streaming ? `${status.scan_rate} samples/s` : '—');
  setField(section, 'sample_count', Number(status.sample_count ?? 0).toLocaleString());
}

function setHealth(section, className, label) {
  const badge = field(section, 'health');
  if (!badge) return;
  badge.classList.remove('healthy', 'degraded', 'offline', 'online');
  badge.classList.add(className);
  badge.textContent = label;
}

function setField(section, name, value) {
  const element = field(section, name);
  if (element) element.textContent = String(value);
}

function field(section, name) {
  return section.querySelector(`[data-device-field="${name}"]`);
}

function initializationMessage(status) {
  if (status.initialization_status === 'initializing') return 'Searching for P1 modules…';
  if (status.initialization_status === 'succeeded') return `${status.modules_detected ?? 0} I/O modules detected.`;
  if (status.initialization_status === 'failed') return `Initialization failed: ${status.initialization_error || 'unknown error'}`;
  return '';
}

function titleCase(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : '';
}
