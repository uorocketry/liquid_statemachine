import { graphSignature } from '../blueprint/model.js';
import { blockingIssues } from './validation.js';

/** Signal Graph issue list, dirty-state guard, and save-control presentation. */
export class SignalGraphPageUi {
  constructor({ editor, issueSummary, issueTools, issueCount, saveButton, saveFeedback, undoButton, redoButton }) {
    Object.assign(this, {
      editor, issueSummary, issueTools, issueCount, saveButton, saveFeedback, undoButton, redoButton,
    });
    this.savedGraphSignature = '';
    this.beforeUnloadBound = false;
    this.onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
  }

  markSaved(graph) {
    this.savedGraphSignature = graphSignature(graph);
  }

  refresh(issues, { presentation = true } = {}) {
    if (presentation) this.editor.refreshPresentation();
    this.renderIssues(issues);
    this.refreshSaveState(issues);
    this.undoButton.disabled = !this.editor.canUndo;
    this.redoButton.disabled = !this.editor.canRedo;
  }

  refreshSaveState(issues) {
    const errors = blockingIssues(issues);
    const pending = this.editor.hasPendingInlineEdit;
    const unsaved = this.hasUnsavedGraph() || pending;
    this.saveButton.disabled = !unsaved || (errors.length > 0 && !pending);
    const showError = errors.length > 0 && !pending;
    this.saveButton.classList.toggle('error', showError);
    this.saveButton.title = showError
      ? 'Resolve validation issues before saving'
      : unsaved ? 'Save graph' : 'No unsaved changes';
    this.saveButton.setAttribute('aria-label', this.saveButton.title);
    this.syncBeforeUnload(unsaved);
  }

  setSaving() {
    this.saveButton.disabled = true;
    this.saveButton.title = 'Saving graph…';
    this.saveButton.setAttribute('aria-label', this.saveButton.title);
    this.saveFeedback.textContent = 'Saving graph';
  }

  setSaved(graph) {
    this.markSaved(graph);
    this.saveFeedback.textContent = 'Graph saved';
  }

  setSaveError(message) {
    this.saveButton.disabled = false;
    this.saveButton.classList.add('error');
    this.saveButton.title = `Save failed: ${message}`;
    this.saveButton.setAttribute('aria-label', this.saveButton.title);
    this.saveFeedback.textContent = this.saveButton.title;
  }

  renderIssues(issues) {
    this.issueSummary.replaceChildren();
    this.issueTools.hidden = issues.length === 0;
    this.issueTools.classList.toggle('error', issues.some((issue) => issue.severity === 'error'));
    this.issueCount.textContent = String(issues.length);
    if (!issues.length) this.issueTools.open = false;

    const ordered = [...issues].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    for (const issue of ordered) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `daq-issue-item ${issue.severity}`;
      const subject = document.createElement('strong');
      subject.textContent = this.issueSubjectLabel(issue.subject);
      const message = document.createElement('span');
      message.textContent = issue.message;
      button.append(subject, message);
      button.addEventListener('click', () => this.focusIssue(issue));
      this.issueSummary.append(button);
    }
  }

  issueSubjectLabel(subject) {
    if (subject === 'graph') return 'Graph';
    const node = this.editor.graph.nodes.find((candidate) => candidate.id === subject);
    if (!node) return subject;
    const channel = node.config?.channel;
    return channel ? `${node.title} · ${channel}` : node.title;
  }

  focusIssue(issue) {
    if (issue.subject === 'graph') return this.editor.fitGraph();
    if (!this.editor.graph.nodes.some((node) => node.id === issue.subject)) return;
    this.editor.selectNode(issue.subject);
    requestAnimationFrame(() => this.editor.frameNode(issue.subject));
  }

  hasUnsavedGraph() {
    return graphSignature(this.editor.graph) !== this.savedGraphSignature;
  }

  syncBeforeUnload(unsaved) {
    if (unsaved === this.beforeUnloadBound) return;
    this.beforeUnloadBound = unsaved;
    if (unsaved) window.addEventListener('beforeunload', this.onBeforeUnload);
    else window.removeEventListener('beforeunload', this.onBeforeUnload);
  }
}

function severityRank(severity) {
  return severity === 'error' ? 0 : severity === 'warning' ? 1 : 2;
}
