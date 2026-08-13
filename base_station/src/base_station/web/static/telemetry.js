class LiveTimelineSource {
  constructor() { this.payload = null; this.liveTail = true; this.pollWhenPaused = true; }

  invalidate() { this.payload = null; }

  async metadata(following) {
    if (!this.payload || following || this.pollWhenPaused) {
      const response = await fetch("/api/status");
      if (!response.ok) throw new Error("Unable to load live telemetry");
      this.payload = await response.json();
    }
    const status = this.payload.labjack;
    this.runId = status.current_run_id;
    const retained = this.runId ? status.sample_count : Math.min(status.sample_count, 30000);
    return {
      start: Math.max(0, status.sample_count - retained), total: status.sample_count,
      rate: status.scan_rate, status: status.acquisition_state === "running" ? "recording" : status.acquisition_state,
    };
  }

  async samples(ranges) {
    if (this.runId) {
      const rows = await loadRunTimelineSamples(this.runId, ranges);
      const latest = rows[2].at(-1);
      document.querySelector("#value-a").textContent = latest ? `${latest.aMean.toFixed(5)} V` : "— V";
      document.querySelector("#value-b").textContent = latest ? `${latest.bMean.toFixed(5)} V` : "— V";
      return rows;
    }
    const channels = this.payload.channels; const metadata = await this.metadata(false);
    const length = channels[0].length; const span = Math.max(1, metadata.total - metadata.start);
    const rows = Array.from({ length }, (_, index) => {
      const x = metadata.start + span * index / Math.max(1, length - 1);
      const nextX = metadata.start + span * (index + 1) / Math.max(1, length - 1);
      return { x, sampleEnd: nextX, count: Math.max(1, nextX - x),
        aMin: channels[0][index], aMax: channels[0][index], aMean: channels[0][index],
        bMin: channels[1][index], bMax: channels[1][index], bMean: channels[1][index] };
    });
    const latestA = channels[0].at(-1); const latestB = channels[1].at(-1);
    document.querySelector("#value-a").textContent = latestA === undefined ? "— V" : `${latestA.toFixed(5)} V`;
    document.querySelector("#value-b").textContent = latestB === undefined ? "— V" : `${latestB.toFixed(5)} V`;
    return ranges.map(([start, end]) => rows.filter((row) => row.x >= start && row.x <= end));
  }
}

const liveTimeline = new TimelineView({
  source: new LiveTimelineSource(),
  canvases: [document.querySelector("#chart-a"), document.querySelector("#chart-b")],
  navigator: document.querySelector("#live-tier-navigator"),
  playButton: document.querySelector("#live-playback"),
  tailButton: document.querySelector("#follow-live"),
  pollInterval: 500,
});
liveTimeline.start();
