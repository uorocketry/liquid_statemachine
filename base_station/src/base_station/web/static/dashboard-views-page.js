import { loadDashboardLayout, loadGraph, saveDashboardViews } from './daq-config/api.js';
import { DashboardAuthoringCanvas } from './dashboard-authoring-canvas.js';
import { bindEngineeringCanvasToolset } from './engineering-canvas-toolset.js';
import {
  applyWidgetGeometry,
  cloneLayout,
  itemFor,
  layoutWorldBounds,
  viewWorldBounds,
  visibleWidgets,
} from './dashboard-layout-model.js';
import { DashboardViewRegionEditor } from './dashboard-view-region-editor.js';
import { DASHBOARD_NODE_TYPES, createDashboardWidget } from './dashboard-widget-registry.js';

const viewport = document.querySelector('#dashboard-views-viewport');
const grid = document.querySelector('#dashboard-views-grid');
const layer = document.querySelector('#dashboard-view-layer');
const buttons = [...document.querySelectorAll('[data-dashboard-view-slot-button]')];
const saveButton = document.querySelector('#dashboard-views-save');
const cancelButton = document.querySelector('#dashboard-views-cancel');
const zoomControl = document.querySelector('#dashboard-views-zoom');
const canvasToolButtons = [...document.querySelectorAll('.dashboard-authoring-controls [data-canvas-tool]')];

let widgets = [];
let committed = { items: {}, views: {} };
let draft = { items: {}, views: {} };
let editor = null;
let toolset = null;

const canvas = new DashboardAuthoringCanvas({
  viewport,
  world: grid,
  overlay: layer,
  zoomControl,
  getBounds: authoringBounds,
  onChange: () => {
    syncWidgetGeometry();
    editor?.render();
  },
});

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
  editor = new DashboardViewRegionEditor({
    viewport,
    layer,
    canvas,
    buttons,
    getLayout: () => draft,
    getTool: () => toolset.tool,
    onChange: syncSaveState,
  });
  bindControls();
  renderWidgets();
  editor.render();
  canvas.start();
}

function bindControls() {
  cancelButton.addEventListener('click', () => {
    draft = cloneLayout(committed);
    editor.render();
    syncSaveState();
  });
  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    try {
      const result = await saveDashboardViews(draft.views);
      committed = cloneLayout(result.layout);
      draft = cloneLayout(committed);
      editor.render();
    } finally {
      syncSaveState();
    }
  });
  syncSaveState();
}

function syncSaveState() {
  const dirty = JSON.stringify(draft.views) !== JSON.stringify(committed.views);
  saveButton.disabled = !dirty;
  cancelButton.disabled = !dirty;
}

function renderWidgets() {
  grid.replaceChildren();
  for (const widget of visibleWidgets(widgets, draft)) {
    const card = createDashboardWidget(widget);
    grid.append(card);
  }
  syncWidgetGeometry();
}

function syncWidgetGeometry() {
  const metrics = canvas.metrics();
  for (const card of grid.querySelectorAll('[data-widget-id]')) {
    applyWidgetGeometry(card, itemFor(draft, card.dataset.widgetId), metrics);
  }
}

function authoringBounds() {
  const metrics = canvas.metrics();
  const bounds = [
    layoutWorldBounds(widgets, draft, metrics),
    ...Object.values(draft.views ?? {}).map((view) => viewWorldBounds(view, metrics)),
  ].filter(Boolean);
  if (!bounds.length) return null;
  const left = Math.min(...bounds.map((box) => box.x));
  const top = Math.min(...bounds.map((box) => box.y));
  const right = Math.max(...bounds.map((box) => box.x + box.width));
  const bottom = Math.max(...bounds.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

start().catch(() => { document.body.dataset.dashboardState = 'error'; });
