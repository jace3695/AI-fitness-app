import { useState } from 'react';
import AssistantListEmptyState from '../../../components/AssistantListEmptyState';
import PreparationPoseDemo from '../../../app/components/PreparationPoseDemo';
import DeadBugInformationalReview from '../../../app/components/DeadBugInformationalReview';
import RollerRecoveryInformationalReview from '../../../app/components/RollerRecoveryInformationalReview';

/** Callback plumbing here is synthetic; the production empty/error component is real. */
export function EmptyListFixture() {
  const [condition, setCondition] = useState('empty');
  const [added, setAdded] = useState(false);
  const [retries, setRetries] = useState(0);
  return <>
    <label>Synthetic list outcome
      <select value={condition} onChange={event => setCondition(event.target.value)}>
        <option value="empty">Empty</option><option value="failed">Relevant failure</option>
        <option value="unrelated">Unrelated failure</option>
      </select>
    </label>
    <div data-testid="actual-empty-state">
      <AssistantListEmptyState filter="project" loadFailures={condition === 'failed' ? ['프로젝트'] : condition === 'unrelated' ? ['할 일'] : []}
        entryFormId="synthetic-entry" onAdd={() => setAdded(true)} onRetry={() => setRetries(value => value + 1)} />
    </div>
    <output data-testid="retry-count">{retries}</output>
    {added ? <form id="synthetic-entry" onSubmit={event => event.preventDefault()}><label>Synthetic entry<input /></label></form> : null}
  </>;
}

export function StaticPoseFixture() {
  return <PreparationPoseDemo exerciseId="ab-slider-ready-position" />;
}

export function MotionFixture() {
  return <>
    <div data-testid="deadbug-disclosure"><DeadBugInformationalReview /></div>
    <div className="mt-4" data-testid="roller-disclosure"><RollerRecoveryInformationalReview /></div>
  </>;
}
