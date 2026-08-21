import { differentialNegative } from './channels.js';
import { daqConnectionAllowed } from './connection-policy.js';
import { isSpecNodeType, validateSpecNode } from './node-specs.js';

const MEASUREMENT_TYPES = new Set(['labjack-ain', 'labjack-current', 'labjack-thermocouple']);
const HARDWARE_NODE_TYPES = new Set([
  'labjack-channel', 'labjack-channel-pair', ...MEASUREMENT_TYPES,
  'pressure-calibration', 'load-cell',
]);

/**
 * Fast client-side checks. The server repeats authoritative validation on save.
 * @param {Object} graph
 * @param {Object} labjackSettings
 * @returns {{severity:'error'|'warning',subject:string,message:string}[]}
 */
export function validateGraph(graph, labjackSettings = {}) {
  const issues = [];
  const nodes = graph?.nodes ?? [];
  const incoming = new Map();
  for (const link of graph?.links ?? []) {
    incoming.set(`${link.toNode}:${link.toPin}`, link);
  }
  validateLinks(graph, issues);
  const mux = Boolean(labjackSettings?.mux80Enabled);
  const usedSources = new Map();

  for (const node of nodes) {
    if (!isSpecNodeType(node.nodeType) && !HARDWARE_NODE_TYPES.has(node.nodeType)) {
      issues.push(issue('error', node.id, `Unsupported node type: ${node.nodeType}`));
    }
    if (node.nodeType === 'labjack-channel' || node.nodeType === 'labjack-channel-pair') {
      validateChannel(node, mux, usedSources, issues);
    }
    if (MEASUREMENT_TYPES.has(node.nodeType)) validateMeasurement(node, graph, incoming, issues);
    for (const pin of node.pins ?? []) {
      if (pin.direction !== 'input' || pin.optional) continue;
      if (!incoming.has(`${node.id}:${pin.id}`)) {
        issues.push(issue('warning', node.id, `${pin.label} is not connected`));
      }
    }
    const specMessages = validateSpecNode(node);
    if (specMessages) {
      for (const message of specMessages) issues.push(issue('error', node.id, message));
    }
    if (node.nodeType === 'pressure-calibration') {
      let complete = true;
      for (const field of ['inputMin', 'inputMax', 'psiMin', 'psiMax']) {
        if (!requiredNumber(linkedOrLiteral(node, field, graph, incoming, node.config?.[field]))) {
          issues.push(issue('error', node.id, 'Pressure calibration requires all four calibration values'));
          complete = false;
          break;
        }
      }
      const inputMin = linkedOrLiteral(node, 'inputMin', graph, incoming, node.config?.inputMin);
      const inputMax = linkedOrLiteral(node, 'inputMax', graph, incoming, node.config?.inputMax);
      if (complete && Number(inputMin) === Number(inputMax)) {
        issues.push(issue('error', node.id, 'Pressure calibration input span cannot be zero'));
      }
    }
    if (node.nodeType === 'load-cell') {
      const rated = linkedOrLiteral(node, 'ratedOutputMvV', graph, incoming, node.config?.ratedOutputMvV);
      const capacity = linkedOrLiteral(node, 'capacity', graph, incoming, node.config?.capacity);
      const zero = linkedOrLiteral(node, 'zeroV', graph, incoming, node.config?.zeroV);
      const excitation = linkedOrLiteral(node, 'excitation', graph, incoming, node.config?.excitationV);
      if (!(Number(rated) > 0)) issues.push(issue('error', node.id, 'Rated output must be positive'));
      if (!(Number(capacity) > 0)) issues.push(issue('error', node.id, 'Rated capacity must be positive'));
      if (!requiredNumber(zero)) {
        issues.push(issue('error', node.id, 'Load cell zero offset is required'));
      }
      if (!(Number(excitation) > 0)) issues.push(issue('error', node.id, 'Load cell excitation must be positive'));
    }
  }
  return issues;
}

function validateLinks(graph, issues) {
  const nodes = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
  for (const link of graph?.links ?? []) {
    const sourceNode = nodes.get(link.fromNode);
    const targetNode = nodes.get(link.toNode);
    const source = sourceNode?.pins?.find((pin) => pin.id === link.fromPin);
    const target = targetNode?.pins?.find((pin) => pin.id === link.toPin);
    if (!sourceNode || !targetNode || !source || !target) continue;
    if (daqConnectionAllowed(source, target, sourceNode, targetNode, graph)) continue;
    issues.push(issue(
      'error',
      targetNode.id,
      `${target.label} cannot accept ${source.type ?? 'this connection'}`,
    ));
  }
}

function validateChannel(node, mux, usedSources, issues) {
  const channel = node.config?.channel;
  const number = /^AIN\d+$/.test(channel ?? '') ? Number(channel.slice(3)) : NaN;
  const valid = Number.isInteger(number) && (number <= 13 || (mux && number >= 48 && number <= 127));
  if (!valid || (mux && number >= 4 && number <= 13)) {
    issues.push(issue('error', node.id, `${channel ?? 'Channel'} is unavailable for this hardware setup`));
  }
  if (node.nodeType === 'labjack-channel-pair') {
    const negative = differentialNegative(channel);
    const negativeNumber = /^AIN\d+$/.test(negative ?? '') ? Number(negative.slice(3)) : NaN;
    const validPositive = Number.isInteger(number) && (
      (number < 16 && number % 2 === 0)
      || (number >= 48 && number <= 127 && Math.floor((number - 48) / 8) % 2 === 0)
    );
    if (!validPositive || !Number.isInteger(negativeNumber)) {
      issues.push(issue('error', node.id, `${channel ?? 'Channel'} cannot start a differential pair`));
    }
  }
  const key = channel;
  const previous = usedSources.get(key);
  if (previous && previous !== node.id) {
    issues.push(issue('warning', node.id, `${channel} is also referenced by ${previous}`));
  } else usedSources.set(key, node.id);
}

function validateMeasurement(node, graph, incoming, issues) {
  const config = node.config ?? {};
  if (node.nodeType === 'labjack-thermocouple' && !node.config?.thermocoupleType) {
    issues.push(issue('error', node.id, 'Select the thermocouple type'));
  }
  if (node.nodeType === 'labjack-current') {
    if (!linkedChannel(node.id, 'channel', graph, incoming)) {
      issues.push(issue('error', node.id, 'Channel requires a channel reference'));
    }
    const shunt = linkedNode(node.id, 'shunt', graph, incoming);
    if (shunt && (shunt.nodeType !== 'constant' || shunt.config?.unit !== 'Ω')) {
      issues.push(issue('error', node.id, 'Shunt input must use Ω'));
    } else if (shunt && !(Number(shunt.config?.value) > 0)) {
      issues.push(issue('error', node.id, 'Shunt resistance must be positive'));
    } else if (!shunt && !(Number(node.config?.shuntOhms) > 0)) {
      issues.push(issue('error', node.id, 'Enter a positive shunt resistance or connect an Ω constant'));
    }
  }
  if (node.nodeType === 'labjack-ain') {
    const source = linkedNode(node.id, 'channel', graph, incoming);
    if (!['labjack-channel', 'labjack-channel-pair'].includes(source?.nodeType)) {
      issues.push(issue('error', node.id, 'Channel requires a channel reference or channel pair'));
    }
  }
  if (node.nodeType === 'labjack-thermocouple') {
    const source = linkedNode(node.id, 'pair', graph, incoming);
    if (source?.nodeType !== 'labjack-channel-pair') {
      issues.push(issue('error', node.id, 'Thermocouple requires a channel pair'));
    }
  }
  if (![10, 1, 0.1, 0.01].includes(Number(config.rangeV))) {
    issues.push(issue('error', node.id, 'Input range must be ±10, ±1, ±0.1, or ±0.01 V'));
  }
}

function linkedChannel(nodeId, pinId, graph, incoming) {
  const source = linkedNode(nodeId, pinId, graph, incoming);
  return source?.nodeType === 'labjack-channel' ? source.config?.channel ?? null : null;
}

function linkedNode(nodeId, pinId, graph, incoming) {
  const link = incoming.get(`${nodeId}:${pinId}`);
  if (!link) return null;
  return (graph.nodes ?? []).find((node) => node.id === link.fromNode) ?? null;
}

function linkedOrLiteral(node, pinId, graph, incoming, literal) {
  const source = linkedNode(node.id, pinId, graph, incoming);
  if (source?.nodeType === 'constant') return source.config?.value;
  return literal;
}

function issue(severity, subject, message) {
  return { severity, subject, message };
}

export function blockingIssues(issues) {
  return issues.filter((item) => item.severity === 'error');
}

function requiredNumber(value) {
  return value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value));
}
