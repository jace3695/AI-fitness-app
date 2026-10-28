import { useState } from 'react';
import HomeOverview from '../../../components/HomeOverview';
import { buildAssistantNextAction } from '../../../app/data/assistantNextAction';
import { briefingScenario, HOME_BRIEFING_SCENARIOS, type HomeBriefingScenario } from './home-briefing-scenarios';

const scenarios = [...HOME_BRIEFING_SCENARIOS, 'unavailable', 'long-title'] as const;
type Scenario = typeof scenarios[number];

/** Actual summary with existing header spacing with already-read synthetic inputs, not auth/acquisition. */
export default function HomeOverviewFixture() {
  const [scenario, setScenario] = useState<Scenario>('empty');
  const [refreshing, setRefreshing] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const input = briefingScenario(scenario === 'long-title' ? 'due-priority' : scenario === 'unavailable' ? 'partial-failure' : scenario as HomeBriefingScenario);
  const failures = scenario === 'unavailable' ? ['연결 확인'] : scenario === 'partial-failure' ? ['할 일', '가계부'] : [];
  const loading = scenario === 'loading' || refreshing;
  const action = loading || scenario === 'unavailable' ? null : buildAssistantNextAction(input);
  if (action && scenario === 'long-title') action.title = '긴 합성 할 일 제목으로 줄바꿈과 전체 내용 보존을 확인합니다. '.repeat(8);
  return <>
    <div className="app-module-header"><div className="app-module-header-inner"><strong>AI 연이 · 합성 홈 요약 검사</strong></div></div>
    <div className="yeoni-page-content">
      <HomeOverview action={action} loading={loading} failures={failures} lastLoadedAt={scenario === 'partial-failure' ? '합성 시각' : null}
        onRetry={() => { setAttempts(value => value + 1); setRefreshing(true); }} />
      <section id="yeoni-chat" tabIndex={-1} aria-label="Synthetic chat destination" className="mt-5 scroll-mt-24 rounded-2xl bg-white p-4">Synthetic chat destination only; no chat request.</section>
      <section id="assistant-list" tabIndex={-1} aria-label="Synthetic task destination" className="mt-5 scroll-mt-24 rounded-2xl bg-white p-4">Synthetic task destination only; no task mutation.</section>
      <section id="today-apps" tabIndex={-1} aria-label="Synthetic status destination" className="mt-5 scroll-mt-24 rounded-2xl bg-white p-4">Synthetic status destination only; no record acquisition.</section>
    </div>
    <label htmlFor="synthetic-home-overview-scenario">Synthetic home overview scenario</label>
    <select id="synthetic-home-overview-scenario" className="block max-w-full border p-2" value={scenario}
      onChange={event => { setScenario(event.target.value as Scenario); setRefreshing(false); }}>
      {scenarios.map(value => <option key={value} value={value}>{value}</option>)}
    </select>
    <output aria-label="Synthetic refresh attempts">{attempts}</output>
    {refreshing && <button type="button" onClick={() => { setRefreshing(false); setScenario('due-priority'); }}>Complete synthetic refresh</button>}
  </>;
}
