import { useCallback, useMemo, useRef, useState } from 'react';
import ReplyCharacterPanel from '../../../components/yeoni/ReplyCharacterPanel';
import { CHARACTER_RESET_EVENT } from '../../../components/yeoni/CommonCharacterContext';
import { parseLipSyncManifest } from '../../../lib/yeoni/lip-sync';
import { buildReplyPlan, matchesReplyClip } from '../../../lib/yeoni/reply-plan';
import type { ReplyClip, ReplyClipResolver } from '../../../lib/yeoni/reply-clip-source';
import timeline from '../../../docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json';

const manifest = parseLipSyncManifest(timeline);
const noInlineClips: readonly ReplyClip[] = Object.freeze([]);
const unknownText = '이 문장에 맞는 저장 음성은 등록하지 않았어요.';
type Incoming = { value: { reply: string; performance: ReturnType<typeof buildReplyPlan> } };
type Metrics = { resolutions: number; loads: number; aborts: number; releases: number };

/** Standalone real panel/media fixture. No provider, hosted account, or new alignment. */
export default function ReplyFixture() {
  const sequence = useRef(0);
  const held = useRef<Array<() => void>>([]);
  const [pending, setPending] = useState(0);
  const [metrics, setMetrics] = useState<Metrics>({ resolutions: 0, loads: 0, aborts: 0, releases: 0 });
  const [source, setSource] = useState({ generation: 0, hold: false });
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [mounted, setMounted] = useState(true);
  const count = useCallback((key: keyof Metrics) => {
    setMetrics(previous => ({ ...previous, [key]: previous[key] + 1 }));
  }, []);
  const clip = useMemo<ReplyClip>(() => ({
    manifest,
    async load(signal) {
      signal.throwIfAborted();
      count('loads');
      const response = await fetch('/saved-ko.mp3', { signal, cache: 'no-store', redirect: 'error' });
      if (!response.ok) throw new Error('Checked-in fixture audio unavailable');
      return { bytes: await response.arrayBuffer(), mime: 'audio/mpeg' };
    },
  }), [count]);
  const resolveClip = useMemo<ReplyClipResolver>(() => {
    // A new source object represents an actual resolver replacement, not a rerender.
    const hold = source.hold;
    return async (plan, signal) => {
      signal.throwIfAborted();
      count('resolutions');
      if (!matchesReplyClip(plan, manifest)) return null;
      if (!hold) return clip;
      const onAbort = () => count('aborts');
      signal.addEventListener('abort', onAbort, { once: true });
      return new Promise<ReplyClip>(resolve => {
        held.current.push(() => {
          signal.removeEventListener('abort', onAbort);
          // Intentionally deliver an old result after cancellation. The REAL
          // ReplySession must reject ownership before calling its audio loader.
          count('releases');
          resolve(clip);
        });
        setPending(held.current.length);
      });
    };
  }, [source, clip, count]);
  const submit = (reply: string) => {
    setIncoming({ value: { reply, performance: buildReplyPlan(reply, `fixture-${++sequence.current}`) } });
  };
  const replaceSource = (hold: boolean) => setSource(previous => ({ generation: previous.generation + 1, hold }));
  const releaseHeld = () => {
    const callbacks = held.current.splice(0);
    callbacks.forEach(release => release());
    setPending(0);
  };

  return <section aria-label="저장 답변 생명주기 검사">
    <h2>저장 답변 생명주기 · 독립 브라우저 검사</h2>
    <p>기존 한국어 39자 MP3만 사용합니다. 새 음성·정렬·외부 제공자 호출은 없습니다.
      재생과 소스 수명 검사이며, 청취·입 모양 자연스러움·인증된 앱 검수를 대신하지 않습니다.</p>
    <div className="flex flex-wrap gap-2" aria-label="검사 입력">
      <button type="button" onClick={() => submit(manifest.spokenText)}>저장 답변 전달</button>
      <button type="button" onClick={() => submit(unknownText)}>미등록 답변 전달</button>
      <button type="button" onClick={() => replaceSource(true)}>보류 소스로 바꾸기</button>
      <button type="button" onClick={() => replaceSource(false)}>즉시 소스로 바꾸기</button>
      <button type="button" disabled={!pending} onClick={releaseHeld}>늦은 소스 결과 전달</button>
      <button type="button" onClick={() => window.dispatchEvent(new Event(CHARACTER_RESET_EVENT))}>초기화 이벤트</button>
      <button type="button" onClick={() => { setIncoming(null); setMounted(value => !value); }}>
        {mounted ? '패널 제거' : '패널 다시 연결'}
      </button>
    </div>
    <output data-testid="reply-source-metrics" data-resolutions={metrics.resolutions} data-loads={metrics.loads}
      data-aborts={metrics.aborts} data-releases={metrics.releases} data-pending={pending}>
      소스 확인 {metrics.resolutions}회 · 파일 읽기 {metrics.loads}회 · 취소 {metrics.aborts}회 · 늦은 결과 {metrics.releases}회
    </output>
    {mounted ? <ReplyCharacterPanel clips={noInlineClips} resolveClip={resolveClip} incoming={incoming} /> : <p>검사 패널을 제거했어요.</p>}
  </section>;
}
