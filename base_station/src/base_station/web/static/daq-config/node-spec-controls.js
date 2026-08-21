export const ENGINEERING_UNITS = ['psi', 'kg', 'kg/s', 'N', 'lb', 'K', 'V', 'A', 'Ω', 'mV/V'];
export const GAUGE_TYPES = [
  ['dial-filled', 'Filled dial'],
  ['dial-needle', 'Needle dial'],
  ['meter-horizontal', 'Horizontal meter'],
  ['meter-vertical', 'Vertical meter'],
  ['meter-vertical-inverted', 'Vertical meter inverted'],
];

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

export function dashboardIdentityControls(config) {
  return [textControl('label', 'Label', config.label)];
}

export function gaugeControls(config) {
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

export function timePlotControls(config) {
  const controls = [
    ...dashboardIdentityControls(config),
    selectControl('xRangeMode', 'X range', config.xRangeMode, [
      ['shared', 'Dashboard view'], ['auto', 'Auto data extent'],
      ['window', 'Trailing window'], ['fixed', 'Fixed bounds'],
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
  controls.push(selectControl('xTickMode', 'X ticks', config.xTickMode, [['auto', 'Auto'], ['manual', 'Manual']]));
  if (config.xTickMode === 'manual') {
    controls.push(numberControl('xMajorStepS', 'X major step', config.xMajorStepS, 's', { min: 0.000001 }));
  }
  controls.push(
    textControl('xLabel', 'X label', config.xLabel),
    selectControl('yAxisScale', 'Y scale', config.yAxisScale, [['linear', 'Linear'], ['log10', 'Log 10']]),
    selectControl('yRangeMode', 'Y range', config.yRangeMode, [
      ['auto', 'Auto'], ['soft', 'Soft bounds'], ['fixed', 'Fixed bounds'],
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

export function option(value) {
  return [value, value];
}
