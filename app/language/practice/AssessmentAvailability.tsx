import { useId } from 'react';

/** Readiness information only. No credentials, transport, recording or score state. */
export default function AssessmentAvailability() {
  const reasonId = useId();
  return <details className="mt-3 rounded-xl border p-3">
    <summary className="cursor-pointer font-semibold" style={{ minHeight: 44 }}>발음 점수는 준비 중이에요</summary>
    <div className="space-y-2 pt-2 text-sm">
      <p>지금은 녹음해서 다시 듣고, 내 목소리 높낮이를 볼 수 있어요. 녹음은 채점 서비스로 보내지 않아요.</p>
      <p>준비하는 점수는 <strong>발음 정확도</strong>(소리가 얼마나 또렷한지)와 <strong>말하기 흐름</strong>(끊김이 얼마나 자연스러운지)이에요. 채점 서비스는 아직 연결하지 않았어요.</p>
      <p>일본어 억양은 점수를 매기지 않아요. 높낮이 그림도 일본어 억양의 정답이나 발음 점수가 아니에요.</p>
      <p>서비스가 연결되면, 어디로 보내는지 확인하고 동의한 녹음과 연습 문장만 보내도록 준비해요. 지금은 보낼 수 없어요.</p>
      <button type="button" className="btn" disabled aria-describedby={reasonId}>발음 점수 받기 · 준비 중</button>
      <p id={reasonId}>서비스 연결과 전송 안내가 준비된 뒤 사용할 수 있어요.</p>
    </div>
  </details>;
}
