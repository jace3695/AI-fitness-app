import type { TaskCommandProposal } from './assistant-task-command.ts';
import { isBudgetCommandProposal, type BudgetCommandProposal } from './assistant-budget-command.ts';
import { isLanguageCommandProposal, type LanguageCommandProposal } from './assistant-language-command.ts';
import { isWorkoutCommandProposal, type WorkoutCommandProposal } from './assistant-workout-command.ts';
import { isDietCommandProposal, type DietCommandProposal } from './assistant-diet-command.ts';
export type AssistantCommandProposal = TaskCommandProposal | BudgetCommandProposal | LanguageCommandProposal | WorkoutCommandProposal | DietCommandProposal;

export const COMMAND_DRAFT_KEY = 'yeoni:task-command-drafts:v1';
export type CommandDraft = { proposal: AssistantCommandProposal; attempted: boolean };
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
    if (p && p.domain === 'diet') {
      if (typeof draft.attempted !== 'boolean' || !isDietCommandProposal(p) || p.ownerId !== ownerId) throw new Error('invalid diet draft');
      continue;
    }
    if (p && p.domain === 'workout') {
      if (typeof draft.attempted !== 'boolean' || !isWorkoutCommandProposal(p) || p.ownerId !== ownerId) throw new Error('invalid workout draft');
      continue;
    }
    if (p && p.domain === 'language') {
      if (typeof draft.attempted !== 'boolean' || !isLanguageCommandProposal(p) || p.ownerId !== ownerId) throw new Error('invalid language draft');
      continue;
    }
    if (p && p.domain === 'budget') {
      if (typeof draft.attempted !== 'boolean' || !isBudgetCommandProposal(p) || p.expected.user_id !== ownerId) throw new Error('invalid budget draft');
      continue;
    }
    if (!p || (p.domain !== undefined && p.domain !== 'task') || typeof draft.attempted !== 'boolean' || typeof p.requestId !== 'string'
      || !['create', 'update'].includes(p.operation) || !p.values || typeof p.values.title !== 'string'
      || !renderable(p.values) || !nullableString(p.projectName) || !nullableString(p.resetMarker)
      || !nullableString(p.itemId) || (p.expected !== null && (typeof p.expected !== 'object' || !renderable(p.expected)))
      || !Number.isFinite(Date.parse(p.expiresAt))) throw new Error('invalid draft');
  }
  return data.drafts;
}
