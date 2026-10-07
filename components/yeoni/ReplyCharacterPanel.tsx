'use client';

import { useEffect, useId, useReducer, useRef, useState } from 'react';
import { updateYeoniPreferences, useYeoniPreferences } from '../useYeoniPreferences';
import { EMPTY_PLAYBACK } from '../../lib/yeoni/character-controller';
import { LipSyncPlayer } from '../../lib/yeoni/lip-sync-player';
import { ReplySession, type ReplyClip, type ReplyTransport } from '../../lib/yeoni/reply-session';
import { claimSpeechFocus, SPEECH_FOCUS_EVENT, SPEECH_STOP_EVENT } from '../../lib/yeoni/speech-focus';
import SwitchableCharacterStage from './SwitchableCharacterStage';
import styles from './reply-character.module.css';

const statusNames = { idle: '답변을 기다리고 있어요', waiting: '답변 준비 중', loading: '저장된 음성 확인 중', ready: '음성 준비 완료', 'text-only': '글로 답변했어요', error: '다시 확인해 주세요' };
const emotionNames = { neutral: '차분하게', smile: '미소로', happy: '기쁘게', proud: '뿌듯하게', encouraging: '응원하며', concerned: '걱정하며', surprised: '놀라며', thinking: '생각하며', serious: '진지하게', disappointed: '아쉬워하며', sleepy: '나른하게', comforting: '다정하게' };
export default function ReplyCharacterPanel({ transport, clips, samples, assets, incoming, busy = false, presentation = 'review' }: {
  transport?: ReplyTransport; clips: readonly ReplyClip[]; assets?: Record<string, string>;
  incoming?: Readonly<{ value: unknown }> | null;
  samples?: readonly Readonly<{ label: string; message: string }>[];
  busy?: boolean; presentation?: 'review' | 'assistant';
}) {
  const voiceId = useId();
  const embedded = presentation === 'assistant';
  const audio = useRef<HTMLAudioElement>(null), player = useRef<LipSyncPlayer | null>(null), session = useRef<ReplySession | null>(null);
  const [, refresh] = useReducer(value => value + 1, 0);
  const [input, setInput] = useState(''), [present, setPresent] = useState(true);
  const preferences = useYeoniPreferences();
  useEffect(() => {
    const media = new LipSyncPlayer(audio.current!, () => { session.current?.mediaChanged(); refresh(); });
    const next = new ReplySession(media, clips, refresh); player.current = media; session.current = next; refresh();
    const otherVoice = (event: Event) => { if ((event as CustomEvent<string>).detail !== voiceId) next.pause(); };
    const stop = () => next.pause();
    window.addEventListener(SPEECH_FOCUS_EVENT, otherVoice);
    window.addEventListener(SPEECH_STOP_EVENT, stop);
    return () => { window.removeEventListener(SPEECH_FOCUS_EVENT, otherVoice); window.removeEventListener(SPEECH_STOP_EVENT, stop);
      session.current = null; next.dispose(); media.dispose(); player.current = null; };
  }, [clips, voiceId]);
  useEffect(() => {
    if (incoming) void session.current?.submit('', async () => incoming.value);
    else session.current?.reset();
  }, [incoming, clips]);
  const current = session.current, state = current?.state;
  const speech = () => session.current?.snapshot() ?? { manifest: null, playback: EMPTY_PLAYBACK };
  function send(message: string) { if (message.trim() && transport) void session.current?.submit(message.trim(), transport); }
  const playing = player.current?.snapshot().state === 'playing';
  return <section aria-label="연이 대화 캐릭터" className={`${styles.panel} ${embedded ? styles.embedded : ''}`} data-reply-status={state?.status ?? 'idle'} data-speech-state={player.current?.state ?? 'empty'}>
    <div className={styles.toolbar}>
      <button onClick={() => { try { updateYeoniPreferences({ visible: true, motion: preferences.motion === 'home' ? 'off' : 'home' }); } catch { /* In-memory preference still applies. */ } }}>
        {preferences.motion === 'home' ? '움직임 끄기' : '움직임 켜기'}</button>
      <button onClick={() => { session.current?.reset(); setPresent(!present); }}>{embedded ? present ? '캐릭터 숨기기' : '캐릭터 보이기' : present ? '화면 나가기' : '돌아오기'}</button>
    </div>
    {present && <div className={styles.columns}>
      <div className={styles.portrait} data-reply-portrait><SwitchableCharacterStage speech={speech} emotion={state?.emotion}
        gesture={state?.gesture} assets={assets} /></div>
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
          {state?.status === 'waiting' && <button onClick={() => current?.reset()}>취소</button>}
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
