import { requestJson } from './json-request.js';

const section = document.querySelector('[data-device-detail="p1am"]');
let busy = false;
let lastStatus = null;

document.addEventListener('liquid:status', (event) => {
  const detail = event.detail?.device;
  if (detail?.id === 'p1am' && detail.status) lastStatus = detail.status;
});

section?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-p1am-action]');
  if (!button || button.disabled || busy) return;
  if (button.dataset.confirm && !window.confirm(button.dataset.confirm)) return;
  busy = true;
  button.disabled = true;
  button.dataset.commandBusy = 'true';
  try {
    await requestJson(`/api/cart/${button.dataset.p1amAction}`, { method: 'POST' });
  } catch (error) {
    const target = section.querySelector('[data-device-command-state]');
    if (target) target.textContent = error.message;
  } finally {
    busy = false;
    delete button.dataset.commandBusy;
    if (lastStatus) {
      button.disabled = button.dataset.p1amAction === 'initialize'
        ? !lastStatus.connected || lastStatus.p1_initialized || lastStatus.initialization_status === 'initializing'
        : !lastStatus.connected;
    } else button.disabled = false;
  }
});
