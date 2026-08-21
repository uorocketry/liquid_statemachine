/**
 * Keep one browser-owned resource aligned with page/BFCache visibility.
 * Resources must make start/stop idempotent.
 */
export function bindPageResource({ start, stop, pauseWhenHidden = false }) {
  const startIfVisible = () => {
    if (!pauseWhenHidden || !document.hidden) start();
  };
  const onVisibilityChange = () => {
    if (!pauseWhenHidden) return;
    if (document.hidden) stop();
    else start();
  };

  startIfVisible();
  window.addEventListener('pagehide', stop);
  onPageRestore(startIfVisible);
  if (pauseWhenHidden) document.addEventListener('visibilitychange', onVisibilityChange);
}

export function onPageRestore(callback) {
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) callback();
  });
}
