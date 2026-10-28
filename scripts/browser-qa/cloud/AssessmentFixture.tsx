import { useCallback, useEffect, useRef, useState } from 'react';
import AssessmentAvailability from '../../../app/language/practice/AssessmentAvailability';
import { AZURE_AUDIO_POLICY_VERSION } from '../../../app/language/practice/assessment-audio';
import type { AssessmentHttp } from '../../../app/language/practice/assessment-browser';

/** Browser-only fixture. Generated sine bytes and injected in-memory responses only.
 * This does not model hosted Auth, Azure, quotas, microphone capture, or speech quality. */
function sineWav(seconds: 1 | 6): ArrayBuffer {
  const rate = 16000, samples = rate * seconds;
  const bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
  const tag = (at: number, value: string) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  tag(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index++) view.setInt16(44 + index * 2, Math.round(0.1 * Math.sin(2 * Math.PI * 220 * index / rate) * 32767), true);
  return bytes;
}

class SyntheticRecording extends Blob {
  constructor(seconds: 1 | 6, private onRead: () => void, private waitForBytes?: () => Promise<void>) {
    super([sineWav(seconds)], { type: 'audio/wav' });
  }
  override async arrayBuffer(): Promise<ArrayBuffer> {
    this.onRead();
    await this.waitForBytes?.();
    return super.arrayBuffer();
  }
}

type MockOutcome = 'success' | 'http-error' | 'malformed';
type Metrics = { inputReads: number; checks: number; posts: number; pendingAborts: number; localHeld: boolean; responseHeld: boolean; responseCount: number };
const initialMetrics: Metrics = { inputReads: 0, checks: 0, posts: 0, pendingAborts: 0, localHeld: false, responseHeld: false, responseCount: 0 };

export default function AssessmentFixture() {
  const [metrics, setMetrics] = useState(initialMetrics);
  const noteRead = useCallback(() => setMetrics(value => ({ ...value, inputReads: value.inputReads + 1 })), []);
  const [recording, setRecording] = useState<Blob>(() => new SyntheticRecording(1, noteRead));
  const [text, setText] = useState('こんにちは。');
  const [owner, setOwner] = useState('fixture-owner-a');
  const releaseBytes = useRef<(() => void) | null>(null);
  const releaseResponses = useRef<Array<(accuracy?: number, fluency?: number, outcome?: MockOutcome) => void>>([]);

  const request = useCallback<AssessmentHttp>(async (path, init, activeOwner, signal) => {
    signal.throwIfAborted();
    if (path !== '/api/language/assessment' || !['fixture-owner-a', 'fixture-owner-b'].includes(activeOwner)) throw new Error('Unexpected assessment fixture target');
    if (init.method === 'GET') {
      setMetrics(value => ({ ...value, checks: value.checks + 1 }));
      return Response.json({ available: true, providerId: 'azure-speech', policyVersion: AZURE_AUDIO_POLICY_VERSION, region: 'koreacentral' });
    }
    if (init.method !== 'POST' || typeof init.body !== 'string') throw new Error('Unexpected assessment fixture request');
    const body = JSON.parse(init.body) as { requestId?: unknown };
    if (typeof body.requestId !== 'string') throw new Error('Synthetic response needs the actual request identity');
    // Intentionally ignore cancellation until the visible release control is used:
    // real client/UI code must reject a late result after cancellation or owner change.
    return new Promise<Response>(resolve => {
      const onAbort = () => setMetrics(value => ({ ...value, pendingAborts: value.pendingAborts + 1 }));
      signal.addEventListener('abort', onAbort, { once: true });
      const release = (accuracy = 81, fluency = 72, outcome: MockOutcome = 'success') => {
        if (!releaseResponses.current.includes(release)) return;
        signal.removeEventListener('abort', onAbort);
        releaseResponses.current = releaseResponses.current.filter(pending => pending !== release);
        const remaining = releaseResponses.current.length;
        setMetrics(value => ({ ...value, responseHeld: remaining > 0, responseCount: remaining }));
        if (outcome === 'http-error') { resolve(Response.json({ error: 'synthetic-unavailable' }, { status: 503 })); return; }
        if (outcome === 'malformed') { resolve(new Response('{not-json', { headers: { 'Content-Type': 'application/json' } })); return; }
        resolve(Response.json({ requestId: body.requestId, providerId: 'azure-speech', language: 'ja-JP', source: 'provider-assessment',
          metrics: [{ name: 'accuracy', value: accuracy, min: 0, max: 100 }, { name: 'fluency', value: fluency, min: 0, max: 100 }] }));
      };
      releaseResponses.current.push(release);
      const held = releaseResponses.current.length;
      setMetrics(value => ({ ...value, posts: value.posts + 1, responseHeld: true, responseCount: held }));
    });
  }, []);

  const resetRecording = (seconds: 1 | 6) => {
    releaseBytes.current?.(); releaseBytes.current = null;
    setText('こんにちは。');
    setRecording(new SyntheticRecording(seconds, noteRead));
  };
  const holdRecording = () => {
    releaseBytes.current?.();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    releaseBytes.current = () => { release(); setMetrics(value => ({ ...value, localHeld: false })); };
    setText('こんにちは。');
    setRecording(new SyntheticRecording(1, noteRead, async () => {
      setMetrics(value => ({ ...value, localHeld: true }));
      await waiting;
    }));
  };
  useEffect(() => () => { releaseBytes.current?.(); releaseResponses.current.slice().forEach(release => release()); }, []);

  return <section aria-label="Synthetic assessment component fixture">
    <p>This fixture uses a generated sine and mock responses, not speech, a microphone, Azure, or hosted data.
      Mock readiness may be granted again here; this does not imply that a real one-trial ledger permits another request.</p>
    <div aria-label="Assessment fixture controls" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, marginBlock: 12 }}>
      <button type="button" onClick={() => setText('Synthetic wrong reference')} style={{ minHeight: 44 }}>Use wrong reference</button>
      <button type="button" onClick={() => resetRecording(6)} style={{ minHeight: 44 }}>Use six-second recording</button>
      <button type="button" onClick={() => resetRecording(1)} style={{ minHeight: 44 }}>Reset one-second recording</button>
      <button type="button" onClick={holdRecording} style={{ minHeight: 44 }}>Hold local recording bytes</button>
      <button type="button" disabled={!metrics.localHeld} onClick={() => { releaseBytes.current?.(); releaseBytes.current = null; }} style={{ minHeight: 44 }}>Release local recording bytes</button>
      <button type="button" disabled={!metrics.responseHeld} onClick={() => releaseResponses.current[0]?.()} style={{ minHeight: 44 }}>Release mock assessment response</button>
      <button type="button" disabled={!metrics.responseHeld} onClick={() => releaseResponses.current.at(-1)?.(93, 88)} style={{ minHeight: 44 }}>Release latest mock response with distinct scores</button>
      <button type="button" disabled={!metrics.responseHeld} onClick={() => releaseResponses.current.at(-1)?.(81, 72, 'http-error')} style={{ minHeight: 44 }}>Release mock HTTP failure</button>
      <button type="button" disabled={!metrics.responseHeld} onClick={() => releaseResponses.current.at(-1)?.(81, 72, 'malformed')} style={{ minHeight: 44 }}>Release malformed mock response</button>
      <button type="button" onClick={() => setOwner(value => value === 'fixture-owner-a' ? 'fixture-owner-b' : 'fixture-owner-a')} style={{ minHeight: 44 }}>Change synthetic owner</button>
    </div>
    <output data-testid="assessment-fixture-metrics" data-input-reads={metrics.inputReads} data-checks={metrics.checks} data-posts={metrics.posts}
      data-pending-aborts={metrics.pendingAborts} data-local-held={String(metrics.localHeld)} data-response-held={String(metrics.responseHeld)} data-response-count={metrics.responseCount}>
      Local input reads: {metrics.inputReads}; mock readiness checks: {metrics.checks}; mock posts: {metrics.posts}; pending aborts: {metrics.pendingAborts}.
    </output>
    <div data-testid="assessment-panel"><AssessmentAvailability recording={recording} text={text} owner={owner} request={request} /></div>
  </section>;
}
