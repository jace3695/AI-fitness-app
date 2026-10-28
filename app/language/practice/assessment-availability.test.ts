import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import * as jsx from 'react/jsx-runtime';
import * as audio from './assessment-audio.ts';
import * as contract from './assessment.ts';
import * as trial from './assessment-trial.ts';
import { AssessmentBrowserClient, type AssessmentHttp } from './assessment-browser.ts';

// Component handlers and JSX plus the real WAV encoder, trial validator and
// browser client; React scheduling/native decoding/HTTP are mocked, NOT browser QA.
type Props = { recording: Blob | null; text: string; owner: string; request: AssessmentHttp };
type NodeProps = { children?: ReactNode; disabled?: boolean; checked?: boolean; role?: string };
type Controls = {
  prepare(): Promise<void>; review(): Promise<void>; checkService(): Promise<void>; send(): Promise<void>;
  interrupt(): void; setConsent(value: boolean): void;
  current: unknown; result: contract.AssessmentResult | null;
};
type Effect = { deps: readonly unknown[]; cleanup?: () => void };
const source = readFileSync(new URL('./AssessmentAvailability.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replace('  return <details', '  __capture({prepare,review,checkService,send,interrupt,setConsent,current,result});\n  return <details'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const readiness = () => Response.json({ available: true, providerId: 'azure-speech', policyVersion: audio.AZURE_AUDIO_POLICY_VERSION, region: 'koreacentral' });
const score = (id: string, accuracy = 81, fluency = 72) => Response.json({ requestId: id, providerId: 'azure-speech', language: 'ja-JP', source: 'provider-assessment', metrics: [{ name: 'accuracy', value: accuracy, min: 0, max: 100 }, { name: 'fluency', value: fluency, min: 0, max: 100 }] });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(done: () => boolean) { for (let i = 0; i < 100 && !done(); i++) await new Promise(resolve => setTimeout(resolve, 1)); assert.ok(done(), 'mock operation reached expected boundary'); }
function nodes(node: ReactNode): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return isValidElement<NodeProps>(node) ? [node, ...nodes(node.props.children)] : [];
}
function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(content).join('');
  return isValidElement<NodeProps>(node) ? content(node.props.children) : '';
}
function fixture(options: { text?: string; seconds?: number; holdDecode?: boolean; response?: (id: string) => Promise<Response> | Response } = {}) {
  const hooks: unknown[] = [], effects: Effect[] = [], pendingEffects: (() => void)[] = [];
  const windowListeners = new Map<string, (event: { key?: string }) => void>(), documentListeners = new Map<string, () => void>();
  let cursor = 0, effectCursor = 0, dirty = false, mounted = true, updatesAfterUnmount = 0, controls!: Controls, tree: ReactNode;
  let decodeRelease: (() => void) | undefined, decodes = 0, closes = 0, serial = 0;
  const calls: { method: string; signal: AbortSignal }[] = [];
  const request: AssessmentHttp = async (_path, init, _owner, signal) => {
    calls.push({ method: init.method!, signal });
    return init.method === 'GET' ? readiness() : (options.response?.(JSON.parse(String(init.body)).requestId) ?? score(JSON.parse(String(init.body)).requestId));
  };
  let props: Props = { recording: new Blob(['synthetic-container'], { type: 'audio/wav' }), text: options.text ?? trial.ASSESSMENT_TRIAL.referenceText, owner: 'synthetic-owner', request };
  const React = {
    useId: () => 'fixture-status',
    useState(initial: unknown) {
      const i = cursor++; if (!(i in hooks)) hooks[i] = initial;
      return [hooks[i], (value: unknown) => { if (!mounted) updatesAfterUnmount++; hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; dirty = true; }];
    },
    useRef(initial: unknown) { const i = cursor++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i]; },
    useCallback(callback: () => unknown, deps: readonly unknown[]) {
      const i = cursor++, previous = hooks[i] as { callback: () => unknown; deps: readonly unknown[] } | undefined;
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) hooks[i] = { callback, deps };
      return (hooks[i] as { callback: () => unknown }).callback;
    },
    useEffect(run: () => void | (() => void), deps: readonly unknown[]) {
      const i = effectCursor++, previous = effects[i];
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) pendingEffects.push(() => {
        previous?.cleanup?.(); const cleanup = run(); effects[i] = { deps, cleanup: cleanup || undefined };
      });
    },
  };
  const document = { visibilityState: 'visible', addEventListener: (name: string, callback: () => void) => documentListeners.set(name, callback), removeEventListener: (name: string) => documentListeners.delete(name) };
  class Decoder {
    async decodeAudioData() {
      decodes++; if (options.holdDecode) await new Promise<void>(resolve => { decodeRelease = resolve; });
      const length = Math.round((options.seconds ?? 1) * 16000);
      return { duration: length / 16000, sampleRate: 16000, length, numberOfChannels: 1, getChannelData: () => new Float32Array(length) };
    }
    async close() { closes++; }
  }
  const exported = {} as { default: (props: Props) => ReactNode };
  vm.runInNewContext(compiled, {
    exports: exported,
    require: (name: string) => {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return jsx;
      if (name === './assessment-audio') return audio;
      if (name === './assessment') return contract;
      if (name === './assessment-trial') return trial;
      if (name === './assessment-browser') return { AssessmentBrowserClient };
      throw Error(`Unexpected dependency ${name}`);
    },
    AbortController, AudioContext: Decoder, crypto: { randomUUID: () => `synthetic-${++serial}` }, document,
    window: { addEventListener: (name: string, callback: (event: { key?: string }) => void) => windowListeners.set(name, callback), removeEventListener: (name: string) => windowListeners.delete(name) },
    __capture: (value: Controls) => { controls = value; },
  });
  function render() {
    for (let i = 0; i < 5; i++) {
      dirty = false; cursor = 0; effectCursor = 0; tree = exported.default(props);
      for (const run of pendingEffects.splice(0)) run();
      if (!dirty) return;
    }
    throw Error('Fixture did not settle');
  }
  render();
  return {
    calls, get controls() { return controls; }, get decodes() { return decodes; }, get closes() { return closes; }, get text() { return content(tree); },
    get source() { return props.recording; }, get updatesAfterUnmount() { return updatesAfterUnmount; },
    get checkbox() { return nodes(tree).find(node => node.type === 'input'); },
    get alert() { return nodes(tree).find(node => node.props.role === 'alert'); },
    button(name: string) { const button = nodes(tree).find(node => node.type === 'button' && content(node) === name); assert.ok(button); return button; },
    summary() { return content(nodes(tree).find(node => node.type === 'summary')); },
    render, consent(value = true) { controls.setConsent(value); render(); },
    async prepare() { await controls.prepare(); render(); },
    async check() { await controls.checkService(); render(); },
    async ready() { await controls.prepare(); render(); controls.setConsent(true); render(); await controls.checkService(); render(); controls.setConsent(true); render(); },
    replace(next: Partial<Props>) { props = { ...props, ...next }; render(); },
    event(name: string, key?: string) { windowListeners.get(name)?.({ key }); render(); },
    hide() { document.visibilityState = 'hidden'; documentListeners.get('visibilitychange')?.(); render(); },
    finishDecode() { options.holdDecode = false; decodeRelease?.(); },
    unmount() { for (const effect of effects) effect.cleanup?.(); mounted = false; },
  };
}

test('actual preparation rejects unsupported sentence and over-five-second recording locally, retaining source for replay', async () => {
  for (const options of [{ text: 'おはよう。' }, { text: 'こんにちは' }, { text: ' '.repeat(1000) + 'こんにちは。' }, { seconds: 5.001 }]) {
    const f = fixture(options), original = f.source; await f.prepare();
    assert.equal(f.controls.current, null); assert.equal(f.checkbox, undefined); assert.equal(f.calls.length, 0); assert.equal(f.source, original);
    assert.match(f.text, /녹음은 보내지 않았어요|전송하지 않았어요/); assert.doesNotMatch(f.text, /평가 결과를 확인하지 못했어요/);
    assert.equal(f.button('발음 점수 받기 · 준비 중').props.disabled, true);
    if ('text' in options) assert.equal(f.decodes, 0); else { assert.match(f.text, /5초 이내/); assert.equal(f.closes, 1); }
    f.unmount();
  }
  const valid = fixture({ seconds: 5 }); await valid.prepare(); assert.ok(valid.controls.current); assert.equal(valid.checkbox?.props.checked, false); assert.equal(valid.calls.length, 0); valid.unmount();
});

test('readiness requires fresh consent; review does not claim service disconnected; validated result cannot be erased by check/review', async () => {
  const f = fixture(); await f.prepare(); f.consent(); await f.check();
  assert.equal(f.checkbox?.props.checked, false); assert.equal(f.button('발음 점수 받기').props.disabled, true);
  await f.controls.send(); assert.deepEqual(f.calls.map(call => call.method), ['GET']);
  f.consent(); await f.controls.review(); f.render();
  assert.match(f.text, /전송할 내용만 확인했어요. 녹음은 보내지 않았어요/); assert.doesNotMatch(f.text, /서비스 연결 전이라/);
  await f.controls.send(); f.render();
  assert.equal(f.summary(), '발음 평가 결과'); assert.match(f.text, /발음 정확도: 81 \/ 100/); assert.match(f.text, /말하기 흐름: 72 \/ 100/);
  assert.equal(f.checkbox?.props.checked, false); assert.equal(f.checkbox?.props.disabled, true);
  assert.equal(f.button('연결 준비 확인 · 음성 전송 안 함').props.disabled, true);
  assert.equal(f.button('전송할 내용 확인 · 전송 안 함').props.disabled, true);
  const result = f.controls.result; await f.controls.checkService(); await f.controls.review(); await f.controls.send(); f.render();
  assert.equal(f.controls.result, result); assert.deepEqual(f.calls.map(call => call.method), ['GET', 'POST']);
  await f.prepare(); assert.equal(f.controls.result, null); assert.equal(f.checkbox?.props.checked, false); f.unmount();
});

test('incomplete or failed provider response never presents scores, preserves no consent and does not retry', async () => {
  for (const response of [() => Response.json({ error: 'unavailable' }, { status: 503 }), (id: string) => Response.json({ requestId: id, providerId: 'azure-speech', language: 'ja-JP', source: 'provider-assessment', metrics: [{ name: 'accuracy', value: 81, min: 0, max: 100 }] })]) {
    const f = fixture({ response }); await f.ready(); await f.controls.send(); f.render();
    assert.equal(f.controls.result, null); assert.equal(f.checkbox?.props.checked, false); assert.match(f.text, /평가 결과를 확인하지 못했어요. 자동으로 다시 보내지 않아요/);
    assert.doesNotMatch(f.text, /발음 정확도:|말하기 흐름:/); await f.controls.send(); assert.equal(f.calls.filter(call => call.method === 'POST').length, 1); f.unmount();
  }
});

test('explicit or background cancellation retains uncertain processing warning and ignores late result without retry', async () => {
  for (const boundary of ['button', 'hidden']) {
    let finish!: () => void;
    const f = fixture({ response: id => new Promise(resolve => { finish = () => resolve(score(id)); }) }); await f.ready();
    const pending = f.controls.send(); f.render(); await until(() => !!finish);
    assert.match(f.text, /발음 평가를 요청하고 결과를 기다리고 있어요/);
    if (boundary === 'button') { f.controls.interrupt(); f.render(); } else { f.hide(); f.event('pagehide'); }
    assert.match(f.text, /이미 전달된 녹음의 처리 종료나 1회 시험 한도 복구를 보장하지 않아요/); assert.equal(f.controls.current, null); assert.equal(f.checkbox, undefined);
    assert.equal(f.calls.at(-1)?.signal.aborted, true); finish(); await pending; await tick(); f.render();
    assert.equal(f.controls.result, null); assert.match(f.text, /결과 기다리기를 멈췄어요/); assert.equal(f.calls.filter(call => call.method === 'POST').length, 1); f.unmount();
  }
});

test('local preparation cancellation states no transfer and late decode cannot restore preparation or consent', async () => {
  const f = fixture({ holdDecode: true }); const pending = f.controls.prepare(); f.render(); await until(() => f.decodes === 1);
  f.controls.interrupt(); f.render(); assert.match(f.text, /준비를 멈췄어요. 녹음은 보내지 않았어요/);
  f.finishDecode(); await pending; await tick(); f.render(); assert.equal(f.controls.current, null); assert.equal(f.checkbox, undefined); assert.equal(f.calls.length, 0); assert.equal(f.closes, 1); f.unmount();
});

test('recording/text/owner/session/storage/unmount boundaries clear consent and prevent stale score restoration', async () => {
  for (const boundary of ['recording', 'text', 'owner', 'request', 'session', 'storage', 'unmount']) {
    let finish!: () => void;
    const f = fixture({ response: id => new Promise(resolve => { finish = () => resolve(score(id)); }) }); await f.ready(); const pending = f.controls.send(); f.render(); await until(() => !!finish);
    if (boundary === 'recording') f.replace({ recording: new Blob(['replacement'], { type: 'audio/wav' }) });
    else if (boundary === 'text') f.replace({ text: 'おはよう。' });
    else if (boundary === 'owner') f.replace({ owner: 'replacement-owner' });
    else if (boundary === 'request') f.replace({ request: async () => { throw Error('new transport must not be called'); } });
    else if (boundary === 'session') f.event('yeoni-cloud-session-changed');
    else if (boundary === 'storage') f.event('storage', 'language-cloud-sync-user');
    else f.unmount();
    assert.equal(f.calls.at(-1)?.signal.aborted, true); finish(); await pending; await tick();
    if (boundary !== 'unmount') { f.render(); assert.equal(f.controls.current, null); assert.equal(f.controls.result, null); assert.equal(f.checkbox, undefined); assert.doesNotMatch(f.text, /발음 정확도:|말하기 흐름:/); f.unmount(); }
    assert.equal(f.updatesAfterUnmount, 0); assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  }
});


test('cancelled result cannot replace a newer explicitly prepared and requested assessment', async () => {
  const replies: Array<{ id: string; finish: (value: Response) => void }> = [];
  const f = fixture({ response: id => new Promise(resolve => { replies.push({ id, finish: resolve }); }) });
  try {
    await f.ready(); const previous = f.controls.send(); f.render();
    await until(() => replies.length === 1);
    f.controls.interrupt(); f.render(); await previous;
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(f.calls.at(-1)?.signal.aborted, true);
    assert.match(f.text, /1회 시험 한도 복구를 보장하지 않아요/);

    // This synthetic transport independently grants readiness again. It does not
    // assert that the real server's one-trial ledger would permit another request.
    await f.ready(); const next = f.controls.send(); f.render();
    await until(() => replies.length === 2);
    assert.notEqual(replies[0].id, replies[1].id);
    replies[1].finish(score(replies[1].id, 93, 88)); await next; f.render();
    const accepted = f.controls.result;
    assert.ok(accepted); assert.equal(accepted.requestId, replies[1].id);
    assert.match(f.text, /발음 정확도: 93 \/ 100/); assert.match(f.text, /말하기 흐름: 88 \/ 100/);
    replies[0].finish(score(replies[0].id)); await tick(); f.render();
    assert.equal(f.controls.result, accepted);
    assert.doesNotMatch(f.text, /발음 정확도: 81 \/ 100|말하기 흐름: 72 \/ 100/);
    assert.equal(f.summary(), '발음 평가 결과'); assert.equal(f.checkbox?.props.checked, false);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 2);
  } finally { f.unmount(); }
});

test('failed or malformed attempted request keeps uncertainty visible and cannot offer a duplicate-id retry', async () => {
  for (const response of [
    () => Response.json({ error: 'unavailable' }, { status: 503 }),
    () => new Response('{not-json', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response(null, { status: 200 }),
    () => Promise.reject(new Error('synthetic-network-failure')),
    (id: string) => Response.json({ requestId: id, providerId: 'azure-speech', language: 'ja-JP', source: 'provider-assessment', metrics: [] }),
  ]) {
    const f = fixture({ response });
    try {
      await f.ready(); const retained = f.controls; await retained.send(); f.render();
      assert.equal(f.controls.result, null);
      const failure = f.text;
      assert.match(failure, /평가 결과를 확인하지 못했어요/);
      assert.match(failure, /이미 전달된 녹음의 처리 종료를 뜻하지는 않아요/);
      assert.match(failure, /새로 준비해도 이전 요청의 처리 종료나 1회 시험 한도 복구를 뜻하지 않아요/);
      assert.equal(f.summary(), '발음 평가 결과 확인 필요');
      assert.match(content(f.alert), /평가 결과를 확인하지 못했어요/);
      assert.equal(f.checkbox?.props.disabled, true);
      assert.equal(f.button('전송할 내용 확인 · 전송 안 함').props.disabled, true);
      assert.equal(f.button('연결 준비 확인 · 음성 전송 안 함').props.disabled, true);
      assert.equal(f.button('발음 점수 받기 · 준비 중').props.disabled, true);
      // Even a retained or programmatic handler must not replace uncertainty with
      // "not sent" or create an unusable retry of the already-attempted identity.
      f.consent(); await f.controls.review(); await f.controls.checkService(); await f.controls.send();
      await retained.review(); await retained.checkService(); await retained.send(); f.render();
      assert.equal(f.text, failure);
      assert.deepEqual(f.calls.map(call => call.method), ['GET', 'POST']);
      assert.doesNotMatch(f.text, /발음 정확도:|말하기 흐름:/);
      // Preparation is still local. It does not grant readiness, send audio, or
      // claim that the real one-trial ledger or an uncertain request was reset.
      await f.prepare();
      assert.ok(f.controls.current); assert.equal(f.checkbox?.props.disabled, false);
      assert.equal(f.checkbox?.props.checked, false);
      assert.equal(f.button('발음 점수 받기 · 준비 중').props.disabled, true);
      assert.deepEqual(f.calls.map(call => call.method), ['GET', 'POST']);
      const preparedText = f.text, preparedNow = f.controls.current;
      await retained.review(); await retained.checkService(); await retained.send(); f.render();
      assert.equal(f.controls.current, preparedNow); assert.equal(f.text, preparedText);
      assert.deepEqual(f.calls.map(call => call.method), ['GET', 'POST']);
      // Only the synthetic transport grants a new readiness here; this says
      // nothing about whether the hosted one-trial ledger would allow it.
      f.consent(); await f.check(); f.consent(); const latest = f.controls;
      await latest.send(); f.render(); const latestFailure = f.text;
      await retained.review(); await retained.checkService(); await retained.send(); f.render();
      assert.equal(f.controls.current, preparedNow); assert.equal(f.text, latestFailure);
      assert.deepEqual(f.calls.map(call => call.method), ['GET', 'POST', 'GET', 'POST']);
      f.controls.interrupt(); f.render(); const interruptedText = f.text;
      await retained.review(); await retained.checkService(); await retained.send();
      await latest.review(); await latest.checkService(); await latest.send(); f.render();
      assert.equal(f.controls.current, null); assert.equal(f.text, interruptedText);
      assert.deepEqual(f.calls.map(call => call.method), ['GET', 'POST', 'GET', 'POST']);
    } finally { f.unmount(); }
  }
});
