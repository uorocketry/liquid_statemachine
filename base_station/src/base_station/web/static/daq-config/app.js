import '/static/blueprint/index.js';
import { loadCapabilities, loadConfiguration, saveConfiguration } from './api.js';
import { createNode } from './catalog.js';
import { createPalette } from './palette.js';
import { blockingIssues, validateGraph } from './validation.js';
import { DaqLivePreview, highlightPathToSelection } from './live-preview.js';
import { decorateNode } from './presentation.js';
import { patchInlineNode } from './node-editing.js';
import { daqConnectionAllowed } from './connection-policy.js';
import { isPreviewSourceNode } from './node-specs.js';

const editor = document.querySelector('#daq-blueprint');
const palette = document.querySelector('#daq-palette');
const issueSummary = document.querySelector('#daq-issue-summary');
const nodeTools = document.querySelector('#daq-node-tools');
const acquisitionTools = document.querySelector('#daq-acquisition-tools');
const issueTools = document.querySelector('#daq-issue-tools');
const issueCount = document.querySelector('#daq-issue-count');
const saveButton = document.querySelector('#daq-save');
const reloadButton = document.querySelector('#daq-reload');
const undoButton = document.querySelector('#daq-undo');
const redoButton = document.querySelector('#daq-redo');
const frameButton = document.querySelector('#daq-frame');
const saveState = document.querySelector('#daq-save-state');
const scanRate = document.querySelector('#daq-scan-rate');
const streamResolution = document.querySelector('#daq-stream-resolution');
const streamSettling = document.querySelector('#daq-stream-settling');
const signalQuality = document.querySelector('#daq-signal-quality');

let capabilities = null;
let insertionPoint = null;
let dirty = false;
let pendingInlineEdit = false;
let issues = [];
let preview = null;

bootstrap().catch((error) => {
  saveState.textContent = `Failed to load: ${error.message}`;
  saveState.className = 'daq-save-state error';
});

async function bootstrap() {
  const [capabilityPayload, configuration] = await Promise.all([
    loadCapabilities(),
    loadConfiguration(),
  ]);
  capabilities = capabilityPayload;
  editor.nodeDecorator = (node, graph) => {
    const displayNode = decorateNode(node, graph, capabilities);
    displayNode.diagnostics = issues
      .filter((issue) => issue.subject === node.id)
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    return displayNode;
  };
  editor.inlineEditPolicy = patchInlineNode;
  editor.connectionPolicy = (source, target, sourceNode, targetNode) => (
    daqConnectionAllowed(source, target, sourceNode, targetNode, editor.graph)
  );
  editor.graph = configuration.graph;
  syncAcquisitionControls();
  createPalette(palette, addNodeFromPalette);
  preview = new DaqLivePreview(editor);
  bindEvents();
  refreshUi();
  syncPreviewState();
}

function bindEvents() {
  editor.addEventListener('blueprint-create-request', (event) => {
    insertionPoint = event.detail.point;
    openToolMenu(nodeTools);
    palette.classList.add('awaiting-placement');
  });
  editor.addEventListener('blueprint-selection-change', (event) => {
    highlightPathToSelection(editor, editor.graph, event.detail.nodeIds[0] ?? null);
  });
  editor.addEventListener('blueprint-change', () => {
    dirty = true;
    pendingInlineEdit = false;
    refreshUi();
    syncPreviewState();
    preview?.refreshSoon();
  });
  editor.addEventListener('blueprint-inline-input', (event) => {
    pendingInlineEdit = Boolean(event.detail?.pending);
    refreshSaveState();
  });
  saveButton.addEventListener('click', save);
  reloadButton.addEventListener('click', reload);
  undoButton.addEventListener('click', () => editor.undo());
  redoButton.addEventListener('click', () => editor.redo());
  frameButton.addEventListener('click', () => editor.fitGraph());
  scanRate.addEventListener('change', () => editor.updateMetadata({ scanRate: Number(scanRate.value) }));
  streamResolution.addEventListener('change', () => editor.updateMetadata({
    streamResolutionIndex: Number(streamResolution.value),
  }));
  streamSettling.addEventListener('change', () => editor.updateMetadata({
    streamSettlingUs: Number(streamSettling.value),
  }));
  for (const menu of [nodeTools, acquisitionTools, issueTools]) {
    menu.addEventListener('toggle', () => {
      if (!menu.open) return;
      for (const other of [nodeTools, acquisitionTools, issueTools]) {
        if (other !== menu) other.open = false;
      }
    });
  }
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (!dirty && !pendingInlineEdit) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

function addNodeFromPalette(nodeType) {
  const point = insertionPoint ?? editorCenterPoint();
  const node = createNode(nodeType, point, capabilities, editor.graph);
  editor.addNode(node);
  insertionPoint = null;
  palette.classList.remove('awaiting-placement');
  nodeTools.open = false;
}

function editorCenterPoint() {
  const camera = editor.camera;
  const rect = editor.getBoundingClientRect();
  return {
    x: (rect.width / 2 - camera.x) / camera.scale,
    y: (Math.min(rect.height, 700) / 2 - camera.y) / camera.scale,
  };
}

function refreshUi() {
  issues = validateGraph(editor.graph);
  editor.refreshPresentation();
  renderIssues();
  refreshSaveState();
  undoButton.disabled = !editor.canUndo;
  redoButton.disabled = !editor.canRedo;
}

function refreshSaveState() {
  const errors = blockingIssues(issues);
  const unsaved = dirty || pendingInlineEdit;
  // A pending text/number edit may be correcting the currently reported
  // validation error. Let it commit on blur; save() validates the graph again.
  saveButton.disabled = !unsaved || (errors.length > 0 && !pendingInlineEdit);
  const showError = errors.length > 0 && !pendingInlineEdit;
  saveState.textContent = showError
    ? `Error · ${errors[0].message}`
    : unsaved ? 'Unsaved changes' : 'Saved';
  saveState.className = `daq-save-state ${showError ? 'error' : unsaved ? 'dirty' : 'saved'}`;
}

function renderIssues() {
  issueSummary.replaceChildren();
  issueTools.hidden = issues.length === 0;
  issueTools.classList.toggle('error', issues.some((issue) => issue.severity === 'error'));
  issueCount.textContent = String(issues.length);
  if (!issues.length) issueTools.open = false;
  const orderedIssues = [...issues].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  for (const issue of orderedIssues) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `daq-issue-item ${issue.severity}`;
    const subject = document.createElement('strong');
    subject.textContent = issueSubjectLabel(issue.subject);
    const message = document.createElement('span');
    message.textContent = issue.message;
    button.append(subject, message);
    button.addEventListener('click', () => focusIssue(issue));
    issueSummary.append(button);
  }
}

function issueSubjectLabel(subject) {
  if (subject === 'graph') return 'Acquisition';
  const node = editor.graph.nodes.find((candidate) => candidate.id === subject);
  if (!node) return subject;
  const channel = node.config?.channel;
  return channel ? `${node.title} · ${channel}` : node.title;
}

function focusIssue(issue) {
  if (issue.subject === 'graph') {
    openToolMenu(acquisitionTools);
    const target = issue.message.toLowerCase().includes('resolution')
      ? streamResolution
      : issue.message.toLowerCase().includes('settling') ? streamSettling : scanRate;
    if (target !== scanRate) signalQuality.open = true;
    target.focus({ preventScroll: true });
    return;
  }
  if (!editor.graph.nodes.some((node) => node.id === issue.subject)) return;
  editor.selectNode(issue.subject);
  requestAnimationFrame(() => editor.frameNode(issue.subject));
}

async function save() {
  editor.flushInlineEdit();
  const errors = blockingIssues(validateGraph(editor.graph));
  if (errors.length) return refreshUi();
  saveButton.disabled = true;
  saveState.textContent = 'Saving…';
  try {
    await saveConfiguration(editor.graph);
    dirty = false;
    pendingInlineEdit = false;
    refreshUi();
  } catch (error) {
    saveState.textContent = error.detail?.issues?.[0]?.message ?? error.message;
    saveState.className = 'daq-save-state error';
  }
}

async function reload() {
  if ((dirty || pendingInlineEdit) && !window.confirm('Discard unsaved DAQ configuration changes?')) return;
  const payload = await loadConfiguration();
  editor.graph = payload.graph;
  syncAcquisitionControls();
  dirty = false;
  pendingInlineEdit = false;
  refreshUi();
  syncPreviewState();
  preview?.refreshSoon();
}

function syncPreviewState() {
  if (!preview) return;
  const hasSimulation = editor.graph.nodes.some(isPreviewSourceNode);
  if (capabilities?.device?.connected || hasSimulation) preview.start();
  else preview.stop();
}

function syncAcquisitionControls() {
  const metadata = editor.graph.metadata ?? {};
  scanRate.value = metadata.scanRate ?? 1000;
  streamResolution.value = metadata.streamResolutionIndex ?? 0;
  streamSettling.value = metadata.streamSettlingUs ?? 0;
  signalQuality.open = Number(streamResolution.value) !== 0 || Number(streamSettling.value) > 0;
}

function openToolMenu(menu) {
  for (const other of [nodeTools, acquisitionTools, issueTools]) {
    other.open = other === menu;
  }
}

function severityRank(severity) {
  return severity === 'error' ? 0 : severity === 'warning' ? 1 : 2;
}
