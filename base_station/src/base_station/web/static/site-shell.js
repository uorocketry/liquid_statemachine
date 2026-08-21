(() => {
  const shell = document.querySelector('#site-shell');
  const toggle = document.querySelector('#site-sidebar-toggle');
  if (!shell || !toggle) return;

  const key = 'liquid-site-sidebar';
  const setOpen = (open, persist = true) => {
    shell.classList.toggle('sidebar-collapsed', !open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close sidebar' : 'Open sidebar');
    if (persist) {
      try { localStorage.setItem(key, open ? 'open' : 'closed'); } catch { /* ignore */ }
    }
  };

  let open = true;
  try { open = localStorage.getItem(key) !== 'closed'; } catch { /* ignore */ }
  setOpen(open, false);
  toggle.addEventListener('click', () => setOpen(shell.classList.contains('sidebar-collapsed')));

  bindStatusStream(shell.dataset.statusDevice || shell.dataset.activeDevice || '');
})();

function bindStatusStream(activeDevice) {
  if (!('EventSource' in window)) return;
  const links = new Map(
    [...document.querySelectorAll('[data-device-status]')]
      .map((element) => [element.dataset.deviceStatus, element]),
  );
  if (!links.size) return;

  const query = activeDevice ? `?device=${encodeURIComponent(activeDevice)}` : '';
  const source = new EventSource(`/api/status/events${query}`);
  source.addEventListener('status', (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    for (const [deviceId, data] of Object.entries(payload?.navigation ?? {})) {
      const link = links.get(deviceId);
      if (!link || typeof data?.status !== 'string') continue;
      applyStatus(link, data.status);
    }
    document.dispatchEvent(new CustomEvent('liquid:status', { detail: payload }));
  });
  window.addEventListener('pagehide', () => source.close(), { once: true });
}

function applyStatus(link, status) {
  link.classList.remove('online', 'healthy', 'degraded', 'offline');
  link.classList.add(status);
  const label = link.querySelector('em');
  if (label) label.textContent = status;
}
