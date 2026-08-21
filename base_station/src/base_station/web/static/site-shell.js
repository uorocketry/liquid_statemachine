import { bindPageResource, onPageRestore } from './page-resource-lifecycle.js';

(() => {
  const shell = document.querySelector('#site-shell');
  const toggle = document.querySelector('#site-sidebar-toggle');
  if (!shell || !toggle) return;

  const key = 'liquid-site-sidebar';
  const root = document.documentElement;
  let focusMode = false;
  let restoreOpen = true;
  const setOpen = (open, persist = true) => {
    root.dataset.sidebar = open ? 'open' : 'closed';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close sidebar' : 'Open sidebar');
    if (persist) {
      try { localStorage.setItem(key, open ? 'open' : 'closed'); } catch { /* ignore */ }
    }
  };

  const open = root.dataset.sidebar !== 'closed';
  setOpen(open, false);
  restoreOpen = open;

  const setFocusMode = (active) => {
    const next = Boolean(active);
    if (next === focusMode) return;
    if (next) {
      restoreOpen = root.dataset.sidebar !== 'closed';
      focusMode = true;
      shell.classList.add('focus-mode');
      setOpen(false, false);
      toggle.setAttribute('aria-label', 'Exit focus mode');
      toggle.title = 'Exit focus mode';
    } else {
      focusMode = false;
      shell.classList.remove('focus-mode');
      setOpen(restoreOpen, false);
      toggle.removeAttribute('title');
    }
    document.dispatchEvent(new CustomEvent('liquid:focus-mode-change', { detail: { active: focusMode } }));
  };

  toggle.addEventListener('click', () => {
    if (focusMode) setFocusMode(false);
    else setOpen(root.dataset.sidebar === 'closed');
  });

  if (shell.dataset.activePage === 'dashboard') {
    window.addEventListener('keydown', (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.code !== 'Period') return;
      const target = event.target;
      if (target.matches?.('input, textarea, select') || target.isContentEditable) return;
      event.preventDefault();
      setFocusMode(!focusMode);
    });
  }

  bindStatusStream(shell.dataset.statusDevice || shell.dataset.activeDevice || '');
  bindConfigFreshness(shell.dataset.configVersion || '');
})();

function bindConfigFreshness(initialVersion) {
  if (!initialVersion) return;
  onPageRestore(async () => {
    try {
      const response = await fetch('/api/config/revision', { cache: 'no-store' });
      const payload = await response.json();
      if (response.ok && payload.version && payload.version !== initialVersion) location.reload();
    } catch { /* Keep the restored page usable while the server is temporarily unavailable. */ }
  });
}

function bindStatusStream(activeDevice) {
  if (!('EventSource' in window)) return;
  const links = new Map(
    [...document.querySelectorAll('[data-device-status]')]
      .map((element) => [element.dataset.deviceStatus, element]),
  );
  if (!links.size) return;

  const query = activeDevice ? `?device=${encodeURIComponent(activeDevice)}` : '';
  let source = null;
  const onStatus = (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    for (const [deviceId, data] of Object.entries(payload?.navigation ?? {})) {
      const link = links.get(deviceId);
      if (!link || typeof data?.status !== 'string') continue;
      applyStatus(link, data.status);
    }
    document.dispatchEvent(new CustomEvent('liquid:status', { detail: payload }));
  };
  const start = () => {
    if (source) return;
    source = new EventSource(`/api/status/events${query}`);
    source.addEventListener('status', onStatus);
  };
  const stop = () => {
    source?.close();
    source = null;
  };
  bindPageResource({ start, stop });
}

function applyStatus(link, status) {
  link.classList.remove('online', 'healthy', 'degraded', 'offline');
  link.classList.add(status);
  const label = link.querySelector('em');
  if (label) label.textContent = status;
}
