const page = document.querySelector(".run-detail");
const runId = Number(page.dataset.runId);

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
  canvases: [document.querySelector("#history-chart-a"), document.querySelector("#history-chart-b")],
  rangeLabels: [document.querySelector("#range-a"), document.querySelector("#range-b")],
  navigator: document.querySelector("#tier-navigator"),
  label: document.querySelector("#window-label"),
  playButton: document.querySelector("#playback-toggle"),
  tailButton: document.querySelector("#return-tail"),
  pollInterval: 750,
});
runTimeline.following = page.dataset.runStatus === "recording";
runTimeline.start();
