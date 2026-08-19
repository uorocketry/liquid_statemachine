(() => {
  const KEY = 'liquid-appearance';
  const root = document.documentElement;
  const apply = (value) => {
    if (value === 'light' || value === 'dark') root.dataset.theme = value;
    else root.removeAttribute('data-theme');
  };

  let current = 'system';
  try { current = localStorage.getItem(KEY) || 'system'; } catch { /* ignore */ }
  apply(current);

  const bind = () => {
    const group = document.querySelector('[data-appearance-control]');
    if (!group) return;
    const buttons = [...group.querySelectorAll('[data-theme-option]')];
    const sync = () => buttons.forEach((button) => button.setAttribute(
      'aria-pressed', String(button.dataset.themeOption === current),
    ));
    sync();
    buttons.forEach((button) => button.addEventListener('click', () => {
      current = button.dataset.themeOption;
      try { localStorage.setItem(KEY, current); } catch { /* ignore */ }
      apply(current);
      sync();
    }));
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
