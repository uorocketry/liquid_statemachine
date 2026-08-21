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
    this.signals = this.signals ?? [];
    this.colors = ["#007c69", "#5c7f18", "#6b5c9a", "#8a5d16", "#1f6f8b", "#8b4f6f"];
    this.channelGeometry = [];
    this.renderer = new TimelineRenderer(this);
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
      if (this.latestTiers) this.renderer.drawNavigator(this.latestTiers);
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

  filterRows(rows, settings, rate) {
    if (settings.filterMode === "raw" || !rows.length) return rows;
    const result = rows.map((row) => ({
      ...row,
      values: Object.fromEntries(Object.entries(row.values ?? {}).map(([id, value]) => [id, { ...value }])),
    }));
    this.signals.forEach((signal) => this.filterSignal(result, signal.id, settings, rate));
    return result;
  }

  filterSignal(rows, signalId, settings, rate) {
    const validRows = rows.filter((row) => Number.isFinite(row.values?.[signalId]?.mean));
    if (!validRows.length) return;
    if (settings.filterMode === "moving_average") {
      const target = Math.max(1, settings.movingAverageMs * rate / 1000);
      const queue = []; let count = 0; let sum = 0;
      validRows.forEach((row) => {
        const weight = row.count || Math.max(1, row.sampleEnd - row.x);
        const mean = row.values[signalId].mean;
        queue.push({ weight, mean }); count += weight; sum += mean * weight;
        while (queue.length > 1 && count - queue[0].weight >= target) {
          const removed = queue.shift(); count -= removed.weight; sum -= removed.mean * removed.weight;
        }
        row.values[signalId].mean = sum / count;
      });
      return;
    }
    const tau = Math.max(.001, settings.emaTimeConstantMs / 1000);
    let mean = validRows[0].values[signalId].mean;
    validRows.forEach((row, index) => {
      if (index) {
        const duration = (row.count || Math.max(1, row.sampleEnd - row.x)) / rate;
        const alpha = 1 - Math.exp(-duration / tau);
        mean += alpha * (row.values[signalId].mean - mean);
      }
      row.values[signalId].mean = mean;
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
      this.canvases.forEach((canvas, channel) => this.renderer.drawChannel(canvas, rows[selectedIndex], channel, this.ranges[selectedIndex], metadata.rate));
      this.inspector.update(rows[selectedIndex], this.ranges[selectedIndex], metadata);
      this.renderer.drawNavigator(tiers); this.source.updateMetadata?.(metadata);
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
    this.hoverSample = sample; if (this.latestTiers) this.renderer.drawNavigator(this.latestTiers);
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
      values: row.values,
    }));
  }));
}
