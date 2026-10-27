'use client';

import { useCallback, useEffect, useId, useReducer, useRef, useState } from 'react';
import { updateYeoniPreferences, useYeoniPreferences } from '../useYeoniPreferences';
import { EMPTY_PLAYBACK } from '../../lib/yeoni/character-controller';
import { LipSyncPlayer } from '../../lib/yeoni/lip-sync-player';
import { ReplySession, type ReplyClip, type ReplyClipResolver, type ReplyTransport } from '../../lib/yeoni/reply-session';
import { parseReplyEnvelope } from '../../lib/yeoni/reply-plan';
import { claimSpeechFocus, SPEECH_FOCUS_EVENT, SPEECH_STOP_EVENT } from '../../lib/yeoni/speech-focus';
import SwitchableCharacterStage from './SwitchableCharacterStage';
import styles from './reply-character.module.css';
import { CHARACTER_RESET_EVENT, useCommonCharacterHost } from './CommonCharacterContext';

const statusNames = { idle: '답변을 기다리고 있어요', waiting: '답변 준비 중', loading: '저장된 음성 확인 중', ready: '음성 준비 완료', 'text-only': '글로 답변했어요', error: '다시 확인해 주세요' };
const emotionNames = { neutral: '차분하게', smile: '미소로', happy: '기쁘게', proud: '뿌듯하게', encouraging: '응원하며', concerned: '걱정하며', surprised: '놀라며', thinking: '생각하며', serious: '진지하게', disappointed: '아쉬워하며', sleepy: '나른하게', comforting: '다정하게' };
type IncomingReply = Readonly<{ value: unknown }>;
function replyIdentity(incoming: IncomingReply | null | undefined) {
  if (!incoming) return { id: null, fingerprint: null };
  try {
    const { reply, plan, notice } = parseReplyEnvelope(incoming.value);
    return { id: plan.responseId, fingerprint: JSON.stringify([reply, plan.language, plan.voice, plan.emotion, plan.gesture, notice]) };
  } catch { return { id: incoming, fingerprint: null }; } // Malformed input still reaches the session's existing error handling.
}
export default function ReplyCharacterPanel({ transport, clips, resolveClip, samples, assets, incoming, busy = false, presentation = 'review' }: {
  transport?: ReplyTransport; clips: readonly ReplyClip[]; resolveClip?: ReplyClipResolver; assets?: Record<string, string>;
  incoming?: IncomingReply | null;
  samples?: readonly Readonly<{ label: string; message: string }>[];
  busy?: boolean; presentation?: 'review' | 'assistant';
}) {
  const voiceId = useId();
  const commonHost = useCommonCharacterHost();
  const embedded = presentation === 'assistant';
  const audio = useRef<HTMLAudioElement>(null), player = useRef<LipSyncPlayer | null>(null), session = useRef<ReplySession | null>(null);
  const [, refresh] = useReducer(value => value + 1, 0);
  const [input, setInput] = useState(''), [present, setPresent] = useState(true);
  const preferences = useYeoniPreferences();
  const { id: incomingIdentity, fingerprint: incomingFingerprint } = replyIdentity(incoming);
  const latestIncoming = useRef(incomingIdentity), dismissedIncoming = useRef<typeof incomingIdentity>(null);
  const submittedIncoming = useRef<typeof incomingIdentity>(null);
  const acceptedIncoming = useRef<{ id: typeof incomingIdentity; fingerprint: string | null } | null>(null);
  latestIncoming.current = incomingIdentity;
  const resetReply = useCallback(() => {
    // Source replacement must not resurrect a reply cleared by route/account reset or hiding.
    if (latestIncoming.current !== null) dismissedIncoming.current = latestIncoming.current;
    submittedIncoming.current = null;
    session.current?.reset();
  }, []);
  useEffect(() => {
    const media = new LipSyncPlayer(audio.current!, () => { session.current?.mediaChanged(); refresh(); });
    const next = new ReplySession(media, clips, refresh, resolveClip); player.current = media; session.current = next; refresh();
    submittedIncoming.current = null;
    const otherVoice = (event: Event) => { if ((event as CustomEvent<string>).detail !== voiceId) next.pause(); };
    const stop = () => next.pause();
    const reset = () => { resetReply(); setInput(''); };
    window.addEventListener(SPEECH_FOCUS_EVENT, otherVoice);
    window.addEventListener(SPEECH_STOP_EVENT, stop);
    window.addEventListener(CHARACTER_RESET_EVENT, reset);
    return () => { window.removeEventListener(SPEECH_FOCUS_EVENT, otherVoice); window.removeEventListener(SPEECH_STOP_EVENT, stop);
      window.removeEventListener(CHARACTER_RESET_EVENT, reset);
      session.current = null; next.dispose(); media.dispose(); player.current = null; };
  }, [clips, voiceId, resolveClip, resetReply]);
  useEffect(() => {
    if (!preferences.visible || !present) { resetReply(); return; }
    if (!incoming || incomingIdentity === dismissedIncoming.current) {
      submittedIncoming.current = null; session.current?.reset();
    } else if (acceptedIncoming.current?.id === incomingIdentity && acceptedIncoming.current.fingerprint !== incomingFingerprint) {
      dismissedIncoming.current = incomingIdentity; submittedIncoming.current = null;
      void session.current?.submit('', async () => { throw new Error('같은 답변 식별자의 내용이 달라졌어요. 새 답변을 받아 주세요.'); });
    } else if (incomingIdentity !== submittedIncoming.current) {
      acceptedIncoming.current = { id: incomingIdentity, fingerprint: incomingFingerprint };
      submittedIncoming.current = incomingIdentity;
      void session.current?.submit('', async () => incoming.value);
    }
  }, [incoming, incomingIdentity, incomingFingerprint, clips, resolveClip, preferences.visible, present, resetReply]);
  const current = session.current, state = current?.state;
  const speech = () => session.current?.snapshot() ?? { manifest: null, playback: EMPTY_PLAYBACK };
  function send(message: string) { if (message.trim() && transport) void session.current?.submit(message.trim(), transport); }
  const playing = player.current?.snapshot().state === 'playing';
  useEffect(() => {
    if (!commonHost || !present || !preferences.visible) return;
    return commonHost.publish({ speech: () => session.current?.snapshot() ?? { manifest: null, playback: EMPTY_PLAYBACK },
      emotion: state?.emotion, gesture: state?.gesture });
  }, [commonHost, present, preferences.visible, state?.emotion, state?.gesture]);
  return <section aria-label="연이 대화 캐릭터" className={`${styles.panel} ${embedded ? styles.embedded : ''}`} data-common-host={!!commonHost} data-reply-status={state?.status ?? 'idle'} data-speech-state={player.current?.state ?? 'empty'}>
    <div className={styles.toolbar}>
      <button onClick={() => { try { updateYeoniPreferences({ visible: true, motion: preferences.motion === 'home' ? 'off' : 'home' }); } catch { /* In-memory preference still applies. */ } }}>
        {preferences.motion === 'home' ? '움직임 끄기' : '움직임 켜기'}</button>
      <button onClick={() => {
        resetReply();
        if (commonHost) { try { updateYeoniPreferences({ visible: !preferences.visible }); } catch { /* Memory fallback. */ } }
        else setPresent(!present);
      }}>{commonHost ? preferences.visible ? '캐릭터 숨기기' : '캐릭터 보이기' : embedded ? present ? '캐릭터 숨기기' : '캐릭터 보이기' : present ? '화면 나가기' : '돌아오기'}</button>
    </div>
    {present && <div className={styles.columns}>
      {!commonHost && <div className={styles.portrait} data-reply-portrait><SwitchableCharacterStage speech={speech} emotion={state?.emotion}
        gesture={state?.gesture} assets={assets} /></div>}
      <div className={styles.conversation}>
        <p className={styles.eyebrow}>연이의 답변</p>
        <div role="status" aria-live="polite" className={styles.status}>{busy ? statusNames.waiting : statusNames[state?.status ?? 'idle']}</div>
        {!embedded && state?.reply && <blockquote className={styles.reply} lang={state.plan?.language === 'ja-JP' ? 'ja' : 'ko'} data-reply-text>{state.reply}</blockquote>}
        {state?.plan && <p className={styles.tone} data-reply-tone>{emotionNames[state.plan.emotion]} 답해요</p>}
        {state?.status === 'text-only' && <p className={styles.hint}>{embedded ? '답변은 아래 대화에서 확인해 주세요. ‘답변 읽기’로 들을 때는 입 모양이 움직이지 않아요.' : '이 답변에 맞는 저장 음성이 없어요. 음성 준비 후 같은 문장으로 연결할 수 있어요.'}</p>}
        {state?.notice && <p role={state.status === 'error' ? 'alert' : 'status'} className={styles.hint}>{state.notice}</p>}
        {(!embedded || state?.status === 'ready') && <div className={styles.buttons}>
          <button disabled={busy || state?.status !== 'ready' || playing} onClick={() => { claimSpeechFocus(voiceId); void current?.play(); }}>답변 듣기</button>
          <button disabled={!playing} onClick={() => current?.pause()}>일시정지</button>
          <button disabled={state?.status !== 'ready'} onClick={() => current?.stop()}>처음으로</button>
          {state?.status === 'waiting' && <button onClick={resetReply}>취소</button>}
        </div>}
        {samples ? <div className={styles.samples} aria-label="저장된 답변 표본">{samples.map(item =>
          <button key={item.message} onClick={() => send(item.message)}>{item.label}</button>)}</div>
          : transport ? <form className={styles.form} onSubmit={event => { event.preventDefault(); send(input); setInput(''); }}>
            <label htmlFor="yeoni-reply-message">연이에게 질문하기</label>
            <textarea id="yeoni-reply-message" value={input} onChange={event => setInput(event.target.value)} maxLength={500} rows={3} />
            <button disabled={!input.trim() || state?.status === 'waiting'}>질문 보내기</button>
          </form> : null}
      </div>
    </div>}
    <audio ref={audio} preload="metadata" aria-label="연이 답변 음성" onPlay={() => claimSpeechFocus(voiceId)} />
  </section>;
}
