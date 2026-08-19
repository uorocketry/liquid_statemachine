import '/static/blueprint/index.js';
import { loadCapabilities, loadConfiguration, saveConfiguration } from './api.js';
import { createNode } from './catalog.js';
import { createPalette } from './palette.js';
import { blockingIssues, validateGraph } from './validation.js';
import { DaqLivePreview, highlightPathToSelection } from './live-preview.js';
import { decorateNode } from './presentation.js';
import { patchInlineNode } from './node-editing.js';
import { daqConnectionAllowed } from './connection-policy.js';

const editor = document.querySelector('#daq-blueprint');
const palette = document.querySelector('#daq-palette');
const issueSummary = document.querySelector('#daq-issue-summary');
const saveButton = document.querySelector('#daq-save');
const reloadButton = document.querySelector('#daq-reload');
const saveState = document.querySelector('#daq-save-state');
const scanRate = document.querySelector('#daq-scan-rate');

let capabilities = null;
let insertionPoint = null;
let dirty = false;
let issues = [];
let preview = null;

bootstrap().catch((error) => {
  saveState.textContent = `Failed to load: ${error.message}`;
  saveState.className = 'error';
});

async function bootstrap() {
  const [capabilityPayload, configuration] = await Promise.all([
    loadCapabilities(),
    loadConfiguration(),
  ]);
  capabilities = capabilityPayload;
  editor.nodeDecorator = (node, graph) => {
    const displayNode = decorateNode(node, graph, capabilities);
    const nodeIssues = issues.filter((issue) => issue.subject === node.id);
    const primary = nodeIssues.find((issue) => issue.severity === 'error') ?? nodeIssues[0];
    if (primary) displayNode.warning = primary.message;
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
  if (capabilities?.device?.connected) preview.start();
}

function bindEvents() {
  editor.addEventListener('blueprint-create-request', (event) => {
    insertionPoint = event.detail.point;
    palette.classList.add('awaiting-placement');
    palette.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  editor.addEventListener('blueprint-selection-change', (event) => {
    highlightPathToSelection(editor, editor.graph, event.detail.nodeIds[0] ?? null);
  });
  editor.addEventListener('blueprint-change', () => {
    dirty = true;
    refreshUi();
    preview?.refreshSoon();
  });
  saveButton.addEventListener('click', save);
  reloadButton.addEventListener('click', reload);
  scanRate.addEventListener('change', () => editor.updateMetadata({ scanRate: Number(scanRate.value) }));
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });
}

function addNodeFromPalette(nodeType) {
  const point = insertionPoint ?? editorCenterPoint();
  const node = createNode(nodeType, point, capabilities, editor.graph);
  editor.addNode(node);
  insertionPoint = null;
  palette.classList.remove('awaiting-placement');
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
  const errors = blockingIssues(issues);
  saveButton.disabled = errors.length > 0 || !dirty;
  saveState.textContent = errors.length
    ? `Error · ${errors[0].message}`
    : dirty ? 'Unsaved changes' : 'Saved';
  saveState.className = errors.length ? 'error' : dirty ? 'dirty' : 'saved';
}

function renderIssues() {
  issueSummary.replaceChildren();
  for (const issue of issues) {
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
    scanRate.focus({ preventScroll: true });
    return;
  }
  if (!editor.graph.nodes.some((node) => node.id === issue.subject)) return;
  editor.selectNode(issue.subject);
  requestAnimationFrame(() => editor.frameNode(issue.subject));
}

async function save() {
  const errors = blockingIssues(validateGraph(editor.graph));
  if (errors.length) return refreshUi();
  saveButton.disabled = true;
  saveState.textContent = 'Saving…';
  try {
    await saveConfiguration(editor.graph);
    dirty = false;
    refreshUi();
  } catch (error) {
    saveState.textContent = error.detail?.issues?.[0]?.message ?? error.message;
    saveState.className = 'error';
  }
}

async function reload() {
  if (dirty && !window.confirm('Discard unsaved DAQ configuration changes?')) return;
  const payload = await loadConfiguration();
  editor.graph = payload.graph;
  syncAcquisitionControls();
  dirty = false;
  refreshUi();
  preview?.refreshSoon();
}

function syncAcquisitionControls() {
  const metadata = editor.graph.metadata ?? {};
  scanRate.value = metadata.scanRate ?? 1000;
}
