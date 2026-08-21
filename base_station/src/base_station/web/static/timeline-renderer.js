class TimelineRenderer {
  constructor(view) {
    this.view = view;
  }

  prepare(canvas) {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    return { context, width, height };
  }

  values(rows, channel) {
    const signalId = this.view.signals[channel]?.id;
    if (!signalId) return [];
    return rows.flatMap((row) => {
      const value = row.values?.[signalId];
      return value ? [value.min, value.max].filter(Number.isFinite) : [];
    });
  }

  drawChannel(canvas, rows, channel, range, rate) {
    const view = this.view;
    const { context, width, height } = this.prepare(canvas);
    const padding = { left: 54, right: 10, top: 12, bottom: 28 };
    const values = this.values(rows, channel);
    let minimum = values.length ? Math.min(...values) : -.1;
    let maximum = values.length ? Math.max(...values) : .1;
    const rawSpan = maximum - minimum;
    const extra = Math.max(rawSpan * .1, Math.abs(maximum) * 1e-6, 1e-9);
    minimum -= extra;
    maximum += extra;
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    context.strokeStyle = "rgba(20,32,28,.1)";
    context.fillStyle = "#596861";
    context.font = "9px ui-monospace, monospace";
    for (let line = 0; line <= 4; line += 1) {
      const y = padding.top + plotHeight * line / 4;
      context.textAlign = "right";
      context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke();
      context.fillText((maximum - (maximum - minimum) * line / 4).toFixed(5), padding.left - 7, y + 3);
      const x = padding.left + plotWidth * line / 4;
      const seconds = (range[0] + (range[1] - range[0]) * line / 4) / rate;
      context.textAlign = "center";
      context.beginPath(); context.moveTo(x, padding.top); context.lineTo(x, padding.top + plotHeight); context.stroke();
      context.fillText(`${seconds.toFixed((range[1] - range[0]) / rate < 10 ? 3 : 1)} s`, x, padding.top + plotHeight + 8);
    }
    if (!rows.length) return;
    const signal = view.signals[channel];
    if (!signal) return;
    const signalId = signal.id;
    const xAt = (row) => padding.left + plotWidth * (row.x - range[0]) / Math.max(1, range[1] - range[0]);
    const yAt = (value) => padding.top + plotHeight * (maximum - value) / (maximum - minimum);
    view.channelGeometry[channel] = { xAt, yAt, padding };
    context.strokeStyle = view.colors[channel % view.colors.length];
    context.globalAlpha = .3;
    context.beginPath();
    rows.forEach((row) => {
      const value = row.values?.[signalId];
      if (!value || !Number.isFinite(value.min) || !Number.isFinite(value.max)) return;
      context.moveTo(xAt(row), yAt(value.min)); context.lineTo(xAt(row), yAt(value.max));
    });
    context.stroke();
    context.globalAlpha = 1;
    context.lineWidth = 1.5;
    context.beginPath();
    let started = false;
    rows.forEach((row) => {
      const mean = row.values?.[signalId]?.mean;
      if (!Number.isFinite(mean)) { started = false; return; }
      const y = yAt(mean);
      if (!started) context.moveTo(xAt(row), y); else context.lineTo(xAt(row), y);
      started = true;
    });
    context.stroke();
    const unit = signal.unit ? ` ${signal.unit}` : "";
    if (view.rangeLabels?.[channel]) view.rangeLabels[channel].textContent = `${minimum.toFixed(5)} to ${maximum.toFixed(5)}${unit}`;
  }

  drawBand(context, width, height, rows) {
    const view = this.view;
    view.signals.forEach((signal, channel) => {
      const values = rows.map((row) => row.values?.[signal.id]?.mean).filter(Number.isFinite);
      if (!values.length) return;
      const sorted = [...values].sort((a, b) => a - b);
      const robust = sorted.length >= 50;
      const minimum = robust ? sorted[Math.floor((sorted.length - 1) * .01)] : sorted[0];
      const maximum = robust ? sorted[Math.ceil((sorted.length - 1) * .99)] : sorted.at(-1);
      const span = Math.max(maximum - minimum, Math.abs(maximum) * 1e-6, 1e-9);
      context.strokeStyle = view.colors[channel % view.colors.length];
      context.lineWidth = 1;
      context.beginPath();
      let started = false;
      rows.forEach((row, index) => {
        const x = width * index / Math.max(1, rows.length - 1);
        const value = row.values?.[signal.id]?.mean;
        if (!Number.isFinite(value)) { started = false; return; }
        const y = view.clamp(height - (value - minimum) / span * height, 0, height);
        if (!started) context.moveTo(x, y); else context.lineTo(x, y);
        started = true;
      });
      context.stroke();
    });
  }

  drawNavigator(tiers) {
    const view = this.view;
    const { context, width, height } = this.prepare(view.navigator);
    const bandHeight = height / 3;
    view.latestTiers = tiers;
    const settings = window.graphSettings.read();
    const selectedIndex = { full: 0, context: 1, detail: 2 }[settings.displayTier] ?? 2;
    tiers.forEach((tier, index) => {
      context.save(); context.beginPath(); context.rect(0, index * bandHeight, width, bandHeight); context.clip();
      context.translate(0, index * bandHeight); this.drawBand(context, width, bandHeight, tier.rows); context.restore();
      context.fillStyle = index === selectedIndex ? "#005ea8" : "#34413b";
      context.font = "800 8px ui-sans-serif, sans-serif";
      context.fillText(`${index === selectedIndex ? "● " : ""}${tier.name}`, 5, index * bandHeight + 12);
      if (index < 2) this.drawChildWindow(context, tiers, index, width, bandHeight);
    });
    this.drawPlayhead(context, view.center, width, bandHeight, "#006b57", false);
    if (view.hoverSample !== null) this.drawHoverProjection(context, settings, selectedIndex, width, bandHeight);
  }

  drawChildWindow(context, tiers, index, width, bandHeight) {
    const range = this.view.ranges[index];
    const child = tiers[index + 1];
    context.fillStyle = "rgba(0,107,87,.12)";
    context.fillRect(
      width * (child.start - range[0]) / Math.max(1, range[1] - range[0]),
      index * bandHeight,
      Math.max(2, width * (child.end - child.start) / Math.max(1, range[1] - range[0])),
      bandHeight,
    );
  }

  drawHoverProjection(context, settings, selectedIndex, width, bandHeight) {
    const view = this.view;
    const start = view.metadata.start || 0;
    const end = view.metadata.total;
    const candidateRanges = [
      [start, end],
      view.rangeAt(Math.max(2, Math.round(settings.contextSeconds * view.metadata.rate)), start, end, view.hoverSample),
      view.rangeAt(Math.max(2, Math.round(settings.detailSeconds * view.metadata.rate)), start, end, view.hoverSample),
    ];
    this.drawProjectedWindow(context, candidateRanges[selectedIndex], selectedIndex, width, bandHeight, "rgba(138,75,0,.12)", "#8a4b00", true);
    this.drawPlayhead(context, view.hoverSample, width, bandHeight, "#8a4b00", true);
  }

  drawProjectedWindow(context, selected, selectedIndex, width, bandHeight, fill, stroke, dashed = false) {
    this.view.ranges.slice(0, selectedIndex + 1).forEach((tier, index) => {
      const start = Math.max(selected[0], tier[0]);
      const end = Math.min(selected[1], tier[1]);
      if (end < start) return;
      const x = width * (start - tier[0]) / Math.max(1, tier[1] - tier[0]);
      const w = width * (end - start) / Math.max(1, tier[1] - tier[0]);
      context.fillStyle = fill; context.fillRect(x, index * bandHeight, Math.max(2, w), bandHeight);
      context.strokeStyle = stroke; context.lineWidth = index === selectedIndex ? 2 : 1;
      context.setLineDash(dashed ? [4, 3] : []);
      context.strokeRect(x + .5, index * bandHeight + .5, Math.max(1, w - 1), bandHeight - 1);
      context.setLineDash([]);
    });
  }

  drawPlayhead(context, sample, width, bandHeight, color, dashed) {
    this.view.ranges.forEach((range, index) => {
      if (sample < range[0] || sample > range[1]) return;
      const x = width * (sample - range[0]) / Math.max(1, range[1] - range[0]);
      context.strokeStyle = color; context.lineWidth = 1.5; context.setLineDash(dashed ? [3, 3] : []);
      context.beginPath(); context.moveTo(x, index * bandHeight); context.lineTo(x, (index + 1) * bandHeight); context.stroke(); context.setLineDash([]);
    });
  }
}
