import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import * as jsx from 'react/jsx-runtime';
import { ReplySession, type ReplyClip, type ReplyClipResolver } from '../lib/yeoni/reply-session.ts';
import * as source from '../lib/yeoni/reply-clip-source.ts';
import * as plans from '../lib/yeoni/reply-plan.ts';
import { parseLipSyncManifest, type LipSyncManifest } from '../lib/yeoni/lip-sync.ts';
import { EMPTY_PLAYBACK, type PlaybackSnapshot } from '../lib/yeoni/character-controller.ts';

type Props = { clips: readonly ReplyClip[]; resolveClip?: ReplyClipResolver; incoming?: { value: unknown } | null };
type ElementProps = { children?: ReactNode; onClick?: () => void; disabled?: boolean; 'data-reply-status'?: string };
type Slot = { initialized?: boolean; value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
const koTimeline = JSON.parse(readFileSync(new URL('../docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json', import.meta.url), 'utf8'));
const jaTimeline = JSON.parse(readFileSync(new URL('../docs/yeoni-phase12/gemini-candidate/alignment/timeline.json', import.meta.url), 'utf8'));
const recording = Uint8Array.from(readFileSync(new URL('../docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3', import.meta.url))).buffer;
const savedAudio = {
  ko: Buffer.from(recording).toString('base64'),
  ja: readFileSync(new URL('../docs/yeoni-voice-comparison/media/gemini-zephyr-ja-user.wav', import.meta.url), 'base64'),
};
const clip: ReplyClip = { manifest: parseLipSyncManifest(koTimeline), async load() { return { bytes: recording.slice(0), mime: 'audio/mpeg' }; } };
const incoming = (id: string, text = koTimeline.spokenText) => ({ value: { reply: text, performance: plans.buildReplyPlan(text, id) } });
const empty: readonly ReplyClip[] = Object.freeze([]);
function compile(filename: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const output = { default: undefined as unknown };
  const code = ts.transpileModule(readFileSync(new URL(filename, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports: output, Error, ...globals, require: (name: string) => {
    assert.ok(name in dependencies, `unexpected dependency ${name}`); return dependencies[name];
  }, fetch: () => { throw new Error('No network in local reply-source integration'); } });
  return output;
}
function hookHarness() {
  const slots: Slot[] = []; const effects: (() => void)[] = []; let position = 0;
  const slot = () => slots[position++] ||= {};
  const memo = (value: unknown, deps: readonly unknown[]) => {
    const state = slot();
    if (!state.initialized || deps.some((entry, index) => !Object.is(entry, state.deps?.[index]))) {
      state.initialized = true; state.deps = deps; state.value = value;
    }
    return state.value;
  };
  const hooks = {
    useId: () => 'local-reply-panel',
    useRef(initial: unknown) { const state = slot(); if (!state.initialized) { state.initialized = true; state.value = { current: initial }; } return state.value; },
    useState(initial: unknown) {
      const state = slot(); if (!state.initialized) { state.initialized = true; state.value = initial; }
      return [state.value, (value: unknown) => { state.value = typeof value === 'function' ? (value as (previous: unknown) => unknown)(state.value) : value; }];
    },
    useReducer: () => [0, () => {}],
    useCallback: memo,
    useMemo(factory: () => unknown, deps: readonly unknown[]) {
      const state = slot();
      if (!state.initialized || deps.some((entry, index) => !Object.is(entry, state.deps?.[index]))) {
        state.initialized = true; state.deps = deps; state.value = factory();
      }
      return state.value;
    },
    useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
      const state = slot();
      if (!state.initialized || deps.some((entry, index) => !Object.is(entry, state.deps?.[index]))) {
        state.initialized = true; state.deps = deps;
        effects.push(() => { state.cleanup?.(); state.cleanup = effect() || undefined; });
      }
    },
  };
  return { hooks, render<T>(run: () => T) { position = 0; const result = run(); while (effects.length) effects.shift()!(); return result; },
    unmount() { slots.forEach(state => state.cleanup?.()); } };
}

/** Real panel/session and saved-source code; mocked hooks/media only. Not DOM/browser/decoding QA. */
function fixture() {
  const hooks = hookHarness(), assistantHooks = hookHarness(), events = new EventTarget();
  const preferences = { visible: true, motion: 'home' }; let decodes = 0, focusClaims = 0;
  const players: Player[] = [];
  class Player {
    manifest: LipSyncManifest | null = null; state: PlaybackSnapshot['state'] = 'empty'; message = '';
    loads = 0; plays = 0; disposed = false;
    constructor() { players.push(this); }
    async load(bytes: ArrayBuffer, input: unknown) { assert.deepEqual(bytes.byteLength > 0, true); this.loads++; this.manifest = parseLipSyncManifest(input); this.state = 'ready'; }
    reset() { this.manifest = null; this.state = 'empty'; }
    async play() { this.plays++; this.state = 'playing'; }
    pause() { if (this.manifest) this.state = 'paused'; }
    stop() { if (this.manifest) this.state = 'ready'; }
    snapshot(): PlaybackSnapshot { return { state: this.state, clipId: this.manifest?.audioSha256 ?? null, currentTimeMs: 0 }; }
    dispose() { this.disposed = true; this.reset(); }
  }
  const Panel = compile('../components/yeoni/ReplyCharacterPanel.tsx', {
    react: hooks.hooks, 'react/jsx-runtime': jsx,
    '../useYeoniPreferences': { useYeoniPreferences: () => preferences, updateYeoniPreferences: () => {} },
    '../../lib/yeoni/character-controller': { EMPTY_PLAYBACK },
    '../../lib/yeoni/lip-sync-player': { LipSyncPlayer: Player },
    '../../lib/yeoni/reply-session': { ReplySession }, '../../lib/yeoni/reply-plan': plans,
    '../../lib/yeoni/speech-focus': { claimSpeechFocus: () => { focusClaims++; }, SPEECH_FOCUS_EVENT: 'focus', SPEECH_STOP_EVENT: 'stop' },
    './SwitchableCharacterStage': { default: () => null }, './reply-character.module.css': {},
    './CommonCharacterContext': { CHARACTER_RESET_EVENT: 'reset', useCommonCharacterHost: () => null },
  }, { window: events }).default as (props: Props) => ReactNode;
  const samples = compile('../lib/yeoni/reply-samples.ts', {
    '../../docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json': koTimeline,
    '../../docs/yeoni-phase12/gemini-candidate/alignment/timeline.json': jaTimeline,
    './lip-sync.ts': { parseLipSyncManifest },
  }, { Uint8Array, atob: (value: string) => { decodes++; return atob(value); } });
  const Assistant = compile('../components/yeoni/AssistantCharacter.tsx', {
    react: assistantHooks.hooks, 'react/jsx-runtime': jsx,
    '@/lib/yeoni/reply-samples': samples, '@/lib/yeoni/reply-clip-source': source,
    './ReplyCharacterPanel': { default: Panel },
  }).default as (props: { audio: typeof savedAudio; incoming: Props['incoming']; busy: boolean }) => ReactElement<Props>;
  return { players, preferences, events,
    render: (props: Props) => hooks.render(() => Panel(props)),
    assistant: (audio = savedAudio, value: Props['incoming'] = null) => assistantHooks.render(() => Assistant({ audio, incoming: value, busy: false })).props,
    unmount: () => hooks.unmount(), decodes: () => decodes, claims: () => focusClaims };
}
function nodes(tree: ReactNode): ReactElement<ElementProps>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<ElementProps>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
}
function text(tree: ReactNode): string {
  if (typeof tree === 'string') return tree;
  if (Array.isArray(tree)) return tree.map(text).join('');
  return isValidElement<ElementProps>(tree) ? text(tree.props.children) : '';
}
function click(tree: ReactNode, label: string) {
  const button = nodes(tree).find(node => node.type === 'button' && text(node) === label);
  assert.ok(button, label); assert.equal(!!button.props.disabled, false); button.props.onClick?.();
}
const status = (tree: ReactNode) => nodes(tree)[0].props['data-reply-status'];
async function until(check: () => boolean) { for (let attempt = 0; attempt < 100 && !check(); attempt++) await new Promise(resolve => setTimeout(resolve, 1)); assert.ok(check()); }
function delayed() {
  let finish!: (value: ReplyClip | null) => void; let signal!: AbortSignal; let calls = 0;
  const resolver: ReplyClipResolver = async (_plan, input) => { calls++; signal = input; return new Promise(resolve => { finish = resolve; }); };
  return { resolver, finish: (value: ReplyClip | null) => finish(value), signal: () => signal, calls: () => calls };
}

test('actual assistant source loads only the exact already-saved pair once, never on mount or automatically plays', async () => {
  const f = fixture(), audio = { ...savedAudio };
  try {
    let props = f.assistant(audio); f.render(props);
    assert.equal(f.decodes(), 0); assert.equal(f.players[0].loads, 0); assert.equal(props.clips.length, 0); assert.ok(props.resolveClip);
    // The source owns the original inline string, not future caller mutations.
    audio.ko = 'corrupted-after-registration';
    for (const [id, timeline] of [['ko', koTimeline], ['ja', jaTimeline]] as const) {
      props = f.assistant(audio, incoming(id, timeline.spokenText)); f.render(props);
      await until(() => f.players[0].manifest?.language === timeline.language);
      assert.equal(f.players[0].manifest?.audioSha256, timeline.audioSha256);
      assert.equal(f.players[0].plays, id === 'ko' ? 0 : 1);
      assert.equal(status(f.render(props)), 'ready');
      if (id === 'ko') {
        click(f.render(props), '답변 듣기'); assert.equal(f.players[0].plays, 1); assert.equal(f.claims(), 1);
        props = f.assistant(audio, incoming(id, timeline.spokenText)); f.render(props);
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(f.decodes(), 1); assert.equal(f.players[0].loads, 1); assert.equal(f.players[0].state, 'playing');
      }
    }
    assert.equal(f.decodes(), 2); assert.equal(f.players[0].loads, 2);
    props = f.assistant(audio, incoming('ja', koTimeline.spokenText)); f.render(props);
    await until(() => status(f.render(props)) === 'error');
    assert.match(text(f.render(props)), /같은 답변 식별자의 내용이 달라졌어요/);
    assert.equal(f.players[0].manifest, null); assert.equal(f.decodes(), 2);
    // The rejected ID cannot revive its old payload through a fresh props object either.
    props = f.assistant(audio, incoming('ja', jaTimeline.spokenText)); f.render(props);
    assert.equal(status(f.render(props)), 'idle'); assert.equal(f.players[0].loads, 2);
    props = f.assistant(audio, incoming('new', '새 문장에 맞는 자료는 아직 없어요.')); f.render(props);
    await until(() => status(f.render(props)) === 'text-only');
    assert.equal(f.players[0].manifest, null); assert.equal(f.decodes(), 2);
  } finally { f.unmount(); }
});

test('panel source replacement disposes the old session, resubmits only current reply and ignores old completion', async () => {
  const f = fixture(), old = delayed(), current = delayed(), value = incoming('active');
  try {
    let props: Props = { clips: empty, resolveClip: old.resolver, incoming: value }; f.render(props);
    await until(() => old.calls() === 1);
    props = { ...props, resolveClip: current.resolver }; f.render(props);
    await until(() => current.calls() === 1);
    assert.equal(old.signal().aborted, true); assert.equal(f.players[0].disposed, true);
    old.finish(clip); current.finish(clip);
    await until(() => f.players[1].loads === 1);
    assert.equal(f.players[0].loads, 0); assert.equal(f.players[1].plays, 0); assert.equal(status(f.render(props)), 'ready');
  } finally { f.unmount(); }
});

test('panel ignores old response resolution and aborts outstanding work on unmount', async () => {
  for (const action of ['new-response', 'unmount'] as const) {
    const f = fixture(), old = delayed();
    try {
      const props: Props = { clips: empty, resolveClip: old.resolver, incoming: incoming('old') }; f.render(props);
      await until(() => old.calls() === 1);
      if (action === 'new-response') f.render({ ...props, incoming: incoming('new', 'Hello') });
      else f.unmount();
      assert.equal(old.signal().aborted, true); old.finish(clip);
      await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(f.players[0].loads, 0); assert.equal(f.players[0].plays, 0);
    } finally { f.unmount(); }
  }
});

test('reset and hide block cloned old request IDs after source replacement; same text with new request ID may load', async () => {
  for (const action of ['reset', 'hide', 'preference-hide'] as const) {
    const f = fixture(), old = delayed(); let resolutions = 0;
    const replacement: ReplyClipResolver = async () => { resolutions++; return clip; };
    try {
      let props: Props = { clips: empty, resolveClip: old.resolver, incoming: incoming('dismissed') };
      f.render(props); await until(() => old.calls() === 1);
      if (action === 'reset') f.events.dispatchEvent(new Event('reset'));
      else if (action === 'hide') click(f.render(props), '화면 나가기');
      else f.preferences.visible = false;
      f.render(props); assert.equal(old.signal().aborted, true);
      props = { ...props, incoming: incoming('dismissed'), resolveClip: replacement }; f.render(props);
      if (action === 'hide') click(f.render(props), '돌아오기');
      else f.preferences.visible = true;
      f.render(props); old.finish(clip);
      await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(resolutions, 0); assert.equal(f.players.reduce((sum, player) => sum + player.loads, 0), 0);
      assert.equal(status(f.render(props)), 'idle');
      props = { ...props, incoming: incoming('genuinely-new') }; f.render(props);
      await until(() => f.players.at(-1)?.loads === 1);
      assert.equal(resolutions, 1); assert.equal(f.players.at(-1)?.plays, 0);
    } finally { f.unmount(); }
  }
});
