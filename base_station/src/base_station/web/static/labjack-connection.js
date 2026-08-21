import { requestJson } from './json-request.js';

const section = document.querySelector('[data-labjack-connection]');
const form = section?.querySelector('form');
const input = section?.querySelector('[data-labjack-ip]');
const connect = section?.querySelector('[data-labjack-connect]');
const disconnect = section?.querySelector('[data-labjack-disconnect]');
const state = section?.querySelector('[data-labjack-connection-state]');
let connected = section?.dataset.connected === 'true';
let busy = false;

render();

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || connected || !input?.value.trim()) return;
  await command('connect', { ip: input.value.trim() });
});

disconnect?.addEventListener('click', () => {
  if (!busy && connected) command('disconnect');
});

document.addEventListener('liquid:status', (event) => {
  const detail = event.detail?.device;
  if (detail?.id !== 'labjack' || !detail.status) return;
  connected = Boolean(detail.status.connected);
  if (!connected && detail.status.ip && document.activeElement !== input) input.value = detail.status.ip;
  render(connected ? '' : state?.textContent ?? '');
});

async function command(action, body) {
  busy = true;
  render('Working…');
  let message = '';
  try {
    await requestJson(`/api/labjack/${action}`, { method: 'POST', body });
  } catch (error) {
    message = error.message;
  } finally {
    busy = false;
    render(message);
  }
}

function render(message = state?.textContent ?? '') {
  if (!section) return;
  if (input) input.disabled = busy || connected;
  if (connect) {
    connect.hidden = connected;
    connect.disabled = busy || !input?.value.trim();
  }
  if (disconnect) {
    disconnect.hidden = !connected;
    disconnect.disabled = busy;
  }
  if (state) state.textContent = message;
}
