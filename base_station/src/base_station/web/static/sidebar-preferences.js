(() => {
  let state = 'open';
  try { state = localStorage.getItem('liquid-site-sidebar') === 'closed' ? 'closed' : 'open'; } catch { /* ignore */ }
  document.documentElement.dataset.sidebar = state;
})();
