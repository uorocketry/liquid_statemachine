import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectWorldBounds,
  projectedItemBounds,
  projectionForView,
} from '../src/base_station/web/static/dashboard-view-projection.js';
import {
  DASHBOARD_VIEW_SNAP,
  itemWorldBounds,
  setView,
  viewFromGridPoints,
} from '../src/base_station/web/static/dashboard-layout-model.js';

const metrics = {
  columnWidth: 100,
  columnStep: 110,
  gap: 10,
  rowHeight: 50,
  rowStep: 60,
};
const viewport = { width: 1600, height: 900 };
const item = { x: 8, y: 5, w: 4, h: 4 };
const world = itemWorldBounds(item, metrics);

test('a view drawn on the real widget edges fills the viewport exactly', () => {
  const view = {
    x: world.x / metrics.columnStep,
    y: world.y / metrics.rowStep,
    w: world.width / metrics.columnStep,
    h: world.height / metrics.rowStep,
  };
  assert.deepEqual(projectedItemBounds(item, view, metrics, viewport), {
    x: 0,
    y: 0,
    width: 1600,
    height: 900,
  });
});

test('a view drawn over the left half makes the widget two viewports wide', () => {
  const view = {
    x: world.x / metrics.columnStep,
    y: world.y / metrics.rowStep,
    w: world.width / 2 / metrics.columnStep,
    h: world.height / metrics.rowStep,
  };
  assert.deepEqual(projectedItemBounds(item, view, metrics, viewport), {
    x: 0,
    y: 0,
    width: 3200,
    height: 900,
  });
});

test('projection changes box origin and dimensions rather than rendering a transform', () => {
  const projection = projectionForView(
    { x: 2, y: 1, w: 4, h: 2 },
    metrics,
    viewport,
  );
  assert.deepEqual(
    projectWorldBounds({ x: 330, y: 90, width: 220, height: 60 }, projection),
    { x: 400, y: 225, width: 800, height: 450 },
  );
});

test('authored view rectangles snap to the visible quarter-cell grid', () => {
  assert.equal(DASHBOARD_VIEW_SNAP, 0.25);
  const layout = { items: {}, views: {} };
  setView(layout, '1', { x: 1.13, y: -0.36, w: 3.62, h: 2.14 });
  assert.deepEqual(layout.views['1'], { x: 1.25, y: -0.25, w: 3.5, h: 2.25 });
  assert.deepEqual(
    viewFromGridPoints({ x: 1.12, y: 2.13 }, { x: 4.61, y: 5.88 }),
    { x: 1.12, y: 2.13, w: 3.5, h: 3.75 },
  );
});
