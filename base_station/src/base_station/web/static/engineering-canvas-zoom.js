export const ENGINEERING_ZOOM_LEVELS = [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8];

export function adjacentZoomLevel(scale, direction) {
  const value = Number(scale) || 1;
  if (direction > 0) return ENGINEERING_ZOOM_LEVELS.find((level) => level > value + 1e-6) ?? ENGINEERING_ZOOM_LEVELS.at(-1);
  return [...ENGINEERING_ZOOM_LEVELS].reverse().find((level) => level < value - 1e-6) ?? ENGINEERING_ZOOM_LEVELS[0];
}

export class EngineeringCanvasZoom extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = 'true';
    this.classList.add('engineering-canvas-zoom');
    this.innerHTML = `
      <button type="button" data-zoom-direction="-1" aria-label="Zoom out">−</button>
      <div class="engineering-canvas-zoom-menu">
        <button type="button" class="engineering-canvas-zoom-current" aria-label="Zoom actions" aria-haspopup="menu" aria-expanded="false"><output>100%</output></button>
        <div class="engineering-canvas-zoom-popover" role="menu" hidden>
          <button type="button" data-zoom-action="in">Zoom in</button>
          <button type="button" data-zoom-action="out">Zoom out</button>
          <button type="button" data-zoom-action="100">Zoom to 100%</button>
          <button type="button" data-zoom-fit>Zoom to fit</button>
          <button type="button" data-zoom-selection>Zoom to selection</button>
        </div>
      </div>
      <button type="button" data-zoom-direction="1" aria-label="Zoom in">+</button>`;
    this.addEventListener('click', (event) => this.onClick(event));
    this.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.setMenuOpen(false);
    });
    this._outsideClick = (event) => {
      if (!this.contains(event.target)) this.setMenuOpen(false);
    };
    this._shortcut = (event) => this.onShortcut(event);
    document.addEventListener('pointerdown', this._outsideClick);
    window.addEventListener('keydown', this._shortcut);
    this.scale = Number(this.getAttribute('scale')) || 1;
    this.selectionAvailable = false;
  }

  disconnectedCallback() {
    document.removeEventListener('pointerdown', this._outsideClick);
    window.removeEventListener('keydown', this._shortcut);
  }

  set scale(value) {
    this._scale = Number(value) || 1;
    this.renderOutput();
    const out = this.querySelector('[data-zoom-direction="-1"]');
    const input = this.querySelector('[data-zoom-direction="1"]');
    if (out) out.disabled = this._scale <= ENGINEERING_ZOOM_LEVELS[0] + 1e-6;
    if (input) input.disabled = this._scale >= ENGINEERING_ZOOM_LEVELS.at(-1) - 1e-6;
  }

  get scale() { return this._scale ?? 1; }

  set displayLabel(value) {
    this._displayLabel = String(value ?? '').trim();
    this.renderOutput();
  }

  renderOutput() {
    const output = this.querySelector('output');
    if (output) output.textContent = this._displayLabel || `${Math.round(this.scale * 100)}%`;
  }

  set selectionAvailable(value) {
    const button = this.querySelector('[data-zoom-selection]');
    if (button) button.disabled = !value;
  }

  onClick(event) {
    const menuButton = event.target.closest('.engineering-canvas-zoom-current');
    const direction = event.target.closest('[data-zoom-direction]');
    const fit = event.target.closest('[data-zoom-fit]');
    const selection = event.target.closest('[data-zoom-selection]');
    const action = event.target.closest('[data-zoom-action]');
    if (menuButton) {
      this.setMenuOpen(this.querySelector('.engineering-canvas-zoom-popover')?.hidden !== false);
      return;
    }
    if (direction) this.requestScale(adjacentZoomLevel(this.scale, Number(direction.dataset.zoomDirection)));
    else if (fit) this.request({ kind: 'fit' });
    else if (selection) this.request({ kind: 'selection' });
    else if (action?.dataset.zoomAction === 'in') this.requestScale(adjacentZoomLevel(this.scale, 1));
    else if (action?.dataset.zoomAction === 'out') this.requestScale(adjacentZoomLevel(this.scale, -1));
    else if (action?.dataset.zoomAction === '100') this.requestScale(1);
    else return;
    this.setMenuOpen(false);
  }

  setMenuOpen(open) {
    const popover = this.querySelector('.engineering-canvas-zoom-popover');
    const button = this.querySelector('.engineering-canvas-zoom-current');
    if (!popover || !button) return;
    popover.hidden = !open;
    button.setAttribute('aria-expanded', String(Boolean(open)));
  }

  onShortcut(event) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const target = event.target;
    if (target.matches?.('input, textarea, select') || target.isContentEditable) return;
    let direction = 0;
    if (event.code === 'Equal' || event.code === 'NumpadAdd' || event.key === '+') direction = 1;
    else if (event.code === 'Minus' || event.code === 'NumpadSubtract' || event.key === '-') direction = -1;
    if (!direction) return;
    event.preventDefault();
    this.requestScale(adjacentZoomLevel(this.scale, direction));
  }

  requestScale(scale) { this.request({ kind: 'scale', scale }); }

  request(detail) {
    this.dispatchEvent(new CustomEvent('engineering-canvas-zoom-request', { bubbles: true, detail }));
  }
}

if (!customElements.get('engineering-canvas-zoom')) {
  customElements.define('engineering-canvas-zoom', EngineeringCanvasZoom);
}
