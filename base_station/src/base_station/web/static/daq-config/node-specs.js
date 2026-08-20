/** Declarative definitions for hardware-independent DAQ graph nodes. */

const ENGINEERING_UNITS = ['psi', 'kg', 'kg/s', 'N', 'lb', 'K', 'V', 'A', 'Ω', 'mV/V'];
const GAUGE_TYPES = [
  ['dial-filled', 'Filled dial'],
  ['dial-needle', 'Needle dial'],
  ['meter-horizontal', 'Horizontal meter'],
  ['meter-vertical', 'Vertical meter'],
  ['meter-vertical-inverted', 'Vertical meter inverted'],
];

const DEFAULT_GAUGE = {
  type: 'dial-filled',
  showValue: true,
  showUnits: true,
  showRange: true,
  min: 0,
  low: 10,
  high: 90,
  max: 100,
};

const SPECS = {
  'sine-wave': {
    category: 'Simulation',
    title: 'Sine wave',
    icon: 'icon-node-sine',
    tone: 'source',
    description: 'Generate a configurable test signal without DAQ hardware.',
    previewSource: true,
    defaults: { amplitude: 1, periodS: 4, offset: 0, phaseRad: 0, randomness: 0, unit: 'V' },
    pins: (config) => [output('signal', 'Signal', config.unit)],
    controls: (config) => [
      numberControl('amplitude', 'Amplitude', config.amplitude, config.unit),
      numberControl('periodS', 'Period', config.periodS, 's', { min: 0, step: 0.1 }),
      numberControl('offset', 'Offset', config.offset, config.unit),
      numberControl('phaseRad', 'Phase', config.phaseRad, 'rad', { step: 0.1 }),
      numberControl('randomness', 'Randomness', config.randomness, '', { min: 0, max: 1, step: 0.05 }),
      selectControl('unit', 'Unit', config.unit, ENGINEERING_UNITS.map(option)),
    ],
    badge: (config) => `${format(config.periodS)} s`,
    outputUnit: (node, pinId) => pinId === 'signal' ? node.config?.unit ?? 'V' : undefined,
    unitOutputPins: ['signal'],
    validate: validateSine,
  },
  constant: {
    category: 'Math',
    title: 'Constant',
    icon: 'icon-node-constant',
    tone: 'transform',
    description: 'Named engineering constant such as tank dry mass.',
    defaults: { value: 0, unit: 'kg' },
    pins: (config) => [output('value', 'Value', config.unit)],
    controls: (config) => [
      numberControl('value', 'Value', config.value, config.unit),
      selectControl('unit', 'Unit', config.unit, ENGINEERING_UNITS.map(option)),
    ],
    badge: (config) => `${format(config.value)} ${config.unit ?? ''}`.trim(),
    outputUnit: (node, pinId) => pinId === 'value' ? node.config?.unit ?? null : undefined,
    unitOutputPins: ['value'],
    validate: (config) => finite(config.value) ? [] : ['Constant value must be finite'],
  },
  add: inferredMathSpec('Add', 'icon-node-add', 'Add two engineering signals with matching units.', 'A + B'),
  subtract: inferredMathSpec('Subtract', 'icon-node-subtract', 'Subtract one engineering signal from another.', 'A − B'),
  gain: {
    ...inferredUnarySpec('Gain', 'icon-node-gain', 'Scale an engineering signal by a dimensionless gain.', 'Scaled'),
    defaults: { gain: 1 },
    controls: (config) => [numberControl('gain', 'Gain', config.gain)],
    validate: (config) => finite(config.gain) ? [] : ['Gain must be finite'],
  },
  'moving-average': {
    ...inferredUnarySpec('Moving average', 'icon-node-average', 'Smooth a signal over a configurable time window.', 'Average'),
    defaults: { windowS: 0.5 },
    controls: (config) => [numberControl('windowS', 'Window', config.windowS, 's', { min: 0.001, step: 0.05 })],
    validate: (config) => positive(config.windowS) ? [] : ['Moving-average window must be positive'],
  },
  'rate-of-change': {
    category: 'Math',
    title: 'Rate of change',
    icon: 'icon-node-rate',
    tone: 'transform',
    description: 'Time derivative for mass-flow and similar derived signals.',
    defaults: { windowS: 0.5 },
    pins: () => [input('input', 'Signal', 'infer', '*'), output('rate', 'Rate', 'infer')],
    controls: (config) => [numberControl('windowS', 'Window', config.windowS, 's', { min: 0.01, step: 0.05 })],
    decorate(next, graph, helpers) {
      const unit = helpers.incomingUnit(next, graph, 'input');
      const outputUnit = concrete(unit) ? `${unit}/s` : 'infer';
      setPinType(next, 'input', unit ?? 'infer');
      setPinType(next, 'rate', outputUnit);
      next.badge = outputUnit;
    },
    outputUnit: (_node, pinId, resolveInput) => {
      if (pinId !== 'rate') return undefined;
      const unit = resolveInput('input');
      return concrete(unit) ? `${unit}/s` : null;
    },
    validate: (config) => positive(config.windowS) ? [] : ['Rate-of-change window must be positive'],
  },
  'dashboard-signal': {
    category: 'Dashboard',
    title: 'Dashboard signal',
    icon: 'icon-node-dashboard',
    tone: 'result',
    description: 'Publish a number, plot, or gauge to the operator dashboard.',
    defaults: {
      label: '',
      group: 'Engine',
      display: 'both',
      precision: 1,
    },
    pins: () => [input('value', 'Value', '*', '*')],
    controls: dashboardControls,
    decorate(next, graph, helpers) {
      const unit = helpers.incomingUnit(next, graph, 'value');
      if (concrete(unit)) setPinType(next, 'value', unit);
      if (next.config?.display === 'gauge') next.icon = 'icon-node-gauge';
    },
    validate: validateDashboard,
  },
};

export const SPEC_NODE_CATALOG = Object.entries(SPECS).map(([type, spec]) => ({
  type,
  category: spec.category,
  title: spec.title,
  icon: spec.icon,
  description: spec.description,
}));

export function isSpecNodeType(nodeType) {
  return Boolean(SPECS[nodeType]);
}

export function isPreviewSourceNode(node) {
  return Boolean(SPECS[node?.nodeType]?.previewSource);
}

export function createSpecNode(nodeType, common) {
  const spec = SPECS[nodeType];
  if (!spec) return null;
  const config = structuredClone(spec.defaults ?? {});
  return { ...common, tone: spec.tone, config, pins: spec.pins(config) };
}

export function decorateSpecNode(node, graph, helpers) {
  const spec = SPECS[node.nodeType];
  if (!spec) return null;
  const next = structuredClone(node);
  const config = normalizedConfig(node.nodeType, spec.defaults ?? {}, next.config ?? {});
  next.config = config;
  next.icon = spec.icon;
  next.controls = spec.controls?.(config) ?? [];
  if (spec.infer) decorateInferred(next, graph, helpers.incomingUnit, spec.infer);
  spec.decorate?.(next, graph, helpers);
  if (spec.badge) next.badge = spec.badge(config);
  return next;
}

export function validateSpecNode(node) {
  const spec = SPECS[node?.nodeType];
  return spec
    ? (spec.validate?.(normalizedConfig(node.nodeType, spec.defaults ?? {}, node.config ?? {})) ?? [])
    : null;
}

export function specOutputUnit(node, pinId, resolveInput) {
  const spec = SPECS[node?.nodeType];
  return spec?.outputUnit ? spec.outputUnit(node, pinId, resolveInput) : undefined;
}

export function patchSpecPins(node, key, value) {
  const spec = SPECS[node?.nodeType];
  if (!spec || key !== 'unit' || !spec.unitOutputPins?.length) return null;
  const targets = new Set(spec.unitOutputPins);
  return node.pins.map((pin) => targets.has(pin.id) ? { ...pin, type: String(value) } : pin);
}

export function numberControl(key, label, value, unit = '', options = {}) {
  return {
    key, label, type: 'number', value, unit, valueType: 'number',
    step: options.step ?? 'any', min: options.min, max: options.max,
  };
}

export function textControl(key, label, value) {
  return { key, label, type: 'text', value };
}

export function selectControl(key, label, value, options, valueType = 'string') {
  return { key, label, type: 'select', value, options, valueType };
}

export function toggleControl(key, label, value) {
  return { key, label, type: 'toggle', value: Boolean(value), valueType: 'boolean' };
}

function inferredMathSpec(title, icon, description, outputLabel) {
  return {
    category: 'Math', title, icon, tone: 'transform', description,
    defaults: {},
    pins: () => [input('a', 'A', 'infer', '*'), input('b', 'B', 'infer', '*'), output('result', outputLabel, 'infer')],
    infer: { inputs: ['a', 'b'], output: 'result' },
    outputUnit: (_node, pinId, resolveInput) => pinId === 'result'
      ? resolveInput('a') ?? resolveInput('b')
      : undefined,
  };
}

function inferredUnarySpec(title, icon, description, outputLabel) {
  return {
    category: 'Math', title, icon, tone: 'transform', description,
    defaults: {},
    pins: () => [input('input', 'Signal', 'infer', '*'), output('result', outputLabel, 'infer')],
    infer: { inputs: ['input'], output: 'result' },
    outputUnit: (_node, pinId, resolveInput) => pinId === 'result' ? resolveInput('input') : undefined,
  };
}

function dashboardControls(config) {
  const controls = [
    textControl('label', 'Label', config.label),
    selectControl('group', 'Group', config.group, ['Fuel', 'LOX', 'Engine'].map(option)),
    selectControl('display', 'Display', config.display, [
      ['number', 'Number'], ['plot', 'Plot'], ['both', 'Number + plot'], ['gauge', 'Gauge'],
    ]),
    numberControl('precision', 'Decimals', config.precision, '', { min: 0, max: 6, step: 1 }),
  ];
  if (config.display !== 'gauge') return controls;
  const gauge = { ...DEFAULT_GAUGE, ...(config.gauge ?? {}) };
  controls.push(
    selectControl('gauge.type', 'Gauge type', gauge.type, GAUGE_TYPES),
    toggleControl('gauge.showValue', 'Show value', gauge.showValue),
    toggleControl('gauge.showUnits', 'Show units', gauge.showUnits),
    toggleControl('gauge.showRange', 'Show range', gauge.showRange),
    numberControl('gauge.min', 'Minimum', gauge.min),
    numberControl('gauge.low', 'Low limit', gauge.low),
    numberControl('gauge.high', 'High limit', gauge.high),
    numberControl('gauge.max', 'Maximum', gauge.max),
  );
  return controls;
}

function decorateInferred(node, graph, incomingUnit, infer) {
  const unit = infer.inputs.map((pin) => incomingUnit(node, graph, pin)).find(concrete) ?? 'infer';
  for (const pin of infer.inputs) setPinType(node, pin, unit);
  setPinType(node, infer.output, unit);
  node.badge = unit;
}

function validateSine(config) {
  const issues = [];
  for (const [key, label] of [
    ['amplitude', 'amplitude'], ['periodS', 'period'], ['offset', 'offset'],
    ['phaseRad', 'phase'], ['randomness', 'randomness'],
  ]) {
    if (!finite(config[key])) issues.push(`Sine-wave ${label} must be finite`);
  }
  if (finite(config.periodS) && Number(config.periodS) < 0) issues.push('Sine-wave period cannot be negative');
  if (finite(config.randomness) && (Number(config.randomness) < 0 || Number(config.randomness) > 1)) {
    issues.push('Sine-wave randomness must be between 0 and 1');
  }
  if (!String(config.unit ?? '').trim()) issues.push('Sine-wave unit is required');
  return issues;
}

function validateDashboard(config) {
  const issues = [];
  if (!String(config.label ?? '').trim()) issues.push('Dashboard signal requires a label');
  if (!['Fuel', 'LOX', 'Engine'].includes(config.group)) issues.push('Dashboard group must be Fuel, LOX, or Engine');
  if (!['number', 'plot', 'both', 'gauge'].includes(config.display)) {
    issues.push('Dashboard display must be number, plot, both, or gauge');
  }
  const precision = Number(config.precision);
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    issues.push('Dashboard decimal places must be 0 through 6');
  }
  if (config.display !== 'gauge') return issues;
  const gauge = { ...DEFAULT_GAUGE, ...(config.gauge ?? {}) };
  if (!GAUGE_TYPES.some(([value]) => value === gauge.type)) issues.push('Select a supported dashboard gauge type');
  for (const key of ['showValue', 'showUnits', 'showRange']) {
    if (typeof gauge[key] !== 'boolean') issues.push(`Gauge ${key} must be on or off`);
  }
  if (!finite(gauge.min) || !finite(gauge.max) || Number(gauge.max) <= Number(gauge.min)) {
    issues.push('Gauge maximum must be greater than minimum');
    return issues;
  }
  if (gauge.low !== null && gauge.low !== '' && (!finite(gauge.low) || Number(gauge.low) < Number(gauge.min) || Number(gauge.low) >= Number(gauge.max))) {
    issues.push('Gauge low limit must be within the display range');
  }
  if (gauge.high !== null && gauge.high !== '' && (!finite(gauge.high) || Number(gauge.high) <= Number(gauge.min) || Number(gauge.high) > Number(gauge.max))) {
    issues.push('Gauge high limit must be within the display range');
  }
  if (finite(gauge.low) && finite(gauge.high) && Number(gauge.low) > Number(gauge.high)) {
    issues.push('Gauge low limit cannot exceed the high limit');
  }
  return issues;
}

function mergedConfig(defaults, config) {
  const result = structuredClone(defaults);
  for (const [key, value] of Object.entries(config ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object') {
      result[key] = { ...result[key], ...structuredClone(value) };
    } else result[key] = structuredClone(value);
  }
  return result;
}

function normalizedConfig(nodeType, defaults, config) {
  const source = structuredClone(config ?? {});
  if (nodeType === 'sine-wave') {
    if (source.periodS === undefined && finite(source.frequencyHz)) {
      const frequency = Number(source.frequencyHz);
      source.periodS = frequency === 0 ? 0 : 1 / frequency;
    }
    if (source.phaseRad === undefined && finite(source.phaseDeg)) {
      source.phaseRad = Number(source.phaseDeg) * Math.PI / 180;
    }
    delete source.frequencyHz;
    delete source.phaseDeg;
  }
  return mergedConfig(defaults, source);
}

function input(id, label, type, expectedType = type, options = {}) {
  return { id, label, type, expectedType, direction: 'input', kind: 'data', ...options };
}
function output(id, label, type) {
  return { id, label, type, direction: 'output', kind: 'result' };
}
function setPinType(node, pinId, unit) {
  const pin = node.pins?.find((candidate) => candidate.id === pinId);
  if (pin) pin.type = unit;
}
function option(value) { return [value, value]; }
function concrete(unit) { return Boolean(unit && unit !== '*' && unit !== 'infer' && unit !== 'V / A'); }
function finite(value) { return value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value)); }
function positive(value) { return finite(value) && Number(value) > 0; }
function format(value) { return finite(value) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 5 }) : '—'; }
