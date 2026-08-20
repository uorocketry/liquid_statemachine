import { previewConfiguration } from './api.js';
import { isPreviewSourceNode } from './node-specs.js';

/** Low-rate configuration preview driver backed by the real LJM API endpoint. */
export class DaqLivePreview {
  constructor(editor, onStatus) {
    this.editor = editor;
    this.onStatus = onStatus;
    this.enabled = false;
    this.timer = null;
    this.inFlight = false;
    this.histories = new Map();
  }

  start() {
    if (this.enabled) return;
    this.enabled = true;
    this._schedule(0);
  }

  stop() {
    this.enabled = false;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
    this.editor.clearNodePreview();
    this.onStatus?.('paused', 'Live preview paused');
  }

  refreshSoon() {
    if (!this.enabled) return;
    if (this.timer) window.clearTimeout(this.timer);
    this._schedule(80);
  }

  async _poll() {
    if (!this.enabled || this.inFlight) return;
    this.inFlight = true;
    try {
      const payload = await previewConfiguration(this.editor.graph);
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
        const node = this.editor.graph.nodes.find((candidate) => candidate.id === nodeId);
        if (node?.nodeType === 'rate-of-change') {
          const unit = rateUnit(node, this.editor.graph);
          previews[nodeId] = {
            label: 'Stream only', value: '—', unit,
            detail: 'Requires acquisition history',
          };
        }
      }
      if (payload.errors?.length && !Object.keys(payload.values ?? {}).length) {
        this.editor.clearNodePreview();
      }
      this.editor.updateNodePreviews(previews);
      if (payload.errors?.length) this.onStatus?.('warning', payload.errors[0]);
      else if (Object.keys(previews).length) this.onStatus?.('live', 'Live LabJack preview');
      else this.onStatus?.('idle', 'Waiting for configured inputs');
    } catch (error) {
      if (error.status === 422) this.onStatus?.('warning', 'Fix configuration errors to preview');
      else this.onStatus?.('error', error.message);
    } finally {
      this.inFlight = false;
      if (this.enabled) this._schedule(650);
    }
  }

  _schedule(delay) {
    this.timer = window.setTimeout(() => this._poll(), delay);
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
  const magnitude = Math.abs(number);
  if (magnitude >= 1000) return number.toFixed(0);
  if (magnitude >= 100) return number.toFixed(1);
  if (magnitude >= 1) return number.toFixed(3);
  return number.toPrecision(5);
}

function previewDetail(reading) {
  if (reading.rawVolts === undefined) return '';
  const raw = Number(reading.rawVolts);
  if (reading.coldJunctionK !== undefined) {
    return `${raw.toFixed(6)} V · CJC ${Number(reading.coldJunctionK).toFixed(2)} K`;
  }
  return `${raw.toFixed(6)} V raw`;
}
