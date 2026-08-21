document.addEventListener('liquid:status', (event) => {
  const detail = event.detail?.device;
  if (detail?.id !== 'p1am' || !detail.status) return;
  updateStateMachine(detail.status);
});

function updateStateMachine(status) {
  const root = document.querySelector('[data-p1am-state]');
  if (!root) return;
  const buttons = [...root.querySelectorAll('[data-state-id]')];
  const current = root.querySelector('[data-p1am-current]');
  const operation = root.querySelector('[data-p1am-operation]');
  const transitions = new Set(status.transitions ?? []);
  const pending = status.pending_state != null;

  if (current) {
    const currentButton = buttons.find((button) => Number(button.dataset.stateId) === status.state);
    current.textContent = status.connected && currentButton
      ? currentButton.querySelector('.button-label')?.textContent || 'Unknown'
      : 'Disconnected';
  }

  for (const button of buttons) {
    const stateId = Number(button.dataset.stateId);
    button.disabled = !status.connected || pending || !transitions.has(stateId);
    button.classList.toggle('current', status.connected && stateId === status.state);
  }

  if (operation) {
    operation.textContent = status.transition_message || '';
    operation.hidden = !status.transition_message;
    operation.classList.toggle('pending', pending);
  }
}
