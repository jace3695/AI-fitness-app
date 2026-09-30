import { useState } from 'react';
import timeline from '../../docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json';
import { phoneViseme, type LipSyncManifest } from '../../lib/yeoni/lip-sync';

const sections = [
  { label: '조금 쉬는', start: 3370, end: 4410, hint: '“오늘은 조금 쉬는 게”를 함께 들어요. ㅁ에서 입이 닫히고, 쉬에서 둥글게 모였다가 펴지는지 보세요.' },
  { label: '좋겠어요', start: 4310, end: 5376, hint: '“게 좋겠어요”를 함께 들어요. 소리보다 입이 앞서거나 늦는지, 문장 끝에서 자연스럽게 닫히는지 보세요.' },
] as const;
const names = { rest: '쉼', closed: '닫힘', small: '작게', a: '아', i: '이', u: '우형', e: '에', o: '오' };
export function isReviewFixture(manifest: LipSyncManifest | null) {
  return !!manifest && manifest.audioSha256 === timeline.audioSha256 && manifest.textSha256 === timeline.textSha256
    && JSON.stringify(manifest.cues) === JSON.stringify(timeline.cues);
}
export default function ListeningReview({ enabled, rate, onRate, onPlay }: {
  enabled: boolean; rate: number; onRate(rate: number): void; onPlay(start: number, end: number): void;
}) {
  const [selected, setSelected] = useState(0);
  const section = sections[selected];
  const cues = timeline.cues.filter(c => c.endMs > section.start && c.startMs < section.end);
  return <section className="listening-review" aria-labelledby="listening-title">
    <h2 id="listening-title">짧게 나눠서 비교해요</h2>
    <p>먼저 정상 속도로 보고, 어려운 부분은 0.5배속으로 다시 들어보세요. 구간 끝에서 멈추며 반복은 직접 눌러요.</p>
    <div className="review-buttons" aria-label="발음 구간">
      {sections.map((item, index) => <button key={item.label} disabled={!enabled} aria-pressed={selected === index}
        onClick={() => { setSelected(index); onPlay(item.start, item.end); }}>{item.label} 듣기</button>)}
    </div>
    <div className="review-buttons" aria-label="재생 속도">
      {[1, .5].map(value => <button key={value} disabled={!enabled} aria-pressed={rate === value}
        onClick={() => onRate(value)}>{value === 1 ? '정상 속도' : '0.5배속'}</button>)}
    </div>
    {!enabled ? <p>저장된 연이 음성을 불러오면 사용할 수 있어요.</p> : <p className="review-hint">{section.hint}</p>}
    <details className="review-timing"><summary>선택 구간의 자동 정렬 보기</summary>
      <p>청취로 확정하기 전의 후보예요. 우형은 이 녹음의 /sʷ/ 둥글림이며, 독립된 ㅜ 모음 검증은 남아 있어요. 느린 재생은 경계를 찾는 용도이고 자연스러움은 정상 속도로 판단해 주세요.</p>
      <table><caption>{section.label} · 기존 음성 기준</caption><thead><tr><th scope="col">시각(초)</th><th scope="col">음소</th><th scope="col">입 모양</th></tr></thead>
        <tbody>{cues.map(cue => <tr key={cue.startMs}><td>{(cue.startMs / 1000).toFixed(2)}–{(cue.endMs / 1000).toFixed(2)}</td><td>{cue.phone}</td><td>{names[phoneViseme(cue.phone)]}</td></tr>)}</tbody></table>
    </details>
    <p className="review-pending">청취 확인 대기 · 어긋나 보이면 ‘어느 구간 / 입이 빠름·늦음 / 모양이 어색함’을 알려주세요.</p>
  </section>;
}
