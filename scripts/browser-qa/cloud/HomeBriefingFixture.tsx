import { useState } from 'react';
import DailyBriefing from '../../../components/DailyBriefing';
import { briefingScenario, HOME_BRIEFING_SCENARIOS, type HomeBriefingScenario } from './home-briefing-scenarios';

/** The actual home disclosure component; not the whole authenticated home or a five-second user test. */
export default function HomeBriefingFixture() {
  const [scenario, setScenario] = useState<HomeBriefingScenario>('empty');
  return <>
    <label>Synthetic home briefing scenario<select className="block max-w-full border p-2" value={scenario}
      onChange={event => setScenario(event.target.value as HomeBriefingScenario)}>
      {HOME_BRIEFING_SCENARIOS.map(value => <option key={value} value={value}>{value}</option>)}
    </select></label>
    <div data-testid="actual-home-briefing"><DailyBriefing key={scenario} input={briefingScenario(scenario)} loading={scenario === 'loading'} /></div>
    <section id="assistant-list" aria-label="Synthetic task destination" tabIndex={-1} className="mt-4 border p-3">Synthetic in-page link destination only; not the real task list.</section>
  </>;
}
