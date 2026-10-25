import { MAX_TEXT, SITUATIONS, type Situation } from '../../app/language/practice/conversation.ts';

type Draft = { text: string; situation: Situation };
export type ConversationDraftLease = { owner: string; generation: number; revision: number; draft: Draft | null };
let owner: string | null = null;
let generation = 0;
let revision = 0;
let draft: Draft | null = null;
let listening = false;

// One bounded, tab-memory input only: no journal, consent, recording or AI reply.
export function clearConversationInputDraft() {
  owner = null; draft = null; generation++; revision++;
  if (listening && typeof window !== 'undefined') {
    window.removeEventListener('yeoni-cloud-session-changed', clearConversationInputDraft);
    window.removeEventListener('storage', storageChanged);
    window.removeEventListener('pagehide', clearConversationInputDraft);
  }
  listening = false;
}
function storageChanged(event: StorageEvent) {
  if (event.key === null || event.key === 'language-cloud-sync-user' || event.key === 'fitness-cloud-sync-user') clearConversationInputDraft();
}
function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('yeoni-cloud-session-changed', clearConversationInputDraft);
  window.addEventListener('storage', storageChanged);
  window.addEventListener('pagehide', clearConversationInputDraft);
}
export function openConversationInputDraft(nextOwner: string): ConversationDraftLease {
  if (owner !== nextOwner) { clearConversationInputDraft(); owner = nextOwner; }
  listen();
  return { owner: nextOwner, generation, revision, draft: draft ? { ...draft } : null };
}
export function updateConversationInputDraft(lease: ConversationDraftLease, value: Draft, options: { claim?: boolean; expectedRevision?: number } = {}): boolean {
  if (lease.owner !== owner || lease.generation !== generation || value.text.length > MAX_TEXT || !SITUATIONS.includes(value.situation)) return false;
  // Only an intentional non-empty text edit may become the newest writer.
  // Topic changes, clear and async completion must match the version they read.
  const expected = options.expectedRevision ?? lease.revision;
  if (!(options.claim && value.text.trim()) && expected !== revision) return false;
  draft = value.text.trim() ? { ...value } : null;
  revision++; lease.revision = revision;
  return true;
}
