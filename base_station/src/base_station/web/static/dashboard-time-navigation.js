import { clamp, formatTime } from './dashboard-time-utils.js';

const TIERS = ['full', 'context', 'detail'];

export class DashboardTimeNavigation {
  constructor(controller) {
    this.controller = controller;
    const navigator = controller.navigator;
    navigator.addEventListener('pointerdown', (event) => this.start(event));
    navigator.addEventListener('pointermove', (event) => this.move(event));
    navigator.addEventListener('pointerup', (event) => this.stop(event));
    navigator.addEventListener('pointercancel', (event) => this.cancel(event));
    navigator.addEventListener('pointerleave', () => this.leave());
    controller.returnTail.addEventListener('click', () => this.followTail());
  }

  position(event) {
    const navigator = this.controller.navigator;
    const bounds = navigator.getBoundingClientRect();
    const bandHeight = bounds.height / 3;
    const index = clamp(Math.floor((event.clientY - bounds.top) / Math.max(1, bandHeight)), 0, 2);
    const fraction = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    return { bounds, bandHeight, index, fraction };
  }

  start(event) {
    const controller = this.controller;
    const { bounds, bandHeight, index, fraction } = this.position(event);
    const range = [...(controller.ranges[index] ?? controller.bounds())];
    controller.navigatorDrag = {
      pointerId: event.pointerId,
      index,
      range,
      bounds,
      bandHeight,
      startClientX: event.clientX,
      moved: false,
    };
    controller.navigator.setPointerCapture(event.pointerId);
    this.updateInspection(index, this.timeAtFraction(range, fraction), fraction, bounds, bandHeight);
  }

  move(event) {
    if (this.controller.navigator.hasPointerCapture(event.pointerId)) this.scrub(event);
    else this.preview(event);
  }

  stop(event) {
    const controller = this.controller;
    const drag = controller.navigatorDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const fraction = this.fraction(event.clientX, drag.bounds);
    const time = this.timeAtFraction(drag.range, fraction);
    if (controller.navigator.hasPointerCapture(event.pointerId)) controller.navigator.releasePointerCapture(event.pointerId);
    controller.navigatorDrag = null;
    if (!drag.moved) {
      controller.selectedTier = TIERS[drag.index];
      controller.onTierChange?.(controller.selectedTier);
      controller.center = time;
      controller.following = false;
      controller.selectedRange = null;
    }
    const inside = event.clientX >= drag.bounds.left && event.clientX <= drag.bounds.right
      && event.clientY >= drag.bounds.top && event.clientY <= drag.bounds.bottom;
    controller.navigatorHover = inside ? { index: drag.index, time } : null;
    controller.tooltip.hidden = !inside;
    controller.render();
  }

  cancel(event) {
    const controller = this.controller;
    const drag = controller.navigatorDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (controller.navigator.hasPointerCapture(event.pointerId)) controller.navigator.releasePointerCapture(event.pointerId);
    controller.navigatorDrag = null;
    controller.navigatorHover = null;
    controller.tooltip.hidden = true;
    controller.render();
  }

  leave() {
    const controller = this.controller;
    if (controller.navigatorDrag) return;
    controller.navigatorHover = null;
    controller.tooltip.hidden = true;
    controller.renderer.renderNavigator(controller.renderState());
  }

  scrub(event) {
    const controller = this.controller;
    const drag = controller.navigatorDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.moved ||= Math.abs(event.clientX - drag.startClientX) >= 4;
    const fraction = this.fraction(event.clientX, drag.bounds);
    const time = this.timeAtFraction(drag.range, fraction);
    if (drag.moved) {
      controller.center = time;
      controller.following = false;
      controller.selectedRange = null;
    }
    this.updateInspection(drag.index, time, fraction, drag.bounds, drag.bandHeight, drag.moved);
  }

  preview(event) {
    const controller = this.controller;
    const { bounds, bandHeight, index, fraction } = this.position(event);
    const range = controller.ranges[index] ?? controller.bounds();
    const time = this.timeAtFraction(range, fraction);
    this.updateInspection(index, time, fraction, bounds, bandHeight);
  }

  updateInspection(index, time, fraction, bounds, bandHeight, renderAll = false) {
    const controller = this.controller;
    controller.navigatorHover = { index, time };
    controller.tooltip.textContent = formatTime(time);
    controller.tooltip.style.left = `${fraction * bounds.width}px`;
    controller.tooltip.style.top = `${(index + 0.5) * bandHeight}px`;
    controller.tooltip.hidden = false;
    if (renderAll) controller.render();
    else controller.renderer.renderNavigator(controller.renderState());
  }

  fraction(clientX, bounds) {
    return clamp((clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
  }

  timeAtFraction(range, fraction) {
    return range[0] + fraction * (range[1] - range[0]);
  }

  followTail() {
    const controller = this.controller;
    controller.following = true;
    controller.center = controller.bounds()[1];
    controller.selectedRange = null;
    controller.render();
  }
}
