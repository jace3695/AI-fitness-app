'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/app/lib/supabase';
import { FREE_CONVERSATIONS } from '@/data/freeConversation';
import { CONVERSATION_FOLLOWUPS, addConversationBookmark, matchesStarter, partnerPhrase, starterPhrase, type PracticePhrase, type Situation } from '@/app/data/freeConversationPractice';
import { japaneseAudioErrorMessage, speakJapaneseWithPreferredTts } from '@/utils/speakJapanese';

export default function FreeConversationPractice() {
  const [situation, setSituation] = useState<Situation>('일상');
  const [started, setStarted] = useState(false);
  const [choice, setChoice] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(true);
  const [saved, setSaved] = useState<string[]>([]);
  const owner = useRef<string | null>(null);
  const invalid = useRef(false);
  const audio = useRef<AbortController | null>(null);
  const audioEpoch = useRef(0);
  const saving = useRef(false);
  const mounted = useRef(false);
  const settings = useRef({ rate: 1, repeatCount: 1, repeatDelayMs: 500 });

  function stopAudio() {
    audioEpoch.current++;
    audio.current?.abort(); audio.current = null;
    setPlaying(null);
  }
  function reset() {
    stopAudio(); setStarted(false); setChoice(null); setInput(''); setNotice('');
  }
  useEffect(() => {
    mounted.current = true;
    const id = localStorage.getItem('language-cloud-sync-user');
    owner.current = id;
    const invalidate = () => {
      invalid.current = true; setBlocked(true); stopAudio();
      setStarted(false); setChoice(null); setInput(''); setSaved([]);
      setNotice('계정이 변경됐어요. 이 계정의 학습 기록을 준비하도록 페이지를 다시 열어 주세요.');
    };
    const client = supabase;
    const subscription = client?.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== owner.current) invalidate();
    }).data.subscription;
    void client?.auth.getUser().then(({ data, error }) => {
      if (!mounted.current || invalid.current) return;
      if (error || !id || data.user?.id !== id) invalidate();
      else setBlocked(false);
    }).catch(() => { if (mounted.current) invalidate(); });
    try {
      const all = JSON.parse(localStorage.getItem('japaneseAppSettings') || '{}');
      const s = { ...all, ...all.sections?.conversation };
      settings.current = {
        rate: typeof s.ttsRate === 'number' ? Math.min(1, Math.max(.8, s.ttsRate)) : 1,
        repeatCount: typeof s.repeatCount === 'number' ? Math.min(3, Math.max(1, Math.floor(s.repeatCount))) : 1,
        repeatDelayMs: typeof s.repeatDelayMs === 'number' ? Math.min(3000, Math.max(0, s.repeatDelayMs)) : 500,
      };
    } catch { /* Default device speech settings. */ }
    const leave = () => stopAudio();
    const visibility = () => { if (document.visibilityState === 'hidden') stopAudio(); };
    const storage = (event: StorageEvent) => { if (event.key === 'language-cloud-sync-user' && event.newValue !== id) invalidate(); };
    window.addEventListener('pagehide', leave); window.addEventListener('popstate', leave);
    window.addEventListener('storage', storage); document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false; audio.current?.abort(); subscription?.unsubscribe();
      window.removeEventListener('pagehide', leave); window.removeEventListener('popstate', leave);
      window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  async function speak(p: PracticePhrase) {
    if (blocked || invalid.current) return;
    stopAudio();
    const request = new AbortController(); audio.current = request;
    const ticket = audioEpoch.current; setPlaying(p.japanese);
    try { await speakJapaneseWithPreferredTts(p.japanese, { ...settings.current, signal: request.signal }); }
    catch (error) { if (mounted.current && ticket === audioEpoch.current && !request.signal.aborted) setNotice(japaneseAudioErrorMessage(error)); }
    finally { if (mounted.current && ticket === audioEpoch.current) { setPlaying(null); audio.current = null; } }
  }
  async function bookmark(p: PracticePhrase) {
    if (blocked || invalid.current || saving.current || !owner.current || !supabase) return;
    saving.current = true;
    const expected = owner.current;
    try {
      const { data, error } = await supabase.auth.getUser();
      if (!mounted.current || invalid.current) return;
      if (error || data.user?.id !== expected || localStorage.getItem('language-cloud-sync-user') !== expected) {
        invalid.current = true; setBlocked(true); stopAudio(); setNotice('계정을 다시 확인해 주세요. 복습 목록은 변경하지 않았어요.'); return;
      }
      const next = addConversationBookmark(localStorage.getItem('savedSentences'), situation, p);
      if (next.added) localStorage.setItem('savedSentences', JSON.stringify(next.entries));
      setSaved(old => old.includes(p.japanese) ? old : [...old, p.japanese]);
      setNotice(next.added ? '기기의 문장 복습 목록에 추가했어요. 서버 반영 상태는 학습 기록 안내에서 확인하세요.' : '이미 문장 복습 목록에 있어요.');
    } catch { if (mounted.current) setNotice('복습 목록을 저장하지 못했어요. 기존 기록은 그대로 두었어요.'); }
    finally { saving.current = false; }
  }
  function phraseCard(p: PracticePhrase, label: string) {
    return <article className="card" aria-label={label}>
      <h3>{label}</h3><p lang="ja">{p.japanese}</p><p lang="ja" className="muted">{p.reading}</p><p>{p.meaning}</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={blocked} onClick={() => void speak(p)}>{playing === p.japanese ? '처음부터 듣기' : '듣기'}</button>
        <button className="btn" disabled={blocked} onClick={() => void bookmark(p)}>{saved.includes(p.japanese) ? '복습 저장 확인' : '이 예문 복습에 저장'}</button>
      </div>
    </article>;
  }
  const followup = CONVERSATION_FOLLOWUPS[situation];
  return <section aria-label="상황별 고정 회화">
    <h1>상황별 회화 연습</h1>
    <p>준비된 예문과 선택지로 짧게 연습해요. 자유 생성 대화·문장 자동 교정·발음 채점은 하지 않아요.</p>
    <p className="muted">응답은 기기 안에서 고릅니다. 듣기는 기존 기기 음성을 사용하며, 자동으로 재생하지 않아요.</p>
    <label htmlFor="practice-situation">상황</label>{' '}
    <select id="practice-situation" value={situation} disabled={blocked} onChange={e => { reset(); setSituation(e.target.value as Situation); }}>
      {(Object.keys(FREE_CONVERSATIONS) as Situation[]).map(s => <option key={s}>{s}</option>)}
    </select>
    <div className="my-3 flex flex-wrap gap-2">
      <button className="btn" onClick={reset}>처음부터 다시 연습</button>
      <button className="btn" onClick={stopAudio} disabled={!playing}>음성 멈추기</button>
      <Link className="btn" href="/language/review" onClick={stopAudio}>저장한 문장 복습하기</Link>
    </div>
    <p role="status" aria-live="polite" style={{ minHeight: '6em' }}>{notice || '\u00a0'}</p>
    {blocked && <p>계정 확인 전에는 입력·듣기·복습 저장을 사용할 수 없어요.</p>}
    {phraseCard(starterPhrase(situation), '내가 먼저 하는 말')}
    {!started && <div className="card">
      <button className="btn" disabled={blocked} onClick={() => { stopAudio(); setStarted(true); setNotice(''); }}>이 예문으로 시작</button>
      <form onSubmit={e => { e.preventDefault(); if (blocked) return; stopAudio(); if (matchesStarter(situation, input)) { setStarted(true); setNotice(''); } else setNotice('이 입력은 준비된 예문과 다릅니다. 틀렸다는 뜻은 아니에요. 위 예문이나 읽는 법으로 연습하거나 시작 버튼을 눌러 주세요.'); }}>
        <label>예문 직접 입력<input type="text" className="w-full" value={input} disabled={blocked} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault(); }} /></label>
        <button className="btn" disabled={blocked || !input.trim()}>준비된 예문 확인</button>
      </form>
    </div>}
    {started && <>
      {phraseCard(partnerPhrase(situation), '상대방의 말')}
      <p>{FREE_CONVERSATIONS[situation].hint}</p>
      {choice === null ? <fieldset disabled={blocked}><legend>어떻게 답할까요? 뜻을 보고 골라요.</legend>
        {followup.choices.map((c, i) => <button key={c.say.japanese} className="btn m-1" onClick={() => { stopAudio(); setChoice(i); }}><span lang="ja">{c.say.japanese}</span> · {c.say.meaning}</button>)}
      </fieldset> : <>
        {phraseCard(followup.choices[choice].say, '내가 고른 답')}
        {phraseCard(followup.choices[choice].reply, '상대방의 마무리')}
        <p>이 짧은 대화를 연습했어요. 자동 점수나 학습 완료 기록은 만들지 않아요.</p>
        <button className="btn" onClick={() => { stopAudio(); setChoice(null); setNotice(''); }}>다른 답으로 연습</button>
      </>}
    </>}
  </section>;
}
