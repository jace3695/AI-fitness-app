import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ReplyCharacterPanel from '../../components/yeoni/ReplyCharacterPanel';
import { buildReplyPlan } from '../../lib/yeoni/reply-plan';
import { REPLY_SAMPLES, savedReplyClips } from '../../lib/yeoni/reply-samples';
import type { ReplyTransport } from '../../lib/yeoni/reply-session';
import ko from '../../docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3';
import ja from '../../docs/yeoni-voice-comparison/media/gemini-zephyr-ja-user.wav';
import './preview.css';

const clips = savedReplyClips({ ko, ja });
const assets = (window as Window & { HUMAN_OFFLINE_ASSETS?: Record<string, string> }).HUMAN_OFFLINE_ASSETS;
const samples = [
  { label: '한국어 · 다정한 답변', message: 'ko' },
  { label: '일본어 · 응원하는 답변', message: 'ja' },
  { label: '음성이 없는 새 답변', message: 'text' },
];
// Explicit offline fixtures, never presented as a live model response.
const transport: ReplyTransport = async message => {
  const reply = message === 'ko' ? REPLY_SAMPLES.ko.spokenText : message === 'ja' ? REPLY_SAMPLES.ja.spokenText
    : '안녕하세요. 오늘도 함께할게요. 준비된 음성이 없는 새 답변은 글로 보여드려요.';
  return { reply, performance: buildReplyPlan(reply, crypto.randomUUID()) };
};
createRoot(document.getElementById('root')!).render(<StrictMode><main className="reply-preview">
  <header><p className="phase">연이 · 13단계 연결 검토</p><h1>말에 맞춰,<br className="mobile-break" /> 표정도 함께</h1>
    <p className="intro">저장된 한국어·일본어 답변으로 표정과 입 움직임을 확인해 보세요.<br />‘움직임 켜기’ → 답변 선택 → ‘답변 듣기’ 순서입니다.</p></header>
  <ReplyCharacterPanel clips={clips} transport={transport} samples={samples} assets={assets} />
  <footer><b>저장된 표본으로 보는 미리보기</b><p>이 화면은 새 AI 답변이나 음성을 생성하지 않습니다. 기존 한국어와 선택하신 일본어 음성을 그대로 재생합니다.</p>
    <p>표정은 문장의 표현에 맞춘 간단한 규칙으로 고릅니다. 재생 중 모습을 바꿔도 같은 음성이 이어지고, 새 답변을 선택하면 이전 음성이 멈춥니다.</p></footer>
</main></StrictMode>);
