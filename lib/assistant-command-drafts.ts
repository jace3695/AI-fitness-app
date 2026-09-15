import type { TaskCommandProposal } from './assistant-task-command.ts';

export const COMMAND_DRAFT_KEY = 'yeoni:task-command-drafts:v1';
export type CommandDraft = { proposal: TaskCommandProposal; attempted: boolean };
export type CommandDraftEnvelope = { ownerId: string; drafts: CommandDraft[] };

// This is display/recovery data, never an authorization source. The server revalidates every apply.
export function readCommandDrafts(raw: string | null, ownerId: string): CommandDraft[] {
  if (!raw) return [];
  if (raw.length > 600000) throw new Error('oversized drafts');
  const data = JSON.parse(raw) as CommandDraftEnvelope;
  if (data.ownerId !== ownerId) return [];
  if (!Array.isArray(data.drafts) || data.drafts.length > 20) throw new Error('invalid drafts');
  const nullableString = (value: unknown) => value === null || typeof value === 'string';
  const renderable = (record: Record<string, unknown>) => Number.isInteger(record.priority)
    && typeof record.recurrence_rule === 'string' && nullableString(record.due_at);
  for (const draft of data.drafts) {
    const p = draft?.proposal;
    if (!p || typeof draft.attempted !== 'boolean' || typeof p.requestId !== 'string'
      || !['create', 'update'].includes(p.operation) || !p.values || typeof p.values.title !== 'string'
      || !renderable(p.values) || !nullableString(p.projectName) || !nullableString(p.resetMarker)
      || !nullableString(p.itemId) || (p.expected !== null && (typeof p.expected !== 'object' || !renderable(p.expected)))
      || !Number.isFinite(Date.parse(p.expiresAt))) throw new Error('invalid draft');
  }
  return data.drafts;
}
