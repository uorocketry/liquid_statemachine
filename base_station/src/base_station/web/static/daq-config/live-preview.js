import { isPreviewSourceNode } from './node-specs.js';
import { blockingIssues, validateGraph } from './validation.js';

/** One WebSocket session for browser-owned draft graph preview. */
export class DaqLivePreview {
  constructor(editor, labjackSettings = {}, onStatus) {
    this.editor = editor;
    this.labjackSettings = labjackSettings;
    this.onStatus = onStatus;
    this.enabled = false;
    this.socket = null;
    this.sendTimer = null;
    this.reconnectTimer = null;
    this.histories = new Map();
  }

  start() {
    if (this.enabled) return;
    this.enabled = true;
    this._connect();
  }

  stop() {
    this.enabled = false;
    if (this.sendTimer) window.clearTimeout(this.sendTimer);
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.sendTimer = null;
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.editor.clearNodePreview();
    this.onStatus?.('paused', 'Live preview paused');
  }

  refreshSoon() {
    if (!this.enabled) return;
    if (this.sendTimer) window.clearTimeout(this.sendTimer);
    this.sendTimer = window.setTimeout(() => {
      this.sendTimer = null;
      this._sendGraph();
    }, 80);
  }

  _connect() {
    if (!this.enabled || this.socket) return;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${location.host}/api/daq/preview/ws`);
    this.socket = socket;
    socket.addEventListener('open', () => this._sendGraph());
    socket.addEventListener('message', (event) => this._handlePayload(event.data));
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = null;
      if (!this.enabled) return;
      this.onStatus?.('warning', 'Live preview reconnecting…');
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this._connect();
      }, 1000);
    });
  }

  _sendGraph() {
    if (!this.enabled) return;
    const graph = this.editor.graph;
    if (blockingIssues(validateGraph(graph, this.labjackSettings)).length) {
      this.editor.clearNodePreview();
      this.onStatus?.('warning', 'Fix configuration errors to preview');
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'graph', graph }));
    }
  }

  _handlePayload(data) {
    let payload;
    try { payload = JSON.parse(data); } catch { return; }
    if (payload.issues?.length) {
      this.editor.clearNodePreview();
      this.onStatus?.('warning', payload.issues[0]?.message ?? 'Fix configuration errors to preview');
      return;
    }
    const graph = this.editor.graph;
    const previews = {};
    for (const [nodeId, reading] of Object.entries(payload.values ?? {})) {
      const history = this.histories.get(nodeId) ?? [];
      history.push(Number(reading.value));
      if (history.length > 48) history.shift();
      this.histories.set(nodeId, history);
      previews[nodeId] = {
        label: 'Live',
        value: formatValue(reading.value),
        unit: reading.unit ?? '',
        samples: history,
        detail: previewDetail(reading),
      };
    }
    for (const nodeId of payload.unresolved ?? []) {
      const node = graph.nodes.find((candidate) => candidate.id === nodeId);
      if (node?.nodeType === 'rate-of-change') {
        previews[nodeId] = {
          label: 'Stream only', value: '—', unit: rateUnit(node, graph),
          detail: 'Requires acquisition history',
        };
      }
    }
    if (payload.errors?.length && !Object.keys(payload.values ?? {}).length) {
      this.editor.clearNodePreview();
    } else {
      this.editor.updateNodePreviews(previews);
    }
    if (payload.errors?.length) this.onStatus?.('warning', payload.errors[0]);
    else if (Object.keys(previews).length) this.onStatus?.('live', 'Live preview');
    else this.onStatus?.('idle', 'Waiting for configured inputs');
  }
}

function rateUnit(node, graph) {
  const link = graph.links.find((candidate) => candidate.toNode === node.id && candidate.toPin === 'input');
  const source = graph.nodes.find((candidate) => candidate.id === link?.fromNode);
  const unit = source?.pins?.find((pin) => pin.id === link?.fromPin)?.type;
  return unit && unit !== 'infer' && unit !== '*' ? `${unit}/s` : '';
}

/** Highlight the shortest upstream source path to a selected node. */
export function highlightPathToSelection(editor, graph, nodeId) {
  if (!nodeId) {
    editor.clearPreviewPath();
    return;
  }
  const sources = graph.nodes.filter((node) => (
    node.nodeType?.startsWith('labjack-') || isPreviewSourceNode(node)
  ));
  let best = [];
  for (const source of sources) {
    const path = editor.previewPathBetween(source.id, nodeId);
    if (path.length && (!best.length || path.length < best.length)) best = path;
  }
  if (best.length) editor.setPreviewPath(best);
  else if (sources.some((source) => source.id === nodeId)) editor.setPreviewPath([nodeId]);
  else editor.clearPreviewPath();
}

function formatValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (Math.abs(number) >= 1000 || (Math.abs(number) > 0 && Math.abs(number) < 0.001)) return number.toExponential(4);
  return Number(number.toPrecision(6)).toString();
}

function previewDetail(reading) {
  if (Number.isFinite(reading.rawVolts) && reading.unit !== 'V') return `${formatValue(reading.rawVolts)} V raw`;
  return '';
}
