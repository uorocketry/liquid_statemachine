/** Declarative definitions for hardware-independent DAQ graph nodes. */

const ENGINEERING_UNITS = ['psi', 'kg', 'kg/s', 'N', 'lb', 'K', 'V', 'A', 'Ω', 'mV/V'];
const GAUGE_TYPES = [
  ['dial-filled', 'Filled dial'],
  ['dial-needle', 'Needle dial'],
  ['meter-horizontal', 'Horizontal meter'],
  ['meter-vertical', 'Vertical meter'],
  ['meter-vertical-inverted', 'Vertical meter inverted'],
];


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
  number: {
    category: 'Dashboard',
    title: 'Number',
    icon: 'icon-node-number',
    tone: 'result',
    description: 'Show one live engineering value on the operator dashboard.',
    defaults: { label: '', precision: 1, showUnits: true },
    pins: dashboardPins,
    controls: (config) => [
      ...dashboardIdentityControls(config),
      numberControl('precision', 'Decimals', config.precision, '', { min: 0, max: 6, step: 1 }),
      booleanControl('showUnits', 'Show units', config.showUnits),
    ],
    decorate: decorateDashboardInput,
    validate: (config) => [
      ...validateDashboardIdentity(config),
      ...validatePrecision(config.precision),
      ...(typeof config.showUnits === 'boolean' ? [] : ['Number showUnits must be on or off']),
    ],
  },
  gauge: {
    category: 'Dashboard',
    title: 'Gauge',
    icon: 'icon-node-gauge',
    tone: 'result',
    description: 'Show one live value against configured engineering limits.',
    defaults: {
      label: '', precision: 1,
      type: 'dial-filled', showValue: true, showUnits: true, showRange: true,
      min: 0, low: 10, high: 90, max: 100,
    },
    pins: dashboardPins,
    controls: gaugeControls,
    decorate: decorateDashboardInput,
    validate: validateGauge,
  },
  'time-plot': {
    category: 'Dashboard',
    title: 'Time plot',
    icon: 'icon-node-time-plot',
    tone: 'result',
    description: 'Plot one engineering value with configurable time and value axes.',
    defaults: {
      label: '',
      xRangeMode: 'shared',
      xWindowS: 10,
      xMinS: 0,
      xMaxS: 100,
      xTickMode: 'auto',
      xMajorStepS: 10,
      xLabel: 'Elapsed time',
      yAxisScale: 'linear',
      yRangeMode: 'auto',
      yMin: 0,
      yMax: 100,
      ySoftMin: null,
      ySoftMax: null,
      yTickMode: 'auto',
      yMajorStep: 10,
      yLabel: '',
      showGrid: true,
      showMinorGrid: false,
    },
    pins: dashboardPins,
    controls: timePlotControls,
    decorate: decorateDashboardInput,
    validate: validateTimePlot,
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
  const config = currentConfig(spec.defaults ?? {}, next.config ?? {});
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
    ? (spec.validate?.(currentConfig(spec.defaults ?? {}, node.config ?? {})) ?? [])
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

export function booleanControl(key, label, value) {
  return { key, label, type: 'boolean', value: Boolean(value), valueType: 'boolean' };
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

function dashboardIdentityControls(config) {
  return [textControl('label', 'Label', config.label)];
}

function gaugeControls(config) {
  return [
    ...dashboardIdentityControls(config),
    numberControl('precision', 'Decimals', config.precision, '', { min: 0, max: 6, step: 1 }),
    selectControl('type', 'Gauge type', config.type, GAUGE_TYPES),
    booleanControl('showValue', 'Show value', config.showValue),
    booleanControl('showUnits', 'Show units', config.showUnits),
    booleanControl('showRange', 'Show range', config.showRange),
    numberControl('min', 'Minimum', config.min),
    numberControl('low', 'Low limit', config.low),
    numberControl('high', 'High limit', config.high),
    numberControl('max', 'Maximum', config.max),
  ];
}

function timePlotControls(config) {
  const controls = [
    ...dashboardIdentityControls(config),
    selectControl('xRangeMode', 'X range', config.xRangeMode, [
      ['shared', 'Dashboard view'],
      ['auto', 'Auto data extent'],
      ['window', 'Trailing window'],
      ['fixed', 'Fixed bounds'],
    ]),
  ];
  if (config.xRangeMode === 'window') {
    controls.push(numberControl('xWindowS', 'X window', config.xWindowS, 's', { min: 0.001, step: 0.1 }));
  } else if (config.xRangeMode === 'fixed') {
    controls.push(
      numberControl('xMinS', 'X minimum', config.xMinS, 's'),
      numberControl('xMaxS', 'X maximum', config.xMaxS, 's'),
    );
  }
  controls.push(
    selectControl('xTickMode', 'X ticks', config.xTickMode, [['auto', 'Auto'], ['manual', 'Manual']]),
  );
  if (config.xTickMode === 'manual') {
    controls.push(numberControl('xMajorStepS', 'X major step', config.xMajorStepS, 's', { min: 0.000001 }));
  }
  controls.push(
    textControl('xLabel', 'X label', config.xLabel),
    selectControl('yAxisScale', 'Y scale', config.yAxisScale, [['linear', 'Linear'], ['log10', 'Log 10']]),
    selectControl('yRangeMode', 'Y range', config.yRangeMode, [
      ['auto', 'Auto'],
      ['soft', 'Soft bounds'],
      ['fixed', 'Fixed bounds'],
    ]),
  );
  if (config.yRangeMode === 'soft') {
    controls.push(
      numberControl('ySoftMin', 'Y soft minimum', config.ySoftMin),
      numberControl('ySoftMax', 'Y soft maximum', config.ySoftMax),
    );
  } else if (config.yRangeMode === 'fixed') {
    controls.push(
      numberControl('yMin', 'Y minimum', config.yMin),
      numberControl('yMax', 'Y maximum', config.yMax),
    );
  }
  if (config.yAxisScale === 'linear') {
    controls.push(selectControl('yTickMode', 'Y ticks', config.yTickMode, [['auto', 'Auto'], ['manual', 'Manual']]));
    if (config.yTickMode === 'manual') {
      controls.push(numberControl('yMajorStep', 'Y major step', config.yMajorStep, '', { min: 0.000001 }));
    }
  }
  controls.push(
    textControl('yLabel', 'Y label', config.yLabel),
    booleanControl('showGrid', 'Major grid', config.showGrid),
    booleanControl('showMinorGrid', 'Minor ticks / grid', config.showMinorGrid),
  );
  return controls;
}

function dashboardPins() {
  return [input('value', 'Value', '*', '*')];
}

function decorateDashboardInput(next, graph, helpers) {
  const unit = helpers.incomingUnit(next, graph, 'value');
  if (concrete(unit)) setPinType(next, 'value', unit);
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

function validateDashboardIdentity(config) {
  const issues = [];
  if (!String(config.label ?? '').trim()) issues.push('Dashboard widget requires a label');
  return issues;
}

function validatePrecision(value) {
  const precision = Number(value);
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    return ['Dashboard decimal places must be 0 through 6'];
  }
  return [];
}

function validateGauge(config) {
  const issues = [...validateDashboardIdentity(config), ...validatePrecision(config.precision)];
  if (!GAUGE_TYPES.some(([value]) => value === config.type)) issues.push('Select a supported dashboard gauge type');
  for (const key of ['showValue', 'showUnits', 'showRange']) {
    if (typeof config[key] !== 'boolean') issues.push(`Gauge ${key} must be on or off`);
  }
  if (!finite(config.min) || !finite(config.max) || Number(config.max) <= Number(config.min)) {
    issues.push('Gauge maximum must be greater than minimum');
    return issues;
  }
  if (config.low !== null && config.low !== '' && (!finite(config.low) || Number(config.low) < Number(config.min) || Number(config.low) >= Number(config.max))) {
    issues.push('Gauge low limit must be within the display range');
  }
  if (config.high !== null && config.high !== '' && (!finite(config.high) || Number(config.high) <= Number(config.min) || Number(config.high) > Number(config.max))) {
    issues.push('Gauge high limit must be within the display range');
  }
  if (finite(config.low) && finite(config.high) && Number(config.low) > Number(config.high)) {
    issues.push('Gauge low limit cannot exceed the high limit');
  }
  return issues;
}

function validateTimePlot(config) {
  const issues = [...validateDashboardIdentity(config)];
  if (!['shared', 'auto', 'window', 'fixed'].includes(config.xRangeMode)) {
    issues.push('Time-plot X range must use Dashboard view, Auto data extent, Trailing window, or Fixed bounds');
  }
  if (config.xRangeMode === 'window' && !positive(config.xWindowS)) {
    issues.push('Time-plot X window must be positive');
  }
  if (config.xRangeMode === 'fixed' && (!finite(config.xMinS) || !finite(config.xMaxS) || Number(config.xMaxS) <= Number(config.xMinS))) {
    issues.push('Time-plot X maximum must be greater than X minimum');
  }
  if (!['auto', 'manual'].includes(config.xTickMode)) issues.push('Time-plot X ticks must be Auto or Manual');
  if (config.xTickMode === 'manual' && !positive(config.xMajorStepS)) issues.push('Time-plot X major step must be positive');
  if (!['linear', 'log10'].includes(config.yAxisScale)) issues.push('Time-plot Y scale must be Linear or Log 10');
  if (!['auto', 'soft', 'fixed'].includes(config.yRangeMode)) {
    issues.push('Time-plot Y range must be Auto, Soft bounds, or Fixed bounds');
  }
  if (config.yRangeMode === 'fixed' && (!finite(config.yMin) || !finite(config.yMax) || Number(config.yMax) <= Number(config.yMin))) {
    issues.push('Time-plot Y maximum must be greater than Y minimum');
  }
  if (config.yAxisScale === 'log10' && config.yRangeMode === 'fixed' && finite(config.yMin) && Number(config.yMin) <= 0) {
    issues.push('Time-plot logarithmic Y minimum must be greater than zero');
  }
  if (config.yRangeMode === 'soft') {
    for (const [key, label] of [['ySoftMin', 'soft minimum'], ['ySoftMax', 'soft maximum']]) {
      if (config[key] !== null && config[key] !== '' && !finite(config[key])) issues.push(`Time-plot Y ${label} must be finite`);
      if (config.yAxisScale === 'log10' && finite(config[key]) && Number(config[key]) <= 0) {
        issues.push(`Time-plot logarithmic Y ${label} must be greater than zero`);
      }
    }
    if (finite(config.ySoftMin) && finite(config.ySoftMax) && Number(config.ySoftMax) <= Number(config.ySoftMin)) {
      issues.push('Time-plot Y soft maximum must be greater than soft minimum');
    }
  }
  if (!['auto', 'manual'].includes(config.yTickMode)) issues.push('Time-plot Y ticks must be Auto or Manual');
  if (config.yAxisScale === 'linear' && config.yTickMode === 'manual' && !positive(config.yMajorStep)) {
    issues.push('Time-plot Y major step must be positive');
  }
  if (typeof config.showGrid !== 'boolean') issues.push('Time-plot major grid must be on or off');
  if (typeof config.showMinorGrid !== 'boolean') issues.push('Time-plot minor grid must be on or off');
  return issues;
}

function currentConfig(defaults, config) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
    key,
    structuredClone(Object.hasOwn(config ?? {}, key) ? config[key] : fallback),
  ]));
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
