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
})();
