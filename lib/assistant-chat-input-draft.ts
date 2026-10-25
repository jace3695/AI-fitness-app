export type AssistantChatDraftLease = { owner: string; generation: number; revision: number; text: string };
let owner: string | null = null;
let generation = 0;
let revision = 0;
let text = '';
let listening = false;

// One unsent input in this tab's memory. No messages, records, consent or storage.
export function clearAssistantChatInputDraft() {
  owner = null; text = ''; generation++; revision++;
  if (listening && typeof window !== 'undefined') {
    window.removeEventListener('yeoni-cloud-session-changed', clearAssistantChatInputDraft);
    window.removeEventListener('storage', storageChanged);
    window.removeEventListener('pagehide', clearAssistantChatInputDraft);
  }
  listening = false;
}
function storageChanged(event: StorageEvent) {
  if (event.key === null || event.key === 'fitness-cloud-sync-user' || event.key === 'fitness-cloud-sync-epoch') clearAssistantChatInputDraft();
}
export function openAssistantChatInputDraft(nextOwner: string): AssistantChatDraftLease {
  if (owner !== nextOwner) { clearAssistantChatInputDraft(); owner = nextOwner; }
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    window.addEventListener('yeoni-cloud-session-changed', clearAssistantChatInputDraft);
    window.addEventListener('storage', storageChanged);
    window.addEventListener('pagehide', clearAssistantChatInputDraft);
  }
  return { owner: nextOwner, generation, revision, text };
}
export function updateAssistantChatInputDraft(lease: AssistantChatDraftLease, value: string, userEdit = false): boolean {
  if (lease.owner !== owner || lease.generation !== generation || value.length > 500) return false;
  // Only a deliberate nonempty edit may supersede another mounted workspace.
  if (!(userEdit && value.trim()) && lease.revision !== revision) return false;
  text = value.trim() ? value : '';
  lease.text = text; lease.revision = ++revision;
  return true;
}
