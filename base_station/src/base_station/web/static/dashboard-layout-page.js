import { loadDashboardLayout, loadGraph, saveDashboardItems } from './daq-config/api.js';
import { DashboardAuthoringCanvas } from './dashboard-authoring-canvas.js';
import { DashboardLayoutSelection } from './dashboard-layout-selection.js';
import { bindEngineeringCanvasToolset } from './engineering-canvas-toolset.js';
import {
  applyWidgetGeometry,
  cloneLayout,
  itemFor,
  layoutWorldBounds,
  setVisible,
  visibleWidgets,
} from './dashboard-layout-model.js';
import { DASHBOARD_NODE_TYPES, createDashboardWidget } from './dashboard-widget-registry.js';

const viewport = document.querySelector('#dashboard-layout-viewport');
const grid = document.querySelector('#dashboard-layout-grid');
const selectionLayer = document.querySelector('#dashboard-layout-selection-layer');
const picker = document.querySelector('#dashboard-widget-options');
const saveButton = document.querySelector('#dashboard-layout-save');
const cancelButton = document.querySelector('#dashboard-layout-cancel');
const zoomControl = document.querySelector('#dashboard-layout-zoom');
const canvasToolButtons = [...document.querySelectorAll('.dashboard-authoring-controls [data-canvas-tool]')];

let widgets = [];
let committed = { items: {}, views: {} };
let draft = { items: {}, views: {} };

const canvas = new DashboardAuthoringCanvas({
  viewport,
  world: grid,
  overlay: selectionLayer,
  zoomControl,
  getBounds: () => layoutWorldBounds(widgets, draft, canvas.metrics()),
  onChange: () => selection?.syncGeometry(),
});
let selection = null;
let toolset = null;

async function start() {
  const [graphPayload, layoutPayload] = await Promise.all([loadGraph(), loadDashboardLayout()]);
  widgets = graphPayload.graph.nodes
    .filter((node) => DASHBOARD_NODE_TYPES.has(node.nodeType))
    .filter((node) => String(node.config?.label ?? '').trim());
  committed = cloneLayout(layoutPayload.layout);
  draft = cloneLayout(committed);
  toolset = bindEngineeringCanvasToolset({
    buttons: canvasToolButtons,
    target: viewport,
    onChange: (tool) => canvas.setTool(tool),
  });
  selection = new DashboardLayoutSelection({
    viewport, grid, layer: selectionLayer,
    canvas,
    widgets,
    getLayout: () => draft,
    getTool: () => toolset.tool,
    onChange: syncSaveState,
  });
  bindControls();
  render();
  canvas.start();
}

function bindControls() {
  picker.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-dashboard-widget-id]');
    if (!input) return;
    setVisible(draft, input.dataset.dashboardWidgetId, input.checked);
    render();
    syncSaveState();
  });
  cancelButton.addEventListener('click', () => {
    draft = cloneLayout(committed);
    render();
    syncSaveState();
  });
  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    try {
      const result = await saveDashboardItems(draft.items);
      committed = cloneLayout(result.layout);
      draft = cloneLayout(committed);
      render();
    } finally {
      syncSaveState();
    }
  });
  syncSaveState();
}

function syncSaveState() {
  const dirty = JSON.stringify(draft.items) !== JSON.stringify(committed.items);
  saveButton.disabled = !dirty;
  cancelButton.disabled = !dirty;
}

function render() {
  renderPicker();
  grid.replaceChildren();
  for (const widget of visibleWidgets(widgets, draft)) {
    const card = createDashboardWidget(widget);
    card.dataset.dashboardFrame = '';
    card.querySelector('header')?.setAttribute('data-dashboard-drag-handle', '');
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'dashboard-resize-handle';
    handle.dataset.dashboardResizeHandle = '';
    handle.setAttribute('aria-label', `Resize ${widget.config?.label ?? 'dashboard widget'}`);
    card.append(handle);
    applyWidgetGeometry(card, itemFor(draft, widget.id), canvas.metrics());
    grid.append(card);
  }
  selection?.syncSelection();
}

function renderPicker() {
  picker.replaceChildren();
  for (const widget of widgets) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.dashboardWidgetId = widget.id;
    input.checked = itemFor(draft, widget.id)?.visible !== false;
    const text = document.createElement('span');
    text.textContent = widget.config?.label ?? widget.id;
    label.append(input, text);
    picker.append(label);
  }
}

start().catch(() => { document.body.dataset.dashboardState = 'error'; });
