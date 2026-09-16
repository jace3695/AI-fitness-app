'use client';
import { AssistantTaskReview } from './AssistantTaskCommand';
import { AssistantBudgetReview } from './AssistantBudgetCommand';
import { AssistantLanguageReview } from './AssistantLanguageCommand';
import type { AssistantCommandProposal } from '@/lib/assistant-command-drafts';

export function AssistantCommandReview(props: {
  proposal: AssistantCommandProposal; ownerId?: string; initiallyAttempted?: boolean;
  onChanged?: () => void | Promise<void>; onAttempt?: () => Promise<void>; onSettled?: () => Promise<void>;
}) {
  if (props.proposal.domain === 'budget') return <AssistantBudgetReview {...props} proposal={props.proposal} />;
  if (props.proposal.domain === 'language') return <AssistantLanguageReview {...props} proposal={props.proposal} />;
  return <AssistantTaskReview {...props} proposal={props.proposal} />;
}
