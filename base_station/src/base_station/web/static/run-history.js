const page = document.querySelector(".run-detail");
const runId = Number(page.dataset.runId);
const signalCards = [...document.querySelectorAll("[data-run-signal]")];
const signals = signalCards.map((card) => ({
  id: card.dataset.runSignal,
  label: card.dataset.signalLabel ?? card.dataset.runSignal,
  unit: card.dataset.signalUnit ?? "",
}));

class RunTimelineSource {
  async metadata() {
    const response = await fetch(`/api/runs/${runId}/samples?start=0&end=1&points=20`);
    if (!response.ok) throw new Error("Unable to load run metadata");
    const run = (await response.json()).run;
    return { start: 0, total: run.sample_count, rate: run.scan_rate, status: run.status, run };
  }

  async samples(ranges) {
    return loadRunTimelineSamples(runId, ranges);
  }

  updateMetadata(metadata) {
    const run = metadata.run;
    document.querySelector("#run-status").textContent = run.status;
    document.querySelector("#run-samples").textContent = run.sample_count.toLocaleString();
    document.querySelector("#run-duration").textContent = `${(run.sample_count / run.scan_rate).toFixed(3)} s`;
  }
}

const runTimeline = new TimelineView({
  source: new RunTimelineSource(),
  signals,
  canvases: signalCards.map((card) => card.querySelector("[data-run-signal-canvas]")),
  rangeLabels: signalCards.map((card) => card.querySelector("[data-run-signal-range]")),
  navigator: document.querySelector("#tier-navigator"),
  label: document.querySelector("#window-label"),
  playButton: document.querySelector("#playback-toggle"),
  tailButton: document.querySelector("#return-tail"),
  pollInterval: 750,
});
runTimeline.following = page.dataset.runStatus === "recording";
runTimeline.start();
