const page = document.querySelector(".run-detail");
const runId = Number(page.dataset.runId);
const signalCards = [...document.querySelectorAll("[data-run-signal]")];
const signals = signalCards.map((card) => ({
  id: card.dataset.runSignal,
  label: card.dataset.signalLabel ?? card.dataset.runSignal,
  unit: card.dataset.signalUnit ?? "",
}));

class RunTimelineSource {
  constructor() {
    this.run = {
      id: runId,
      sample_count: Number(page.dataset.sampleCount),
      scan_rate: Number(page.dataset.scanRate),
      status: page.dataset.runStatus,
    };
  }

  async metadata() {
    const run = this.run;
    return { start: 0, total: run.sample_count, rate: run.scan_rate, status: run.status, run };
  }

  async samples(ranges) {
    const response = await fetch(`/api/runs/${runId}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ranges }),
    });
    if (!response.ok) throw new Error("Unable to load recorded samples");
    const payload = await response.json();
    this.run = payload.run;
    this.updatePage(this.run);
    return payload.tiers.map((rows) => rows.map((row) => ({
      x: row.sample_index, sampleEnd: row.sample_end, count: row.sample_count,
      values: row.values,
    })));
  }

  updateMetadata() {
    this.updatePage(this.run);
  }

  updateFromStatus(status) {
    if (status.current_run_id !== runId) return { matched: false, changed: false, active: false };
    const active = ['starting', 'running', 'stopping'].includes(status.acquisition_state);
    const changed = Number(status.sample_count) !== Number(this.run.sample_count)
      || (this.run.status === 'recording' && !active);
    this.run.sample_count = Number(status.sample_count);
    if (active) this.run.status = 'recording';
    return { matched: true, changed, active };
  }

  updatePage(run) {
    document.querySelector("#run-status").textContent = run.status;
    document.querySelector("#run-samples").textContent = run.sample_count.toLocaleString();
    document.querySelector("#run-duration").textContent = `${(run.sample_count / run.scan_rate).toFixed(3)} s`;
  }
}

const source = new RunTimelineSource();
const runTimeline = new TimelineView({
  source,
  signals,
  canvases: signalCards.map((card) => card.querySelector("[data-run-signal-canvas]")),
  rangeLabels: signalCards.map((card) => card.querySelector("[data-run-signal-range]")),
  navigator: document.querySelector("#tier-navigator"),
  label: document.querySelector("#window-label"),
  playButton: document.querySelector("#playback-toggle"),
  tailButton: document.querySelector("#return-tail"),
});
runTimeline.following = page.dataset.runStatus === "recording";
runTimeline.start();

if (runTimeline.following) {
  let refreshing = false;
  let pending = false;
  const refresh = async () => {
    if (refreshing) { pending = true; return; }
    refreshing = true;
    try { await runTimeline.refresh(); }
    finally {
      refreshing = false;
      if (pending) { pending = false; refresh(); }
    }
  };
  document.addEventListener('liquid:status', (event) => {
    const detail = event.detail?.device;
    if (detail?.id !== 'labjack' || !detail.status) return;
    const update = source.updateFromStatus(detail.status);
    if (!update.matched || !update.changed || !runTimeline.following || runTimeline.playing) return;
    const ending = !update.active;
    refresh().finally(() => {
      if (!ending) return;
      runTimeline.following = false;
      runTimeline.updateButtons();
    });
  });
}
