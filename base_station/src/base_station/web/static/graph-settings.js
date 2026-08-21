const graphSettingsForm = document.querySelector(".graph-settings-form");
const graphSettingsKey = "liquid-state-machine.graph-settings.v2";

if (graphSettingsForm) {

function readGraphSettings() {
  const mode = new FormData(graphSettingsForm).get("filter_mode");
  return {
    filterMode: mode,
    movingAverageMs: Number(graphSettingsForm.elements.moving_average_ms.value),
    emaTimeConstantMs: Number(graphSettingsForm.elements.ema_time_constant_ms.value),
    contextSeconds: Number(graphSettingsForm.elements.context_seconds.value),
    detailSeconds: Number(graphSettingsForm.elements.detail_seconds.value),
    displayTier: new FormData(graphSettingsForm).get("display_tier"),
  };
}

function updateGraphSettingsOutputs() {
  graphSettingsForm.querySelector(".moving-average-option output").textContent =
    `${graphSettingsForm.elements.moving_average_ms.value} ms`;
  graphSettingsForm.querySelector(".ema-option output").textContent =
    `${graphSettingsForm.elements.ema_time_constant_ms.value} ms`;
}

try {
  const saved = JSON.parse(localStorage.getItem(graphSettingsKey) || "null");
  if (saved) {
    const radio = graphSettingsForm.querySelector(`[name="filter_mode"][value="${saved.filterMode}"]`);
    if (radio) radio.checked = true;
    if (saved.movingAverageMs) graphSettingsForm.elements.moving_average_ms.value = saved.movingAverageMs;
    if (saved.emaTimeConstantMs) graphSettingsForm.elements.ema_time_constant_ms.value = saved.emaTimeConstantMs;
    if (saved.contextSeconds) graphSettingsForm.elements.context_seconds.value = saved.contextSeconds;
    if (saved.detailSeconds) graphSettingsForm.elements.detail_seconds.value = saved.detailSeconds;
    const displayTier = graphSettingsForm.querySelector(`[name="display_tier"][value="${saved.displayTier}"]`);
    if (displayTier) displayTier.checked = true;
  }
} catch (_) { /* Invalid browser storage falls back to safe defaults. */ }

let graphSettingsTimer = 0;
graphSettingsForm.addEventListener("input", () => {
  updateGraphSettingsOutputs();
  const settings = readGraphSettings();
  localStorage.setItem(graphSettingsKey, JSON.stringify(settings));
  clearTimeout(graphSettingsTimer);
  graphSettingsTimer = setTimeout(() => window.dispatchEvent(new CustomEvent("graph-settings-change")), 80);
});
graphSettingsForm.addEventListener("change", () => {
  localStorage.setItem(graphSettingsKey, JSON.stringify(readGraphSettings()));
  window.dispatchEvent(new CustomEvent("graph-settings-change"));
});
updateGraphSettingsOutputs();
window.graphSettings = {
  read: readGraphSettings,
  setContext(durationSeconds) {
    const input = graphSettingsForm.elements.context_seconds;
    const duration = Math.max(Number(input.min) || .01, Math.min(Number(input.max) || 3600, durationSeconds));
    input.value = Number(duration.toFixed(3));
    graphSettingsForm.querySelector('[name="display_tier"][value="context"]').checked = true;
    localStorage.setItem(graphSettingsKey, JSON.stringify(readGraphSettings()));
    updateGraphSettingsOutputs();
  },
};
}
