class TimelineInspector {
  constructor(view) {
    this.view = view; this.drag = null;
    this.stats = document.createElement("output"); this.stats.className = "timeline-selection-stats"; this.stats.hidden = true;
    view.navigator.parentElement.append(this.stats);
    this.overlays = view.canvases.map((canvas, channel) => {
      const parent = canvas.parentElement; parent.classList.add("inspectable-chart");
      const point = document.createElement("output"); point.className = "chart-point-tooltip"; point.hidden = true;
      const hoverLine = document.createElement("i"); hoverLine.className = "chart-hover-line"; hoverLine.hidden = true;
      const selection = document.createElement("i"); selection.className = "chart-selection"; selection.hidden = true;
      parent.append(hoverLine, selection, point);
      canvas.addEventListener("pointermove", (event) => this.move(event, channel));
      canvas.addEventListener("pointerleave", () => { if (!this.drag) { point.hidden = true; hoverLine.hidden = true; } });
      canvas.addEventListener("pointerdown", (event) => this.start(event, channel));
      canvas.addEventListener("pointerup", (event) => this.finish(event, channel));
      canvas.addEventListener("pointercancel", (event) => this.finish(event, channel));
      return { point, hoverLine, selection };
    });
  }

  update(rows, range, metadata) {
    this.rows = rows; this.range = range; this.metadata = metadata;
    if (this.drag) this.showSelection(this.drag.channel, this.drag.start, this.drag.current);
  }

  plotX(event, canvas) {
    const bounds = canvas.getBoundingClientRect();
    return Math.max(54, Math.min(bounds.width - 10, event.clientX - bounds.left));
  }

  sampleAt(pixel, canvas) {
    const fraction = (pixel - 54) / Math.max(1, canvas.clientWidth - 64);
    return this.range[0] + fraction * (this.range[1] - this.range[0]);
  }

  closest(sample) {
    if (!this.rows?.length) return null;
    let low = 0; let high = this.rows.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.rows[middle].x < sample) low = middle + 1; else high = middle;
    }
    const before = this.rows[Math.max(0, low - 1)]; const after = this.rows[low];
    return Math.abs(before.x - sample) <= Math.abs(after.x - sample) ? before : after;
  }

  fields(channel) { return channel === 0 ? ["aMin", "aMax", "aMean"] : ["bMin", "bMax", "bMean"]; }

  move(event, channel) {
    if (!this.rows || this.drag && this.drag.channel !== channel) return;
    const canvas = this.view.canvases[channel]; const pixel = this.plotX(event, canvas);
    if (this.drag) { this.drag.current = pixel; this.showSelection(channel, this.drag.start, pixel); return; }
    const row = this.closest(this.sampleAt(pixel, canvas)); if (!row) return;
    const [low, high, mean] = this.fields(channel);
    const overlay = this.overlays[channel]; const rangeText = row[low] === row[high] ? "" : ` · ${row[low].toFixed(6)}–${row[high].toFixed(6)} V`;
    const snappedX = this.view.channelGeometry[channel].xAt(row);
    overlay.point.textContent = `${(row.x / this.metadata.rate).toFixed(3)} s · ${row[mean].toFixed(6)} V${rangeText}`;
    overlay.point.style.left = `${canvas.offsetLeft + snappedX}px`;
    overlay.point.style.top = `${canvas.offsetTop + 12}px`; overlay.point.hidden = false;
    overlay.hoverLine.style.left = `${canvas.offsetLeft + snappedX}px`; overlay.hoverLine.style.top = `${canvas.offsetTop + 12}px`;
    overlay.hoverLine.style.height = `${canvas.clientHeight - 40}px`; overlay.hoverLine.hidden = false;
  }

  start(event, channel) {
    const canvas = this.view.canvases[channel]; canvas.setPointerCapture(event.pointerId);
    const start = this.plotX(event, canvas); this.drag = { channel, start, current: start, zoom: event.shiftKey };
    this.overlays[channel].selection.classList.toggle("zoom", this.drag.zoom);
    this.overlays[channel].point.hidden = true; this.overlays[channel].hoverLine.hidden = true;
    this.showSelection(channel, this.drag.start, this.drag.start);
  }

  percentile(sorted, fraction) { return sorted[Math.round((sorted.length - 1) * fraction)]; }

  showSelection(channel, first, last) {
    const canvas = this.view.canvases[channel]; const overlay = this.overlays[channel];
    const left = Math.min(first, last); const right = Math.max(first, last);
    overlay.selection.style.left = `${canvas.offsetLeft + left}px`; overlay.selection.style.width = `${Math.max(1, right - left)}px`;
    overlay.selection.style.top = `${canvas.offsetTop + 12}px`; overlay.selection.style.height = `${canvas.clientHeight - 40}px`; overlay.selection.hidden = false;
    const start = this.sampleAt(left, canvas); const end = this.sampleAt(right, canvas); const [low, high, meanField] = this.fields(channel);
    const selected = this.rows.filter((row) => row.x >= start && row.x <= end);
    if (this.drag?.zoom) {
      this.stats.innerHTML = `<b>ZOOM TO CONTEXT · ${(start / this.metadata.rate).toFixed(3)}–${(end / this.metadata.rate).toFixed(3)} s</b><span>Release Shift-drag to inspect this interval.</span>`;
      this.stats.hidden = false; return;
    }
    const values = selected.map((row) => row[meanField]);
    if (!values.length) { this.stats.hidden = true; return; }
    const minimum = Math.min(...values); const maximum = Math.max(...values);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b); const q1 = this.percentile(sorted, .25); const q3 = this.percentile(sorted, .75);
    const lowerFence = q1 - 1.5 * (q3 - q1); const upperFence = q3 + 1.5 * (q3 - q1);
    const anomalies = selected.filter((row) => row[meanField] < lowerFence || row[meanField] > upperFence);
    this.view.drawChannel(canvas, this.rows, channel, this.range, this.metadata.rate);
    const context = canvas.getContext("2d"); const geometry = this.view.channelGeometry[channel];
    context.fillStyle = "#a52218";
    anomalies.forEach((row) => { context.beginPath(); context.arc(geometry.xAt(row), geometry.yAt(row[meanField]), 2.5, 0, Math.PI * 2); context.fill(); });
    const channelName = channel === 0 ? "AIN0 − AIN1" : "AIN2 − AIN3";
    this.stats.innerHTML = `<b>${channelName} · ${(start / this.metadata.rate).toFixed(3)}–${(end / this.metadata.rate).toFixed(3)} s</b><span>n ${values.length} · min ${minimum.toPrecision(5)} · max ${maximum.toPrecision(5)} V</span><span>mean ${mean.toPrecision(5)} V · variance ${variance.toExponential(3)} V² · Tukey anomalies ${anomalies.length}</span>`;
    this.stats.hidden = false;
  }

  finish(event, channel) {
    if (!this.drag || this.drag.channel !== channel) return;
    const drag = this.drag; const canvas = this.view.canvases[channel];
    const start = this.sampleAt(Math.min(drag.start, drag.current), canvas);
    const end = this.sampleAt(Math.max(drag.start, drag.current), canvas);
    const shouldZoom = drag.zoom && Math.abs(drag.current - drag.start) >= 5;
    this.drag = null; const overlay = this.overlays[channel]; overlay.selection.hidden = true; overlay.selection.classList.remove("zoom"); this.stats.hidden = true;
    this.view.drawChannel(this.view.canvases[channel], this.rows, channel, this.range, this.metadata.rate);
    if (shouldZoom) this.view.zoomToContext(start, end);
  }
}
