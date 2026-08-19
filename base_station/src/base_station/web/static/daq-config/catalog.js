import { availableChannels, differentialNegative, differentialPositiveChannels } from './channels.js';

/** @typedef {import('../blueprint/model.js').BlueprintNode} BlueprintNode */

export const NODE_CATALOG = [
  { type: 'labjack-channel', category: 'LabJack', title: 'Channel reference', icon: 'icon-node-channel', description: 'Reference one physical T7 or MUX80 analog channel.' },
  { type: 'labjack-channel-pair', category: 'LabJack', title: 'Channel pair', icon: 'icon-node-pair', description: 'Reference one valid differential T7 or MUX80 channel pair.' },
  { type: 'labjack-ain', category: 'LabJack', title: 'Analog input', icon: 'icon-node-ain', description: 'Read one channel or a differential channel pair.' },
  { type: 'labjack-current', category: 'LabJack', title: 'Current input', icon: 'icon-node-current', description: 'Measure current through a shunt supplied by the graph.' },
  { type: 'labjack-thermocouple', category: 'LabJack', title: 'Thermocouple', icon: 'icon-node-thermocouple', description: 'Differential thermocouple measurement converted to Kelvin.' },
  { type: 'pressure-calibration', category: 'Sensors', title: 'Pressure calibration', icon: 'icon-node-pressure', description: 'Map voltage or current into calibrated PSI.' },
  { type: 'load-cell', category: 'Sensors', title: 'Load cell', icon: 'icon-node-load', description: 'Convert bridge voltage and excitation into mass or force.' },
  { type: 'constant', category: 'Math', title: 'Constant', icon: 'icon-node-constant', description: 'Named engineering constant such as tank dry mass.' },
  { type: 'subtract', category: 'Math', title: 'Subtract', icon: 'icon-node-subtract', description: 'Subtract one engineering signal from another.' },
  { type: 'rate-of-change', category: 'Math', title: 'Rate of change', icon: 'icon-node-rate', description: 'Time derivative for mass-flow and similar derived signals.' },
  { type: 'dashboard-signal', category: 'Dashboard', title: 'Dashboard signal', icon: 'icon-node-dashboard', description: 'Publish a value, plot, or both to the operator dashboard.' },
];

/**
 * @param {string} nodeType
 * @param {{x:number,y:number}} point
 * @param {Object} capabilities
 * @param {Object} graph
 * @returns {BlueprintNode}
 */
export function createNode(nodeType, point, capabilities, graph) {
  const definition = NODE_CATALOG.find((item) => item.type === nodeType);
  if (!definition) throw new Error(`Unknown DAQ node type: ${nodeType}`);
  const id = uniqueNodeId(graph, nodeType);
  const common = {
    id,
    nodeType,
    title: definition.title,
    icon: definition.icon,
    tone: toneFor(nodeType),
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
  const measurement = measurementDefaults();

  if (nodeType === 'labjack-channel') {
    const source = sourceDefaults(capabilities, graph);
    return {
      ...common,
      badge: source.channel,
      config: source,
      pins: [output('channel', 'Channel', 'channel-ref')],
    };
  }
  if (nodeType === 'labjack-channel-pair') {
    const source = pairDefaults(capabilities, graph);
    return {
      ...common,
      badge: `${source.channel} / ${differentialNegative(source.channel)}`,
      config: source,
      pins: [output('pair', 'Pair', 'channel-pair-ref')],
    };
  }
  if (nodeType === 'labjack-ain') return {
    ...common,
    config: measurement,
    pins: [
      input('channel', 'Channel', 'channel / pair', ['channel-ref', 'channel-pair-ref']),
      output('voltage', 'Voltage', 'V'),
    ],
  };
  if (nodeType === 'labjack-current') return {
    ...common,
    config: { ...measurement, rangeV: 10 },
    pins: [
      input('channel', 'Channel', 'channel-ref'),
      input('shunt', 'Shunt', 'Ω', 'Ω', { optional: true }),
      output('current', 'Current', 'A'),
    ],
  };
  if (nodeType === 'labjack-thermocouple') return {
    ...common,
    config: {
      ...measurement, rangeV: 0.01, thermocoupleType: '',
    },
    pins: [
      input('pair', 'Channel pair', 'channel-pair-ref'),
      output('temperature', 'Temperature', 'K'),
    ],
  };
  if (nodeType === 'pressure-calibration') return {
    ...common,
    config: { inputMin: null, inputMax: null, psiMin: null, psiMax: null },
    pins: [
      input('input', 'Sensor', 'V / A', ['V', 'A']),
      input('inputMin', 'Electrical min', 'V / A', ['V', 'A'], { optional: true }),
      input('inputMax', 'Electrical max', 'V / A', ['V', 'A'], { optional: true }),
      input('psiMin', 'Pressure min', 'psi', 'psi', { optional: true }),
      input('psiMax', 'Pressure max', 'psi', 'psi', { optional: true }),
      output('pressure', 'Pressure', 'psi'),
    ],
  };
  if (nodeType === 'load-cell') return {
    ...common,
    config: { excitationV: null, ratedOutputMvV: null, capacity: null, zeroV: null, unit: 'kg' },
    pins: [
      input('input', 'Bridge voltage', 'V'),
      input('excitation', 'Excitation', 'V', 'V', { optional: true }),
      input('ratedOutputMvV', 'Rated output', 'mV/V', 'mV/V', { optional: true }),
      input('zeroV', 'Zero offset', 'V', 'V', { optional: true }),
      input('capacity', 'Capacity', 'kg', 'kg', { optional: true }),
      output('load', 'Load', 'kg'),
    ],
  };
  if (nodeType === 'constant') return {
    ...common,
    config: { value: 0, unit: 'kg' },
    pins: [output('value', 'Value', 'kg')],
  };
  if (nodeType === 'subtract') return {
    ...common,
    config: {},
    pins: [input('a', 'A', 'infer', '*'), input('b', 'B', 'infer', '*'), output('result', 'A − B', 'infer')],
  };
  if (nodeType === 'rate-of-change') return {
    ...common,
    config: { windowS: 0.5 },
    pins: [input('input', 'Signal', 'infer', '*'), output('rate', 'Rate', 'infer')],
  };
  return {
    ...common,
    config: { label: '', group: 'Engine', display: 'both', precision: 1 },
    pins: [input('value', 'Value', '*', '*')],
  };
}

function sourceDefaults(capabilities, graph) {
  const muxEnabled = Boolean(graph?.metadata?.mux80Enabled);
  const channels = availableChannels(capabilities, muxEnabled);
  const used = new Set((graph?.nodes ?? [])
    .filter((node) => node.nodeType === 'labjack-channel')
    .map((node) => node.config?.channel)
    .filter(Boolean));
  const channel = channels.find((candidate) => !used.has(candidate)) ?? channels[0] ?? 'AIN0';
  return {
    deviceSerial: capabilities?.device?.serial_number ?? null,
    deviceIp: capabilities?.device?.ip ?? '192.168.8.51',
    channel,
  };
}

function pairDefaults(capabilities, graph) {
  const muxEnabled = Boolean(graph?.metadata?.mux80Enabled);
  const channels = differentialPositiveChannels(capabilities, muxEnabled);
  const used = new Set((graph?.nodes ?? [])
    .filter((node) => node.nodeType === 'labjack-channel-pair')
    .map((node) => node.config?.channel)
    .filter(Boolean));
  const channel = channels.find((candidate) => !used.has(candidate)) ?? channels[0] ?? 'AIN0';
  return {
    deviceSerial: capabilities?.device?.serial_number ?? null,
    deviceIp: capabilities?.device?.ip ?? '192.168.8.51',
    channel,
  };
}

function measurementDefaults() {
  return { rangeV: 0.1 };
}

/** @param {Object} graph @param {string} stem @returns {string} */
function uniqueNodeId(graph, stem) {
  const ids = new Set((graph?.nodes ?? []).map((node) => node.id));
  let serial = 1;
  let id = `${stem}-${serial}`;
  while (ids.has(id)) id = `${stem}-${++serial}`;
  return id;
}

function toneFor(type) {
  if (type.startsWith('labjack-')) return 'source';
  if (['pressure-calibration', 'load-cell'].includes(type)) return 'sensor';
  if (type === 'dashboard-signal') return 'result';
  return 'transform';
}

function input(id, label, type, expectedType = type, options = {}) {
  return { id, label, type, expectedType, direction: 'input', kind: 'data', ...options };
}

function output(id, label, type) {
  return { id, label, type, direction: 'output', kind: 'result' };
}
