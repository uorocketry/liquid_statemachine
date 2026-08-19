import { NODE_CATALOG } from './catalog.js';

/** Render the permanent node palette and wire click callbacks. */
export function createPalette(element, onCreate) {
  const groups = new Map();
  for (const item of NODE_CATALOG) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item);
  }
  element.innerHTML = [...groups].map(([category, items]) => `
    <section class="daq-palette-group">
      <h3>${escapeHtml(category)}</h3>
      ${items.map((item) => `
        <button type="button" class="daq-palette-item" data-node-type="${item.type}" title="${escapeHtml(item.description)}">
          <span class="ui-icon ${escapeHtml(item.icon)}" aria-hidden="true"></span>
          <strong>${escapeHtml(item.title)}</strong>
        </button>`).join('')}
    </section>`).join('');
  element.addEventListener('click', (event) => {
    const button = event.target.closest('[data-node-type]');
    if (button) onCreate(button.dataset.nodeType);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
