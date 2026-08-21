import { NODE_CATALOG } from './catalog.js';

/**
 * Toolbar-facing node families. This is the only place that maps domain node
 * categories to creation-menu chrome.
 */
export const NODE_TOOL_GROUPS = [
  { id: 'labjack', label: 'LabJack inputs', icon: 'icon-labjack', categories: ['LabJack'] },
  { id: 'sensors', label: 'Sensor transforms', icon: 'icon-node-pressure', categories: ['Sensors'] },
  { id: 'math', label: 'Math and simulation', icon: 'icon-math', categories: ['Math', 'Simulation'] },
  { id: 'outputs', label: 'Dashboard outputs', icon: 'icon-node-time-plot', categories: ['Dashboard'] },
];

/**
 * Build all node-creation menus from NODE_TOOL_GROUPS.
 * @returns {{open:(id:string)=>void,closeAll:()=>void,markPlacement:(active:boolean)=>void}}
 */
export function createPaletteMenus(container, onCreate, onOpen = () => {}) {
  const menus = new Map();
  container.replaceChildren();

  for (const group of NODE_TOOL_GROUPS) {
    const details = document.createElement('details');
    details.className = 'daq-tool-menu daq-node-tool-menu';
    details.dataset.nodeGroup = group.id;

    const summary = document.createElement('summary');
    summary.setAttribute('aria-label', group.label);
    summary.title = group.label;
    const icon = document.createElement('span');
    icon.className = `ui-icon ${group.icon}`;
    icon.setAttribute('aria-hidden', 'true');
    summary.append(icon);

    const popover = document.createElement('div');
    popover.className = 'daq-tool-popover daq-node-popover';
    const palette = document.createElement('div');
    palette.className = 'daq-palette';
    renderPalette(palette, group.categories, (nodeType) => {
      onCreate(nodeType);
      details.open = false;
    });
    popover.append(palette);
    details.append(summary, popover);
    container.append(details);
    menus.set(group.id, details);

    details.addEventListener('toggle', () => {
      if (!details.open) return;
      onOpen(group.id);
      for (const other of menus.values()) {
        if (other !== details) other.open = false;
      }
    });
  }

  return {
    open(id) {
      const menu = menus.get(id);
      if (!menu) return;
      for (const other of menus.values()) other.open = other === menu;
      menu.querySelector('summary')?.focus({ preventScroll: true });
    },
    closeAll() {
      for (const menu of menus.values()) menu.open = false;
    },
    markPlacement(active) {
      container.classList.toggle('awaiting-placement', active);
    },
  };
}

function renderPalette(element, categories, onCreate) {
  const allowed = new Set(categories);
  const groups = new Map();
  for (const item of NODE_CATALOG) {
    if (!allowed.has(item.category)) continue;
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item);
  }
  element.innerHTML = [...groups].map(([category, items]) => `
    <section class="daq-palette-group">
      ${groups.size > 1 ? `<h3>${escapeHtml(category)}</h3>` : ''}
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
