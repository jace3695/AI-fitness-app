const pendingEditors = new Set<symbol>();
export const UNSAVED_CHANGES_EVENT = 'yeoni-unsaved-changes';
export const RELOAD_REQUEST_EVENT = 'yeoni-reload-request';

export function setEditorDirty(editor: symbol, dirty: boolean) {
  const before = pendingEditors.size;
  if (dirty) pendingEditors.add(editor);
  else pendingEditors.delete(editor);
  if (before !== pendingEditors.size && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(UNSAVED_CHANGES_EVENT));
  }
}

export function hasUnsavedChanges() { return pendingEditors.size > 0; }

export function requestSafeReload() {
  if (hasUnsavedChanges()) {
    window.dispatchEvent(new Event(RELOAD_REQUEST_EVENT));
    return false;
  }
  window.location.reload();
  return true;
}
