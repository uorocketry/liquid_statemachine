class TimelineView {
  constructor(options) {
    Object.assign(this, options);
    this.center = 0;
    this.following = true;
    this.playing = false;
    this.requestSequence = 0;
    this.frame = 0;
    this.previousFrameTime = 0;
    this.previousRefreshTime = 0;
    this.ranges = [];
    this.colors = ["#007c69", "#5c7f18"];
    this.channelGeometry = [];
    this.hover = document.createElement("output"); this.hover.className = "timeline-hover"; this.hover.hidden = true;
    this.hoverSample = null; this.navigator.parentElement.append(this.hover);
    this.navigator.addEventListener("pointerdown", (event) => {
      this.navigator.setPointerCapture(event.pointerId); this.navigate(event);
    });
    this.navigator.addEventListener("pointermove", (event) => {
      if (this.navigator.hasPointerCapture(event.pointerId)) this.navigate(event); else this.preview(event);
    });
    this.navigator.addEventListener("pointerleave", () => {
      this.hover.hidden = true; this.hoverSample = null;
      if (this.latestTiers) this.drawNavigator(this.latestTiers);
    });
    this.playButton.addEventListener("click", () => this.togglePlayback());
    this.tailButton.addEventListener("click", () => this.returnToTail());
    window.addEventListener("resize", () => this.refresh());
    window.addEventListener("graph-settings-change", () => {
      this.source.invalidate?.(); this.refresh();
    });
    this.inspector = new TimelineInspector(this);
  }

  clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }

  rangeAt(size, start, end, center = this.center) {
    const width = Math.min(size, end - start);
    const rangeStart = Math.round(this.clamp(center - width / 2, start, end - width));
    return [rangeStart, Math.min(end, rangeStart + width)];
  }

  buildRanges(settings, metadata) {
    const start = metadata.start || 0; const end = metadata.total;
    if (this.following) this.center = end;
    this.center = this.clamp(this.center || end, start, end);
    return [
      [start, end],
      this.rangeAt(Math.max(2, Math.round(settings.contextSeconds * metadata.rate)), start, end),
      this.rangeAt(Math.max(2, Math.round(settings.detailSeconds * metadata.rate)), start, end),
    ];
  }

  prepare(canvas) {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth; const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
    return { context, width, height };
  }

  values(rows, channel) {
    const low = channel === 0 ? "aMin" : "bMin"; const high = channel === 0 ? "aMax" : "bMax";
    return rows.flatMap((row) => [row[low], row[high]]);
  }

  filterRows(rows, settings, rate) {
    if (settings.filterMode === "raw" || !rows.length) return rows;
    const result = rows.map((row) => ({ ...row }));
    if (settings.filterMode === "moving_average") {
      const target = Math.max(1, settings.movingAverageMs * rate / 1000);
      const queue = []; let count = 0; let sumA = 0; let sumB = 0;
      result.forEach((row) => {
        const weight = row.count || Math.max(1, row.sampleEnd - row.x);
        queue.push({ weight, a: row.aMean, b: row.bMean }); count += weight;
        sumA += row.aMean * weight; sumB += row.bMean * weight;
        while (queue.length > 1 && count - queue[0].weight >= target) {
          const removed = queue.shift(); count -= removed.weight;
          sumA -= removed.a * removed.weight; sumB -= removed.b * removed.weight;
        }
        row.aMean = sumA / count; row.bMean = sumB / count;
      });
    } else {
      const tau = Math.max(.001, settings.emaTimeConstantMs / 1000);
      let a = result[0].aMean; let b = result[0].bMean;
      result.forEach((row, index) => {
        if (index) {
          const duration = (row.count || Math.max(1, row.sampleEnd - row.x)) / rate;
          const alpha = 1 - Math.exp(-duration / tau);
          a += alpha * (row.aMean - a); b += alpha * (row.bMean - b);
        }
        row.aMean = a; row.bMean = b;
      });
    }
    return result;
  }

  drawChannel(canvas, rows, channel, range, rate) {
    const { context, width, height } = this.prepare(canvas);
    const padding = { left: 54, right: 10, top: 12, bottom: 28 };
    const values = this.values(rows, channel);
    let minimum = values.length ? Math.min(...values) : -.1;
    let maximum = values.length ? Math.max(...values) : .1;
    const rawSpan = maximum - minimum;
    const extra = Math.max(rawSpan * .1, Math.abs(maximum) * 1e-6, 1e-9);
    minimum -= extra; maximum += extra;
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    context.strokeStyle = "rgba(20,32,28,.1)"; context.fillStyle = "#596861";
    context.font = "9px ui-monospace, monospace";
    for (let line = 0; line <= 4; line += 1) {
      const y = padding.top + plotHeight * line / 4;
      context.textAlign = "right"; context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke();
      context.fillText((maximum - (maximum - minimum) * line / 4).toFixed(5), padding.left - 7, y + 3);
      const x = padding.left + plotWidth * line / 4;
      const seconds = (range[0] + (range[1] - range[0]) * line / 4) / rate;
      context.textAlign = "center"; context.beginPath(); context.moveTo(x, padding.top); context.lineTo(x, padding.top + plotHeight); context.stroke();
      context.fillText(`${seconds.toFixed((range[1] - range[0]) / rate < 10 ? 3 : 1)} s`, x, padding.top + plotHeight + 8);
    }
    if (!rows.length) return;
    const low = channel === 0 ? "aMin" : "bMin"; const high = channel === 0 ? "aMax" : "bMax";
    const xAt = (row) => padding.left + plotWidth * (row.x - range[0]) / Math.max(1, range[1] - range[0]);
    const yAt = (value) => padding.top + plotHeight * (maximum - value) / (maximum - minimum);
    this.channelGeometry[channel] = { xAt, yAt, padding };
    context.strokeStyle = this.colors[channel]; context.globalAlpha = .3; context.beginPath();
    rows.forEach((row) => { context.moveTo(xAt(row), yAt(row[low])); context.lineTo(xAt(row), yAt(row[high])); });
    context.stroke(); context.globalAlpha = 1; context.lineWidth = 1.5; context.beginPath();
    const mean = channel === 0 ? "aMean" : "bMean";
    rows.forEach((row, index) => { const y = yAt(row[mean]); if (!index) context.moveTo(xAt(row), y); else context.lineTo(xAt(row), y); });
    context.stroke();
    if (this.rangeLabels?.[channel]) this.rangeLabels[channel].textContent = `${minimum.toFixed(5)} to ${maximum.toFixed(5)} V`;
  }

  drawBand(context, width, height, rows) {
    const selection = window.graphSettings.read().navigatorChannels;
    const channelIndices = selection === "a" ? [0] : selection === "b" ? [1] : [0, 1];
    const values = channelIndices.flatMap((channel) => rows.map((row) => channel === 0 ? row.aMean : row.bMean)); if (!values.length) return;
    const sorted = [...values].sort((a, b) => a - b);
    const robust = sorted.length >= 50;
    const minimum = robust ? sorted[Math.floor((sorted.length - 1) * .01)] : sorted[0];
    const maximum = robust ? sorted[Math.ceil((sorted.length - 1) * .99)] : sorted.at(-1);
    const span = Math.max(maximum - minimum, Math.abs(maximum) * 1e-6, 1e-9);
    channelIndices.forEach((channel) => {
      const color = this.colors[channel];
      const mean = channel === 0 ? "aMean" : "bMean";
      context.strokeStyle = color; context.lineWidth = 1; context.beginPath();
      rows.forEach((row, index) => {
        const x = width * index / Math.max(1, rows.length - 1); const value = row[mean];
        const y = this.clamp(height - (value - minimum) / span * height, 0, height);
        if (!index) context.moveTo(x, y); else context.lineTo(x, y);
      }); context.stroke();
    });
  }

  drawNavigator(tiers) {
    const { context, width, height } = this.prepare(this.navigator); const bandHeight = height / 3;
    this.latestTiers = tiers;
    const settings = window.graphSettings.read();
    const selectedIndex = { full: 0, context: 1, detail: 2 }[settings.displayTier] ?? 2;
    tiers.forEach((tier, index) => {
      context.save(); context.beginPath(); context.rect(0, index * bandHeight, width, bandHeight); context.clip();
      context.translate(0, index * bandHeight); this.drawBand(context, width, bandHeight, tier.rows); context.restore();
      context.fillStyle = index === selectedIndex ? "#005ea8" : "#34413b";
      context.font = "800 8px ui-sans-serif, sans-serif";
      context.fillText(`${index === selectedIndex ? "● " : ""}${tier.name}`, 5, index * bandHeight + 12);
      if (index < 2) {
        const child = tiers[index + 1]; const range = this.ranges[index];
        context.fillStyle = "rgba(0,107,87,.12)";
        context.fillRect(width * (child.start - range[0]) / Math.max(1, range[1] - range[0]), index * bandHeight,
          Math.max(2, width * (child.end - child.start) / Math.max(1, range[1] - range[0])), bandHeight);
      }
    });
    this.drawPlayhead(context, this.center, width, bandHeight, "#006b57", false);
    if (this.hoverSample !== null) {
      const start = this.metadata.start || 0; const end = this.metadata.total;
      const candidateRanges = [
        [start, end],
        this.rangeAt(Math.max(2, Math.round(settings.contextSeconds * this.metadata.rate)), start, end, this.hoverSample),
        this.rangeAt(Math.max(2, Math.round(settings.detailSeconds * this.metadata.rate)), start, end, this.hoverSample),
      ];
      this.drawProjectedWindow(context, candidateRanges[selectedIndex], selectedIndex, width, bandHeight, "rgba(138,75,0,.12)", "#8a4b00", true);
      this.drawPlayhead(context, this.hoverSample, width, bandHeight, "#8a4b00", true);
    }
  }

  drawProjectedWindow(context, selected, selectedIndex, width, bandHeight, fill, stroke, dashed = false) {
    this.ranges.slice(0, selectedIndex + 1).forEach((tier, index) => {
      const start = Math.max(selected[0], tier[0]); const end = Math.min(selected[1], tier[1]);
      if (end < start) return;
      const x = width * (start - tier[0]) / Math.max(1, tier[1] - tier[0]);
      const w = width * (end - start) / Math.max(1, tier[1] - tier[0]);
      context.fillStyle = fill; context.fillRect(x, index * bandHeight, Math.max(2, w), bandHeight);
      context.strokeStyle = stroke; context.lineWidth = index === selectedIndex ? 2 : 1;
      context.setLineDash(dashed ? [4, 3] : []); context.strokeRect(x + .5, index * bandHeight + .5, Math.max(1, w - 1), bandHeight - 1);
      context.setLineDash([]);
    });
  }

  drawPlayhead(context, sample, width, bandHeight, color, dashed) {
    this.ranges.forEach((range, index) => {
      if (sample < range[0] || sample > range[1]) return;
      const x = width * (sample - range[0]) / Math.max(1, range[1] - range[0]);
      context.strokeStyle = color; context.lineWidth = 1.5; context.setLineDash(dashed ? [3, 3] : []);
      context.beginPath(); context.moveTo(x, index * bandHeight); context.lineTo(x, (index + 1) * bandHeight); context.stroke(); context.setLineDash([]);
    });
  }

  async refresh() {
    const sequence = ++this.requestSequence; const settings = window.graphSettings.read();
    try {
      const metadata = await this.source.metadata(this.following);
      this.metadata = metadata; this.ranges = this.buildRanges(settings, metadata);
      const sourceRows = await this.source.samples(this.ranges);
      if (sequence !== this.requestSequence) return;
      const rows = sourceRows.map((tierRows) => this.filterRows(tierRows, settings, metadata.rate));
      const durationName = (range, requested) => {
        const actual = (range[1] - range[0]) / metadata.rate;
        const target = Number(requested.toFixed(2));
        return actual + .001 < requested ? `${Number(actual.toFixed(1))} / ${target} s` : `${target} s`;
      };
      const names = ["FULL", durationName(this.ranges[1], settings.contextSeconds), durationName(this.ranges[2], settings.detailSeconds)];
      const tiers = rows.map((tierRows, index) => ({ name: names[index], start: this.ranges[index][0], end: this.ranges[index][1], rows: tierRows }));
      const selectedIndex = { full: 0, context: 1, detail: 2 }[settings.displayTier] ?? 2;
      this.canvases.forEach((canvas, channel) => this.drawChannel(canvas, rows[selectedIndex], channel, this.ranges[selectedIndex], metadata.rate));
      this.inspector.update(rows[selectedIndex], this.ranges[selectedIndex], metadata);
      this.drawNavigator(tiers); this.source.updateMetadata?.(metadata);
      if (this.label) this.label.textContent = `${(this.ranges[selectedIndex][0] / metadata.rate).toFixed(3)}–${(this.ranges[selectedIndex][1] / metadata.rate).toFixed(3)} s`;
    } catch (error) { if (this.label) this.label.textContent = error.message; }
  }

  navigate(event) {
    this.stopPlayback(); this.following = false; this.hoverSample = null; this.hover.hidden = true;
    const bounds = this.navigator.getBoundingClientRect();
    const index = this.clamp(Math.floor((event.clientY - bounds.top) / (bounds.height / 3)), 0, 2);
    const range = this.ranges[index]; const fraction = this.clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    this.center = range[0] + fraction * (range[1] - range[0]); this.updateButtons(); this.refresh();
  }

  zoomToContext(start, end) {
    const low = Math.min(start, end); const high = Math.max(start, end);
    if (!this.metadata || high <= low) return;
    this.stopPlayback(); this.following = false;
    this.center = (low + high) / 2;
    window.graphSettings.setContext((high - low) / this.metadata.rate);
    this.source.invalidate?.(); this.updateButtons(); this.refresh();
  }

  preview(event) {
    if (!this.metadata || !this.ranges.length) return;
    const bounds = this.navigator.getBoundingClientRect();
    const index = this.clamp(Math.floor((event.clientY - bounds.top) / (bounds.height / 3)), 0, 2);
    const fraction = this.clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const range = this.ranges[index]; const sample = range[0] + fraction * (range[1] - range[0]);
    const names = this.latestTiers?.map((tier) => tier.name) || ["FULL", "Context", "Detail"];
    const x = fraction * bounds.width; const y = (index + .5) * bounds.height / 3;
    this.hover.textContent = `${names[index]} · ${(sample / this.metadata.rate).toFixed(3)} s`;
    this.hover.style.left = `${x}px`; this.hover.style.top = `${y}px`; this.hover.hidden = false;
    this.hoverSample = sample; if (this.latestTiers) this.drawNavigator(this.latestTiers);
  }

  stopPlayback() { this.playing = false; this.previousFrameTime = 0; cancelAnimationFrame(this.frame); this.updateButtons(); }

  togglePlayback() {
    if (this.following) { this.following = false; this.updateButtons(); return; }
    if (this.playing) { this.stopPlayback(); return; }
    if (this.source.liveTail && this.center >= this.metadata.total) {
      this.following = true; this.source.invalidate?.(); this.updateButtons(); this.refresh(); return;
    }
    if (this.center >= this.metadata.total) this.center = this.metadata.start || 0;
    this.playing = true; this.updateButtons(); this.frame = requestAnimationFrame((time) => this.playback(time));
  }

  playback(timestamp) {
    if (!this.playing) return; if (!this.previousFrameTime) this.previousFrameTime = timestamp;
    this.center += (timestamp - this.previousFrameTime) * this.metadata.rate / 1000; this.previousFrameTime = timestamp;
    if (this.center >= this.metadata.total) { this.center = this.metadata.total; this.stopPlayback(); this.refresh(); return; }
    if (timestamp - this.previousRefreshTime > 120) { this.previousRefreshTime = timestamp; this.refresh(); }
    this.frame = requestAnimationFrame((time) => this.playback(time));
  }

  returnToTail() {
    this.stopPlayback(); this.center = this.metadata?.total || 0;
    this.following = Boolean(this.source.liveTail || this.metadata?.status === "recording");
    this.source.invalidate?.(); this.updateButtons(); this.refresh();
  }

  updateButtons() {
    this.playButton.textContent = this.following || this.playing ? "Ⅱ Pause" : "▶ Play";
    this.tailButton.textContent = this.following ? "Following live" : (this.metadata?.status === "recording" ? "Return to live" : "Go to end");
  }

  async pollPausedMetadata() {
    try {
      this.metadata = await this.source.metadata(false);
      this.source.updateMetadata?.(this.metadata); this.updateButtons();
    } catch (_) { /* The next regular refresh reports connection errors. */ }
  }

  start() {
    this.refresh(); this.updateButtons();
    this.poller = setInterval(() => {
      if (this.playing) return;
      if (this.following) this.refresh();
      else if (this.source.pollWhenPaused) this.pollPausedMetadata();
    }, this.pollInterval || 750);
  }
}

async function loadRunTimelineSamples(runId, ranges) {
  return Promise.all(ranges.map(async ([start, end], index) => {
    const query = new URLSearchParams();
    query.set("start", start); query.set("end", end); query.set("points", index === 2 ? 900 : 500);
    const response = await fetch(`/api/runs/${runId}/samples?${query}`);
    if (!response.ok) throw new Error("Unable to load recorded samples");
    return (await response.json()).samples.map((row) => ({
      x: row.sample_index, sampleEnd: row.sample_end, count: row.sample_count,
      aMin: row.a_min, aMax: row.a_max, aMean: row.a_mean,
      bMin: row.b_min, bMax: row.b_max, bMean: row.b_mean,
    }));
  }));
}
