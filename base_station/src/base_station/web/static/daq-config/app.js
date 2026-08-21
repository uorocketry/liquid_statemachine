import '/static/blueprint/index.js';
import { loadCapabilities, loadGraph, saveGraph } from './api.js';
import { createNode } from './catalog.js';
import { createPaletteMenus } from './palette.js';
import { blockingIssues, validateGraph } from './validation.js';
import { DaqLivePreview, highlightPathToSelection } from './live-preview.js';
import { decorateNode } from './presentation.js';
import { patchInlineNode } from './node-editing.js';
import { daqConnectionAllowed } from './connection-policy.js';
import { configureSpecDefaults, isPreviewSourceNode } from './node-specs.js';
import { bindPageResource } from '../page-resource-lifecycle.js';
import { bindEngineeringCanvasToolset } from '../engineering-canvas-toolset.js';
import { SignalGraphPageUi } from './page-ui.js';

const EDITOR_CONTRACT_VERSION = 2;

const editor = document.querySelector('#daq-blueprint');
const nodeTools = document.querySelector('#daq-node-tools');
const issueSummary = document.querySelector('#daq-issue-summary');
const issueTools = document.querySelector('#daq-issue-tools');
const issueCount = document.querySelector('#daq-issue-count');
const saveButton = document.querySelector('#daq-save');
const undoButton = document.querySelector('#daq-undo');
const redoButton = document.querySelector('#daq-redo');
const canvasToolButtons = [...document.querySelectorAll('.daq-floating-tools [data-canvas-tool]')];
const saveFeedback = document.querySelector('#daq-save-feedback');
const ui = new SignalGraphPageUi({
  editor, issueSummary, issueTools, issueCount, saveButton, saveFeedback, undoButton, redoButton,
});

let capabilities = null;
let labjackSettings = {};
let insertionPoint = null;
let issues = [];
let preview = null;
let paletteTools = null;

bootstrap().catch((error) => {
  saveButton.disabled = true;
  saveButton.classList.add('error');
  saveButton.title = `Failed to load: ${error.message}`;
  saveButton.setAttribute('aria-label', saveButton.title);
  saveFeedback.textContent = saveButton.title;
  nodeTools.replaceChildren();
  const message = document.createElement('p');
  message.className = 'daq-tool-message';
  message.textContent = error.message;
  nodeTools.append(message);
});

async function bootstrap() {
  const [payload, capabilityPayload] = await Promise.all([
    loadGraph(),
    loadCapabilities().catch(() => null),
  ]);
  assertEditorContract(payload);
  configureSpecDefaults(payload.specDefaults);
  capabilities = capabilityPayload;
  labjackSettings = payload.sourceContext?.labjack ?? {};
  issues = validateGraph(payload.graph, labjackSettings);

  editor.nodeDecorator = (node, graph) => {
    const displayNode = decorateNode(node, graph, capabilities, labjackSettings);
    displayNode.diagnostics = issues
      .filter((issue) => issue.subject === node.id)
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    return displayNode;
  };
  editor.inlineEditPolicy = patchInlineNode;
  editor.connectionPolicy = (source, target, sourceNode, targetNode) => (
    daqConnectionAllowed(source, target, sourceNode, targetNode, editor.graph)
  );
  editor.graph = payload.graph;
  ui.markSaved(payload.graph);
  bindEngineeringCanvasToolset({
    buttons: canvasToolButtons,
    target: editor,
    onChange: (tool) => { editor.interactionTool = tool; },
  });

  paletteTools = createPaletteMenus(nodeTools, addNodeFromPalette, () => {
    issueTools.open = false;
  });
  preview = new DaqLivePreview(editor, labjackSettings);
  bindEvents();
  refreshUi({ revalidate: false, presentation: false });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bindPageResource({ start: syncPreviewState, stop: () => preview?.stop() });
  }));
}

function assertEditorContract(payload) {
  if (payload?.editorContract !== EDITOR_CONTRACT_VERSION || !payload?.specDefaults) {
    throw new Error('DAQ editor/server versions do not match. Restart the base station.');
  }
}

function bindEvents() {
  editor.addEventListener('blueprint-create-request', (event) => {
    insertionPoint = event.detail.point;
    paletteTools?.closeAll();
    paletteTools?.markPlacement(true);
  });
  editor.addEventListener('blueprint-selection-change', (event) => {
    highlightPathToSelection(editor, editor.graph, event.detail.nodeIds[0] ?? null);
  });
  editor.addEventListener('blueprint-change', () => {
    refreshUi();
    syncPreviewState();
    preview?.refreshSoon();
  });
  editor.addEventListener('blueprint-inline-draft-change', () => ui.refreshSaveState(issues));

  saveButton.addEventListener('click', save);
  undoButton.addEventListener('click', () => editor.undo());
  redoButton.addEventListener('click', () => editor.redo());
  issueTools.addEventListener('toggle', () => {
    if (issueTools.open) paletteTools?.closeAll();
  });

  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });
}

function addNodeFromPalette(nodeType) {
  const point = insertionPoint ?? editorCenterPoint();
  const node = createNode(nodeType, point, capabilities, editor.graph, labjackSettings);
  editor.addNode(node);
  insertionPoint = null;
  paletteTools?.markPlacement(false);
  paletteTools?.closeAll();
}

function editorCenterPoint() {
  const camera = editor.camera;
  const rect = editor.getBoundingClientRect();
  return {
    x: (rect.width / 2 - camera.x) / camera.scale,
    y: (Math.min(rect.height, 700) / 2 - camera.y) / camera.scale,
  };
}

function refreshUi({ revalidate = true, presentation = true } = {}) {
  if (revalidate) issues = validateGraph(editor.graph, labjackSettings);
  ui.refresh(issues, { presentation });
}

async function save() {
  editor.flushInlineEdit();
  const errors = blockingIssues(validateGraph(editor.graph, labjackSettings));
  if (errors.length) return refreshUi();
  ui.setSaving();
  try {
    const result = await saveGraph(editor.graph);
    issues = result.issues ?? [];
    editor.adoptGraph(result.graph);
    ui.setSaved(result.graph);
    refreshUi();
  } catch (error) {
    const message = issueMessage(error) ?? error.message;
    ui.setSaveError(message);
  }
}

function syncPreviewState() {
  if (!preview) return;
  const hasSimulation = editor.graph.nodes.some(isPreviewSourceNode);
  if (capabilities?.device?.connected || hasSimulation) preview.start();
  else preview.stop();
}

function issueMessage(error) {
  const issue = error.detail?.issues?.[0];
  return typeof issue === 'string' ? issue : issue?.message;
}
