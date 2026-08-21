import { saveLabJackSettings } from './daq-config/api.js';

const panel = document.querySelector('#labjack-acquisition-settings');
const scanRate = document.querySelector('#labjack-scan-rate');
const resolution = document.querySelector('#labjack-resolution-index');
const settling = document.querySelector('#labjack-settling-us');
const saveButton = document.querySelector('#labjack-settings-save');
const state = document.querySelector('#labjack-settings-state');

if (panel && scanRate && resolution && settling && saveButton && state) {
  let saved = readSettings();

  panel.addEventListener('input', refresh);
  panel.addEventListener('change', refresh);
  saveButton.addEventListener('click', save);
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && isDirty()) {
      event.preventDefault();
      save();
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  refresh();

  async function save() {
    const settings = readSettings();
    const message = validationMessage(settings);
    if (message) return renderState(message, 'error');
    saveButton.disabled = true;
    renderState('Saving…');
    try {
      const result = await saveLabJackSettings(settings);
      saved = result.settings;
      writeSettings(saved);
      refresh();
    } catch (error) {
      renderState(issueMessage(error) ?? error.message, 'error');
      saveButton.disabled = false;
    }
  }

  function refresh() {
    const settings = readSettings();
    const message = validationMessage(settings);
    const dirty = isDirty(settings);
    saveButton.disabled = !dirty || Boolean(message);
    if (message) renderState(message, 'error');
    else if (dirty) renderState('Unsaved changes', 'dirty');
    else renderState('Saved');
  }

  function isDirty(settings = readSettings()) {
    return JSON.stringify(settings) !== JSON.stringify(saved);
  }
}

function readSettings() {
  return {
    scanRate: numericValue(scanRate),
    resolutionIndex: numericValue(resolution),
    settlingUs: numericValue(settling),
    mux80Enabled: panel.querySelector('input[name="labjack-mux80"]:checked')?.value === 'true',
  };
}

function writeSettings(settings) {
  scanRate.value = String(settings.scanRate);
  resolution.value = String(settings.resolutionIndex);
  settling.value = String(settings.settlingUs);
  const mux = panel.querySelector(`input[name="labjack-mux80"][value="${settings.mux80Enabled}"]`);
  if (mux) mux.checked = true;
}

function numericValue(element) {
  return element.value.trim() === '' ? Number.NaN : Number(element.value);
}

function validationMessage(settings) {
  if (!Number.isInteger(settings.scanRate) || settings.scanRate < 1 || settings.scanRate > 100000) {
    return 'Scan rate must be an integer from 1 to 100,000 samples/s';
  }
  if (!Number.isInteger(settings.resolutionIndex) || settings.resolutionIndex < 0 || settings.resolutionIndex > 8) {
    return 'Resolution must be Auto or index 1 through 8';
  }
  if (!Number.isFinite(settings.settlingUs) || settings.settlingUs < 0) {
    return 'Settling time cannot be negative';
  }
  return null;
}

function renderState(message, tone = '') {
  state.textContent = message;
  state.className = `device-note ${tone}`.trim();
}

function issueMessage(error) {
  const issue = error.detail?.issues?.[0];
  return typeof issue === 'string' ? issue : issue?.message;
}
