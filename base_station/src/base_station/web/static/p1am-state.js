import { requestJson } from './json-request.js';

const root = document.querySelector('[data-p1am-state]');
let busy = false;
let lastStatus = null;

root?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-state-id]');
  if (!button || busy || button.disabled) return;
  const confirmation = button.dataset.confirm;
  if (confirmation && !window.confirm(confirmation)) return;
  const priorDisabled = [...root.querySelectorAll('[data-state-id]')].map((item) => item.disabled);
  busy = true;
  syncBusy(true);
  try {
    await requestJson('/api/cart/state', {
      method: 'POST',
      body: { state: Number(button.dataset.stateId) },
    });
  } catch (error) {
    renderOperation(error.message, false);
  } finally {
    busy = false;
    if (lastStatus) updateStateMachine(lastStatus);
    else [...root.querySelectorAll('[data-state-id]')].forEach((item, index) => { item.disabled = priorDisabled[index]; });
  }
});

document.addEventListener('liquid:status', (event) => {
  const detail = event.detail?.device;
  if (detail?.id !== 'p1am' || !detail.status) return;
  lastStatus = detail.status;
  updateStateMachine(detail.status);
});

function updateStateMachine(status) {
  if (!root) return;
  const buttons = [...root.querySelectorAll('[data-state-id]')];
  const current = root.querySelector('[data-p1am-current]');
  const operation = root.querySelector('[data-p1am-operation]');
  const transitions = new Set(status.transitions ?? []);
  const pending = status.pending_state != null;

  if (current) {
    const currentButton = buttons.find((button) => Number(button.dataset.stateId) === status.state);
    current.textContent = status.connected && currentButton
      ? currentButton.textContent.trim() || 'Unknown'
      : 'Disconnected';
  }

  for (const button of buttons) {
    const stateId = Number(button.dataset.stateId);
    button.disabled = busy || !status.connected || pending || !transitions.has(stateId);
    button.classList.toggle('current', status.connected && stateId === status.state);
  }

  if (operation) {
    operation.textContent = status.transition_message || '';
    operation.hidden = !status.transition_message;
    operation.classList.toggle('pending', pending);
  }
}

function syncBusy(active) {
  for (const button of root?.querySelectorAll('[data-state-id]') ?? []) {
    if (active) button.disabled = true;
  }
}

function renderOperation(message, pending) {
  const operation = root?.querySelector('[data-p1am-operation]');
  if (!operation) return;
  operation.textContent = message || '';
  operation.hidden = !message;
  operation.classList.toggle('pending', Boolean(pending));
}
