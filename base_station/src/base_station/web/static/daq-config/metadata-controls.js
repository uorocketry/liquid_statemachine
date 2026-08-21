/** Shared draft/commit lifecycle for graph metadata controls outside blueprint nodes. */
export class MetadataControls {
  constructor(editor, descriptors, onDraftChange) {
    this.editor = editor;
    this.descriptors = descriptors;
    this.onDraftChange = onDraftChange;
    this.drafts = new Map();
    for (const descriptor of descriptors) this.bind(descriptor);
  }

  get hasPending() { return this.drafts.size > 0; }

  sync(metadata = {}) {
    this.drafts.clear();
    for (const descriptor of this.descriptors) {
      const value = metadata[descriptor.key];
      descriptor.element.value = value ?? '';
    }
    this.onDraftChange?.();
  }

  flush() {
    if (!this.drafts.size) return false;
    const patch = Object.fromEntries(this.drafts);
    this.drafts.clear();
    this.editor.updateMetadata(patch);
    this.onDraftChange?.();
    return true;
  }

  bind(descriptor) {
    const { element } = descriptor;
    if (element.matches('input[type="number"], input[type="text"]')) {
      element.addEventListener('input', () => this.track(descriptor));
    }
    element.addEventListener('change', () => this.commit(descriptor));
  }

  track(descriptor) {
    const value = readValue(descriptor);
    const committed = this.editor.graph.metadata?.[descriptor.key];
    if (Object.is(value, committed)) this.drafts.delete(descriptor.key);
    else this.drafts.set(descriptor.key, value);
    this.onDraftChange?.();
  }

  commit(descriptor) {
    const value = readValue(descriptor);
    this.drafts.delete(descriptor.key);
    if (!Object.is(value, this.editor.graph.metadata?.[descriptor.key])) {
      this.editor.updateMetadata({ [descriptor.key]: value });
    }
    this.onDraftChange?.();
  }
}

function readValue({ element, valueType = 'string' }) {
  if (valueType === 'number') return element.value === '' ? null : Number(element.value);
  if (valueType === 'boolean') return element.value === 'true';
  return element.value;
}
