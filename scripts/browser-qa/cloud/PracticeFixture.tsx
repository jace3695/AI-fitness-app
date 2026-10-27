import { useCallback, useEffect, useRef, useState } from 'react';
import PracticeWorkspace from '../../../app/language/practice/PracticeWorkspace';
import type { Transport } from '../../../app/language/practice/conversation';

/** Real workspace lifecycle and native tab storage; only the transport is synthetic.
 * No hosted Auth, account archive, provider request, or microphone is exercised. */
export default function PracticeFixture() {
  const [owner, setOwner] = useState('fixture-practice-a');
  const [mount, setMount] = useState(0);
  const [rerenders, setRerenders] = useState(0);
  const [metrics, setMetrics] = useState({ calls: 0, aborts: 0, held: false });
  const releaseResponse = useRef<(() => void) | null>(null);

  const transport = useCallback<Transport>((_request, signal) => {
    signal.throwIfAborted();
    if (releaseResponse.current) throw new Error('Release the previous synthetic response first');
    setMetrics(value => ({ ...value, calls: value.calls + 1, held: true }));
    return new Promise(resolve => {
      const onAbort = () => setMetrics(value => ({ ...value, aborts: value.aborts + 1 }));
      signal.addEventListener('abort', onAbort, { once: true });
      // Deliberately resolve after abort so the actual workspace must reject stale results.
      releaseResponse.current = () => {
        signal.removeEventListener('abort', onAbort);
        releaseResponse.current = null;
        setMetrics(value => ({ ...value, held: false }));
        resolve({ source: 'ai', reply: '合成応答です。', replyReading: 'ごうせいおうとうです。',
          correction: '合成の練習文です。', explanation: 'Synthetic fixture response only.' });
      };
    });
  }, []);
  useEffect(() => () => releaseResponse.current?.(), []);

  return <section aria-label="Synthetic practice lifecycle fixture">
    <p>This uses a held in-memory response and synthetic owner labels, not Google, hosted Auth, account storage, or a microphone.</p>
    <div aria-label="Practice fixture controls" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, marginBlock: 12 }}>
      <button type="button" onClick={() => setRerenders(value => value + 1)} style={{ minHeight: 44 }}>Rerender practice workspace</button>
      <button type="button" onClick={() => setMount(value => value + 1)} style={{ minHeight: 44 }}>Remount same practice owner</button>
      <button type="button" onClick={() => setOwner(value => value === 'fixture-practice-a' ? 'fixture-practice-b' : 'fixture-practice-a')} style={{ minHeight: 44 }}>Change synthetic practice owner</button>
      <button type="button" onClick={() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))} style={{ minHeight: 44 }}>Dispatch synthetic practice pagehide</button>
      <button type="button" disabled={!metrics.held} onClick={() => releaseResponse.current?.()} style={{ minHeight: 44 }}>Release mock practice response</button>
    </div>
    <output data-testid="practice-fixture-metrics" data-calls={metrics.calls} data-aborts={metrics.aborts}
      data-held={String(metrics.held)} data-owner={owner} data-rerenders={rerenders}>
      Synthetic requests: {metrics.calls}; aborts: {metrics.aborts}; parent rerenders: {rerenders}.
    </output>
    <div data-testid="practice-panel"><PracticeWorkspace key={`${owner}:${mount}`} owner={owner} transport={transport} /></div>
  </section>;
}
