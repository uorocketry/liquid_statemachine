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

const EDITOR_CONTRACT_VERSION = 2;

const editor = document.querySelector('#daq-blueprint');
const nodeTools = document.querySelector('#daq-node-tools');
const issueSummary = document.querySelector('#daq-issue-summary');
const issueTools = document.querySelector('#daq-issue-tools');
const issueCount = document.querySelector('#daq-issue-count');
const saveButton = document.querySelector('#daq-save');
const undoButton = document.querySelector('#daq-undo');
const redoButton = document.querySelector('#daq-redo');
const frameButton = document.querySelector('#daq-frame');
const saveState = document.querySelector('#daq-save-state');

let capabilities = null;
let labjackSettings = {};
let insertionPoint = null;
let dirty = false;
let issues = [];
let preview = null;
let paletteTools = null;

bootstrap().catch((error) => {
  saveState.textContent = `Failed to load: ${error.message}`;
  saveState.className = 'daq-save-state error';
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

  paletteTools = createPaletteMenus(nodeTools, addNodeFromPalette, () => {
    issueTools.open = false;
  });
  preview = new DaqLivePreview(editor, labjackSettings);
  bindEvents();
  refreshUi();
  syncPreviewState();
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
    dirty = true;
    refreshUi();
    syncPreviewState();
    preview?.refreshSoon();
  });
  editor.addEventListener('blueprint-inline-draft-change', refreshSaveState);

  saveButton.addEventListener('click', save);
  undoButton.addEventListener('click', () => editor.undo());
  redoButton.addEventListener('click', () => editor.redo());
  frameButton.addEventListener('click', () => editor.fitGraph());
  issueTools.addEventListener('toggle', () => {
    if (issueTools.open) paletteTools?.closeAll();
  });

  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (!dirty && !editor.hasPendingInlineEdit) return;
    event.preventDefault();
    event.returnValue = '';
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

function refreshUi() {
  issues = validateGraph(editor.graph, labjackSettings);
  editor.refreshPresentation();
  renderIssues();
  refreshSaveState();
  undoButton.disabled = !editor.canUndo;
  redoButton.disabled = !editor.canRedo;
}

function refreshSaveState() {
  const errors = blockingIssues(issues);
  const pending = editor.hasPendingInlineEdit;
  const unsaved = dirty || pending;
  saveButton.disabled = !unsaved || (errors.length > 0 && !pending);
  const showError = errors.length > 0 && !pending;
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

  const ordered = [...issues].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  for (const issue of ordered) {
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
  if (subject === 'graph') return 'Graph';
  const node = editor.graph.nodes.find((candidate) => candidate.id === subject);
  if (!node) return subject;
  const channel = node.config?.channel;
  return channel ? `${node.title} · ${channel}` : node.title;
}

function focusIssue(issue) {
  if (issue.subject === 'graph') return editor.fitGraph();
  if (!editor.graph.nodes.some((node) => node.id === issue.subject)) return;
  editor.selectNode(issue.subject);
  requestAnimationFrame(() => editor.frameNode(issue.subject));
}

async function save() {
  editor.flushInlineEdit();
  const errors = blockingIssues(validateGraph(editor.graph, labjackSettings));
  if (errors.length) return refreshUi();
  saveButton.disabled = true;
  saveState.textContent = 'Saving…';
  try {
    const result = await saveGraph(editor.graph);
    dirty = false;
    issues = result.issues ?? [];
    editor.adoptGraph(result.graph);
    refreshUi();
  } catch (error) {
    saveState.textContent = issueMessage(error) ?? error.message;
    saveState.className = 'daq-save-state error';
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

function severityRank(severity) {
  return severity === 'error' ? 0 : severity === 'warning' ? 1 : 2;
}
