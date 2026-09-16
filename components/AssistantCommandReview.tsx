'use client';
import { AssistantDietReview } from './AssistantDietCommand';
import { AssistantTaskReview } from './AssistantTaskCommand';
import { AssistantBudgetReview } from './AssistantBudgetCommand';
import { AssistantWorkoutReview } from './AssistantWorkoutCommand';
import { AssistantLanguageReview } from './AssistantLanguageCommand';
import type { AssistantCommandProposal } from '@/lib/assistant-command-drafts';

export function AssistantCommandReview(props: {
  proposal: AssistantCommandProposal; ownerId?: string; initiallyAttempted?: boolean;
  onChanged?: () => void | Promise<void>; onAttempt?: () => Promise<void>; onSettled?: () => Promise<void>;
}) {
  if (props.proposal.domain === 'diet') return <AssistantDietReview {...props} proposal={props.proposal} />;
  if (props.proposal.domain === 'workout') return <AssistantWorkoutReview {...props} proposal={props.proposal} />;
  if (props.proposal.domain === 'budget') return <AssistantBudgetReview {...props} proposal={props.proposal} />;
  if (props.proposal.domain === 'language') return <AssistantLanguageReview {...props} proposal={props.proposal} />;
  return <AssistantTaskReview {...props} proposal={props.proposal} />;
}
