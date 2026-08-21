const TOOL_KEYS = { v: 'select', h: 'hand' };

/** Keep Select/Hand buttons and V/H shortcuts consistent across engineering canvases. */
export function bindEngineeringCanvasToolset({ buttons, target, initial = 'select', onChange }) {
  let tool = initial;

  const setTool = (next) => {
    if (!['select', 'hand'].includes(next) || next === tool) return;
    tool = next;
    sync();
    onChange?.(tool);
  };

  const sync = () => {
    if (target) target.dataset.canvasTool = tool;
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.canvasTool === tool));
    }
  };

  for (const button of buttons) {
    button.addEventListener('click', () => setTool(button.dataset.canvasTool));
  }
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const focus = event.target;
    if (focus.matches?.('input, textarea, select') || focus.isContentEditable) return;
    const next = TOOL_KEYS[event.key.toLowerCase()];
    if (!next) return;
    setTool(next);
    event.preventDefault();
  });

  sync();
  onChange?.(tool);
  return { get tool() { return tool; }, setTool };
}
