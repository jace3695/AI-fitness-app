'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguageRecords } from './LanguageRecordsProvider.tsx';
import { isLanguageRecordContextCurrent, type LanguageRecordContext } from '../../app/data/languageCloudSync.ts';
import { readConversationSnapshot, captureConversationSession, captureConversationDraft, captureConversationAppend,
  captureConversationClose, captureConversationCancellation, captureConversationDeletion, runConversationEdit,
  stageConversationIntent, applyConversationIntent, reconcileConversationOperation, reconcileConversationEdit,
  conversationIntentOutcome, type ConversationSnapshot, type ConversationEditIntent, type ConversationCommandIntent,
  type ConversationWriteResult } from '../../app/data/conversationLocalRecords.ts';
import { CLOUD_SESSION_CHANGED_EVENT, RECORDS_CHANGED_EVENT } from '../../app/data/storageTransaction.ts';
import { RECORD_RESET_EVENT } from '../../app/data/appRecordReset.ts';
import { CONVERSATION_LIMITS, exact, sourceRef, supportedSource, type ConversationDraft, type ConversationSession } from '../../lib/conversation-session/contracts.ts';

type Exposure = ConversationDraft['exposure'];
type Editor = { input: string; version: number; draftId: string; origin: ConversationDraft['origin']; exposure: Exposure;
  expected: ConversationDraft | null; dirty: boolean };
type Action = { type: 'edit'; intent: ConversationEditIntent; editor?: Editor; draft?: ConversationDraft; context: LanguageRecordContext }
  | { type: 'command'; intent: ConversationCommandIntent; context: LanguageRecordContext };
type Deletion = { source: ConversationSnapshot; sessionId: string; label: string; intent: ConversationEditIntent };
type Discard = { editor: Editor; scope: string | null };
type State = { discard: Discard | null; exposures: Map<string, Exposure>; source: ConversationSnapshot | null; scope: string | null; initialized: boolean; sessionId: string | null;
  editor: Editor | null; exposure: Exposure; action: Action | null; busy: boolean; uncertain: boolean; error: string | null;
  deletion: Deletion | null; serial: number; missing: boolean };
const mergeExposure = (...values: Exposure[]): Exposure => Object.fromEntries((['example', 'reading', 'meaning', 'hint'] as const).map(key => [key, values.some(value => value[key] === 'shown') ? 'shown' : values.some(value => value[key] === 'unknown') ? 'unknown' : 'not-shown'])) as Exposure;
const blankExposure = (): Exposure => ({ example: 'not-shown', reading: 'not-shown', meaning: 'not-shown', hint: 'not-shown' });
const scopeOf = (source: ConversationSnapshot) => JSON.stringify([source.context.userId, source.context.epoch, source.observation.marker, source.envelope?.generationId ?? null]);
const pendingAt = (session?: ConversationSession | null) => session?.operations.find(operation => !operation.terminal)?.command ?? null;
const blankEditor = (exposure: Exposure): Editor => ({ input: '', version: 0, draftId: crypto.randomUUID(), origin: { kind: 'typed', edited: false }, exposure: { ...exposure }, expected: null, dirty: false });
const fromDraft = (draft: ConversationDraft): Editor => ({ input: draft.input, version: 0, draftId: draft.draftId, origin: { ...draft.origin }, exposure: { ...draft.exposure }, expected: draft, dirty: false });
const message = (error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'capacity-exceeded') return '이 브라우저의 대화 저장 한도에 도달했어요. 입력을 보존했습니다. 필요한 대화를 확인한 뒤 직접 삭제해 주세요.';
  if (code === 'stale-source' || code === 'conflict' || code === 'pinned-draft') return '다른 저장이나 창에서 원본이 바뀌었어요. 입력을 보존했습니다. 저장 상태와 보류 입력을 확인해 주세요.';
  return '기기 저장을 확인하지 못했어요. 입력을 보존했습니다. 저장 다시 확인을 선택해 주세요.';
};
const isUnknown = (error: unknown) => Boolean(error && typeof error === 'object' && 'outcome' in error && error.outcome === 'unknown');

/** One UI importer of the registered facade. No storage, provider, notification
 * payload or re-created authority is available here. All old-intent recovery is read-only. */
export function useConversationSession() {
  const access = useLanguageRecords(), live = useRef(access); live.current = access;
  const [, render] = useState(0), mounted = useRef(true);
  const state = useRef<State>({ discard: null, exposures: new Map(), source: null, scope: null, initialized: false, sessionId: null, editor: null,
    exposure: blankExposure(), action: null, busy: false, uncertain: false, error: null, deletion: null, serial: 0, missing: false });
  const s = state.current;
  const update = () => { if (mounted.current) render(value => value + 1); };
  const clear = () => { s.serial++; s.discard = null; s.exposures.clear(); s.source = null; s.scope = null; s.sessionId = null; s.editor = null; s.exposure = blankExposure(); s.action = null; s.busy = false; s.uncertain = false; s.deletion = null; s.error = null; s.missing = false; s.initialized = true; };
  const selected = (source = s.source) => source?.envelope?.sessions.find(item => item.sessionId === s.sessionId) ?? null;
  const choose = (session: ConversationSession | null) => {
    if (s.sessionId) s.exposures.set(s.sessionId, { ...s.exposure });
    s.sessionId = session?.sessionId ?? null; s.exposure = session ? mergeExposure(blankExposure(), s.exposures.get(session.sessionId) ?? blankExposure(), ...session.drafts.map(draft => draft.exposure), ...session.turns.map(turn => turn.draft.exposure)) : blankExposure(); s.deletion = null; s.discard = null; s.missing = false;
    const pending = pendingAt(session), pinned = pending?.kind === 'append' ? pending.turn.draft.draftId : null;
    const draft = session?.drafts.find(item => item.draftId !== pinned) ?? session?.drafts[0];
    s.editor = session && !session.closed && supportedSource(session.source) ? draft ? fromDraft(draft) : blankEditor(s.exposure) : null;
    // Restored exposure is historical. Newly displayed facts are added only by the page effect.
    if (s.editor) { s.exposure = mergeExposure(s.exposure, s.editor.exposure); s.editor.exposure = { ...s.exposure }; if (s.editor.expected && !exact(s.editor.expected.exposure, s.exposure)) s.editor.dirty = true; }
  };
  const acceptRead = (source: ConversationSnapshot) => {
    const scope = scopeOf(source);
    if (s.scope !== null && s.scope !== scope) {
      const enrolling = s.action?.type === 'edit' && s.action.intent.kind === 'create' && !s.source?.envelope
        && s.source?.context.userId === source.context.userId && s.source.context.epoch === source.context.epoch
        && s.source.observation.marker === source.observation.marker;
      if (enrolling) { s.scope = scope; s.source = source; return; }
      // A missing partition is never interpreted as successful empty history or
      // silently recreated. Retain its unsaved in-memory input, but fence all writes.
      const old = s.source;
      if (old?.context.userId === source.context.userId && old.context.epoch === source.context.epoch
        && old.observation.marker === source.observation.marker && (old.envelope || s.missing) && !source.envelope) {
        s.source = source; s.missing = true; s.deletion = null; return;
      }
      clear();
    }
    s.scope = scope; s.source = source;
    if (!s.initialized) {
      s.initialized = true;
      choose(source.envelope?.sessions.filter(item => !item.closed).at(-1) ?? null);
    }
    s.missing = Boolean(s.sessionId && !selected(source));
    if (s.missing) { s.deletion = null; if (s.editor) s.editor.dirty = true; }
    const editor = s.editor, currentSession = selected(source);
    if (editor?.expected && currentSession && !s.busy && !s.action && !exact(currentSession.drafts.find(item => item.draftId === editor.draftId) ?? null, editor.expected)) {
      editor.dirty = true; s.error = '다른 창에서 이 입력의 원본이 바뀌었어요. 현재 입력을 보존했으며 자동으로 덮어쓰지 않습니다.';
    }
    if (currentSession?.closed && s.editor && !s.editor.dirty) s.editor = null;
    if (s.deletion) {
      const before = s.deletion.source.envelope?.sessions.find(item => item.sessionId === s.deletion!.sessionId);
      const now = source.envelope?.sessions.find(item => item.sessionId === s.deletion!.sessionId);
      if (!before || !now || !exact(before, now)) s.deletion = null;
    }
  };
  const read = (allowMissingRecovery = false): ConversationSnapshot => {
    const context = access.context;
    if (s.serial !== renderSerial || live.current.context !== context || !context || !isLanguageRecordContextCurrent(context)) throw new Error('unavailable');
    const source = readConversationSnapshot(context); acceptRead(source);
    if (s.missing && !allowMissingRecovery || s.serial !== renderSerial || s.scope !== renderScope || s.sessionId !== renderSessionId) throw new Error('missing-or-retired');
    return source;
  };
  let available = false;
  try { if (access.context && isLanguageRecordContextCurrent(access.context)) { acceptRead(readConversationSnapshot(access.context)); available = true; } }
  catch { /* The fixed unavailable label never exposes raw storage/host errors. */ }

  const renderSerial = s.serial, renderScope = s.scope, renderSessionId = s.sessionId, renderSession = selected();
  const bound = () => Boolean(mounted.current && s.serial === renderSerial && s.scope === renderScope && s.sessionId === renderSessionId && access.context && live.current.context === access.context && isLanguageRecordContextCurrent(access.context));

  useEffect(() => {
    mounted.current = true;
    const refresh = () => update();
    const retire = () => { clear(); update(); };
    // Native StorageEvent oldValue/newValue are never inspected, copied or forwarded.
    const storage = (_event: StorageEvent) => { void _event; update(); };
    const unload = (event: BeforeUnloadEvent) => {
      if (s.editor?.dirty || s.busy || s.action || pendingAt(selected())) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('storage', storage);
    window.addEventListener(RECORDS_CHANGED_EVENT, refresh);
    window.addEventListener(CLOUD_SESSION_CHANGED_EVENT, retire);
    window.addEventListener(RECORD_RESET_EVENT, retire);
    window.addEventListener('beforeunload', unload);
    for (const event of ['pagehide', 'pageshow']) window.addEventListener(event, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      mounted.current = false; s.serial++;
      window.removeEventListener('storage', storage); window.removeEventListener(RECORDS_CHANGED_EVENT, refresh);
      window.removeEventListener(CLOUD_SESSION_CHANGED_EVENT, retire); window.removeEventListener(RECORD_RESET_EVENT, retire);
      window.removeEventListener('beforeunload', unload);
      for (const event of ['pagehide', 'pageshow']) window.removeEventListener(event, refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
    // This mount-lifetime listener reads the stable state/ref, never a rendered source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const signal = access.context?.signal, refresh = () => update();
    signal?.addEventListener('abort', refresh); return () => signal?.removeEventListener('abort', refresh);
  }, [access.context]);

  const currentAfter = (result: ConversationWriteResult, serial: number, context: LanguageRecordContext) => {
    if (!mounted.current || s.serial !== serial || live.current.context !== context || !isLanguageRecordContextCurrent(context)
      || !result.acknowledged || !result.source) return false;
    s.source = result.source; s.scope = scopeOf(result.source); return true;
  };
  const finishDraft = (draft: ConversationDraft, editor: Editor) => {
    if (s.editor?.draftId !== draft.draftId) return;
    // Only our exact predecessor may advance this lane's expected dependency.
    s.editor = { ...s.editor, expected: draft, dirty: s.editor.version !== editor.version };
  };
  const runEdit = async (intent: ConversationEditIntent, context: LanguageRecordContext, detail: { editor?: Editor; draft?: ConversationDraft } = {}) => {
    if (s.busy || s.action) return false;
    const action: Action = { type: 'edit', intent, context, ...detail }, serial = s.serial;
    s.action = action; s.busy = true; s.error = null; update();
    try {
      const result = await runConversationEdit(intent);
      if (!currentAfter(result, serial, context)) { if (s.serial === serial) s.uncertain = true; return false; }
      if (detail.draft && detail.editor) finishDraft(detail.draft, detail.editor);
      s.action = null; s.uncertain = false;
      return result;
    } catch (error) {
      if (s.serial === serial) { s.uncertain = isUnknown(error); s.error = message(error); if (!s.uncertain) s.action = null; }
      return false;
    } finally { if (s.serial === serial) { s.busy = false; update(); } }
  };
  const headView = (session: ConversationSession | null) => session ? { sessionId: session.sessionId, headRevision: session.headRevision, source: session.source, closed: session.closed, pending: pendingAt(session), turnRefs: session.turns.map(turn => ({ turnId: turn.turnId, turnRevision: turn.turnRevision })) } : null;
  const editorView = (editor: Editor | null) => editor ? { draftId: editor.draftId, version: editor.version, input: editor.input, origin: { ...editor.origin }, exposure: { ...editor.exposure } } : null;
  const editorSavedAt = (session: ConversationSession | null) => {
    const editor = s.editor;
    if (!editor) return true;
    if (!session || editor.dirty) return false;
    const actual = session.drafts.find(item => item.draftId === editor.draftId) ?? null;
    return exact(actual, editor.expected) && (actual ? actual.input === editor.input && exact(actual.origin, editor.origin)
      && exact(actual.exposure, editor.exposure) && exact(actual.source, sourceRef(session.source)) : editor.input === '');
  };
  const navigationSafeAt = (source: ConversationSnapshot) => !s.busy && !s.action && !s.uncertain && !s.missing
    && !pendingAt(selected(source)) && editorSavedAt(selected(source));
  const changedBeforeAction = () => { s.error = '저장 확인 중 원본이나 입력이 바뀌었어요. 현재 입력을 보존했습니다. 다시 확인한 뒤 선택해 주세요.'; update(); return false; };
  const save = async (): Promise<boolean> => {
    if (s.busy || s.action || s.deletion) return false;
    try {
      const source = read(), session = selected(source), editor = s.editor;
      if (!session || session.closed || !supportedSource(session.source) || !editor) return false;
      if (!editor.dirty) return true;
      if (editor.input.length > CONVERSATION_LIMITS.inputCodeUnits) { s.error = '입력은 8,000자까지 저장할 수 있어요. 입력을 자르지 않고 보존했습니다.'; update(); return false; }
      const actual = session.drafts.find(item => item.draftId === editor.draftId) ?? null;
      if (!exact(actual, editor.expected)) { s.error = '다른 창에서 이 입력이 바뀌었어요. 현재 입력을 보존했으며 원본을 덮어쓰지 않았습니다.'; update(); return false; }
      const pending = pendingAt(session);
      if (pending?.kind === 'append' && pending.turn.draft.draftId === editor.draftId) return false;
      const frozenEditor = { ...editor, origin: { ...editor.origin }, exposure: { ...editor.exposure } };
      const draft: ConversationDraft = { draftId: editor.draftId, revision: (actual?.revision ?? 0) + 1, savedAt: new Date().toISOString(),
        input: editor.input, source: sourceRef(session.source), origin: { ...editor.origin }, exposure: { ...editor.exposure } };
      const intent = captureConversationDraft(source, session.sessionId, draft);
      const result = await runEdit(intent, source.context, { editor: frozenEditor, draft });
      if (!result) return false;
      // An acknowledgment can be overtaken before this await resumes. Prove the
      // exact saved lane again; a peer's later value is never our acknowledgment.
      const fresh = read(), current = selected(fresh);
      if (!current || !exact(current.source, session.source) || !exact(current.drafts.find(item => item.draftId === draft.draftId) ?? null, draft)) return changedBeforeAction();
      return true;
    } catch (error) { s.error = message(error); update(); return false; }
  };
  const preserve = async () => {
    const visibleHead = headView(renderSession);
    if (s.busy || s.action || s.uncertain || s.missing || pendingAt(selected())) { s.error = '보류된 저장을 먼저 확인해 주세요. 현재 화면과 입력을 유지합니다.'; update(); return false; }
    if (s.editor?.dirty) {
      if (!await save()) return false;
      if (s.editor?.dirty || !bound()) { s.error = '저장 중에 입력이 바뀌었어요. 새 입력을 저장한 뒤 이동해 주세요.'; update(); return false; }
    }
    try { const source = read(); return navigationSafeAt(source) && exact(headView(selected(source)), visibleHead) || changedBeforeAction(); } catch { s.error = '현재 저장 상태를 확인한 뒤 이동해 주세요.'; update(); return false; }
  };
  const type = (input: string, inserted = false) => {
    try {
      const source = read(), session = selected(source);
      if (!session || session.closed || !supportedSource(session.source) || s.deletion || s.discard || s.action?.type === 'edit' && (s.action.intent.kind === 'create' || s.action.intent.kind === 'delete') || s.action?.type === 'command' && s.action.intent.command.kind === 'close') return;
      let editor = s.editor ?? blankEditor(s.exposure);
      const pending = pendingAt(session) ?? (s.action?.type === 'command' ? s.action.intent.command : null);
      if (pending?.kind === 'append' && editor.draftId === pending.turn.draft.draftId) {
        // Never replace an occupied other lane implicitly. When both persisted
        // lanes are occupied this new in-memory lane remains unsaved at the cap.
        editor = blankEditor(s.exposure);
      }
      if (inserted) s.exposure = { ...s.exposure, example: 'shown' };
      const origin: ConversationDraft['origin'] = inserted ? { kind: 'inserted-example', edited: false }
        : editor.origin.kind === 'inserted-example' ? { kind: 'inserted-example', edited: editor.origin.edited || input !== editor.input } : { kind: 'typed', edited: false };
      s.editor = { ...editor, input, origin, version: editor.version + 1, dirty: true, exposure: { ...s.exposure, ...(inserted ? { example: 'shown' as const } : {}) } };
      s.error = null; update();
      // Captured immediately while idle. N+1 typed during N is intentionally left
      // visibly unsaved for a new explicit save, never rebound on N's acknowledgement.
      if (!s.busy && !s.action && !s.uncertain) void save();
    } catch { /* A stale event handler cannot write or revive a retired editor. */ }
  };
  const command = async (kind: 'append' | 'close'): Promise<boolean> => {
    if (s.busy || s.action || s.uncertain || s.deletion) return false;
    try {
      let source = read(), session = selected(source);
      if (!session || session.closed || !supportedSource(session.source) || pendingAt(session)) return false;
      if (!exact(headView(session), headView(renderSession))) return changedBeforeAction();
      const visible = editorView(s.editor), sessionId = session.sessionId, headRevision = session.headRevision, turnRefs = session.turns.map(turn => ({ turnId: turn.turnId, turnRevision: turn.turnRevision })), frozenSource = session.source, context = source.context;
      if (kind === 'append' && !s.editor?.input.trim()) return false;
      if (s.editor?.dirty && !await save()) return false;
      if (live.current.context !== context || !exact(editorView(s.editor), visible)) return changedBeforeAction();
      source = read(); session = selected(source);
      // This read may itself detect a competing save. Recheck AFTER it and
      // before capture, including the visible head and all draft provenance.
      if (!session || session.closed || session.sessionId !== sessionId || session.headRevision !== headRevision
        || !exact(session.turns.map(turn => ({ turnId: turn.turnId, turnRevision: turn.turnRevision })), turnRefs)
        || !exact(session.source, frozenSource) || pendingAt(session) || !exact(editorView(s.editor), visible)
        || !editorSavedAt(session)) return changedBeforeAction();
      const intent = kind === 'append' ? captureConversationAppend(source, session.sessionId, s.editor!.draftId) : captureConversationClose(source, session.sessionId);
      const serial = s.serial, action: Action = { type: 'command', intent, context };
      s.action = action; s.busy = true; s.error = null; update();
      try {
        const staged = await stageConversationIntent(intent);
        if (!currentAfter(staged, serial, context)) { if (s.serial === serial) s.uncertain = true; return false; }
        const applied = await applyConversationIntent(intent);
        if (!currentAfter(applied, serial, context)) { if (s.serial === serial) s.uncertain = true; return false; }
        if (applied.effect.kind !== 'applied') { s.uncertain = true; return false; }
        if (intent.command.kind === 'append' && s.editor?.draftId === intent.command.turn.draft.draftId) s.editor = blankEditor(s.exposure);
        if (kind === 'close') s.editor = null;
        s.action = null; s.uncertain = false; return true;
      } catch (error) {
        if (s.serial === serial) {
          const outcome = conversationIntentOutcome(intent);
          s.error = message(error); s.uncertain = isUnknown(error) || outcome.stage === 'committed';
          if (outcome.stage === 'created' || outcome.stage === 'not-committed') s.action = null;
        }
        return false;
      } finally { if (s.serial === serial) { s.busy = false; update(); } }
    } catch (error) { s.error = message(error); update(); return false; }
  };
  const start = async (scriptId: string): Promise<boolean> => {
    if (!await preserve() || s.editor?.dirty || !bound()) return false;
    try {
      const source = read(); if (!navigationSafeAt(source) || !exact(headView(selected(source)), headView(renderSession))) return changedBeforeAction();
      const intent = captureConversationSession(source, scriptId, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'), serial = s.serial;
      const result = await runEdit(intent, source.context);
      if (!result) return false;
      // Creation may enroll a new generation, so this exact original-context
      // read intentionally does not reuse the pre-enrollment render scope.
      if (s.serial !== serial || live.current.context !== source.context || !isLanguageRecordContextCurrent(source.context)) return false;
      const fresh = readConversationSnapshot(source.context); acceptRead(fresh);
      if (s.serial !== serial || fresh.envelope?.generationId !== result.committed.generationId
        || !editorSavedAt(selected(fresh)) || !exact(headView(selected(fresh)), headView(renderSession))) return changedBeforeAction();
      const created = fresh.envelope.sessions.find(item => item.sessionId === result.effect.sessionId);
      if (!created || !exact(created, result.committed.sessions.find(item => item.sessionId === result.effect.sessionId))) return changedBeforeAction();
      choose(created); update(); return true;
    } catch (error) { s.error = message(error); update(); return false; }
  };
  const open = async (sessionId: string): Promise<boolean> => {
    if (!await preserve() || s.editor?.dirty || !bound()) return false;
    try { const source = read(); if (!navigationSafeAt(source) || !exact(headView(selected(source)), headView(renderSession))) return changedBeforeAction(); const session = source.envelope?.sessions.find(item => item.sessionId === sessionId); if (!session) { s.error = '이 대화의 원본을 찾지 못했어요.'; update(); return false; } choose(session); s.error = null; update(); return true; }
    catch { return false; }
  };
  const leave = async () => { if (!await preserve() || s.editor?.dirty || !bound()) return false;
    try { const source = read(); if (!navigationSafeAt(source) || !exact(headView(selected(source)), headView(renderSession))) return changedBeforeAction(); choose(null); s.error = null; update(); return true; } catch { return false; } };
  const recover = async (): Promise<boolean> => {
    if (s.busy) return false;
    try {
      const action = s.action;
      const source = read(action?.type === 'edit' && action.intent.kind === 'delete');
      if (action?.type === 'edit') {
        const result = reconcileConversationEdit(action.intent, source.context);
        if (result.status !== 'observed') { s.error = '이 저장의 완료 여부가 아직 불확실해요. 입력을 유지하고 자동으로 다시 보내지 않습니다.'; update(); return false; }
        s.source = result.source; s.scope = scopeOf(result.source);
        if (action.draft && action.editor) finishDraft(action.draft, action.editor);
        s.action = null; s.uncertain = false; s.error = null;
        if (action.intent.kind === 'create') {
          if (s.sessionId === null && s.editor === null) choose(result.source.envelope?.sessions.find(item => item.sessionId === result.effect.sessionId) ?? null);
          else {
            // Creation proof does not prove that the previous visible editor
            // can be left. Recovery acknowledges creation without navigating.
            acceptRead(result.source);
            s.error = '새 대화가 저장된 것을 확인했어요. 기존 화면과 입력은 유지합니다. 기록 보기에서 새 대화를 열 수 있어요.';
          }
        }
        if (action.intent.kind === 'delete') choose(null);
        if (action.intent.kind === 'cancel' && result.effect.kind === 'applied') {
          const operation = selected(result.source)?.operations.find(item => item.command.operationId === result.effect.operationId)?.command;
          if (operation?.kind === 'append' && s.editor?.draftId === operation.turn.draft.draftId) s.editor = blankEditor(s.exposure);
          if (operation?.kind === 'close') s.editor = null;
        }
        update(); return true;
      }
      const operation = action?.type === 'command' ? action.intent.command : pendingAt(selected(source));
      if (!operation) { s.uncertain = false; s.error = null; update(); return true; }
      const observed = reconcileConversationOperation(source, operation.sessionId, operation.operationId);
      if ('command' in observed && !exact(observed.command, operation)) return false;
      if (observed.status === 'applied' || observed.status === 'cancelled') {
        if (observed.status === 'applied' && operation.kind === 'append' && s.editor?.draftId === operation.turn.draft.draftId) s.editor = blankEditor(s.exposure);
        if (observed.status === 'applied' && operation.kind === 'close') s.editor = null;
        s.action = null; s.uncertain = false; s.error = null; acceptRead(readConversationSnapshot(source.context)); update(); return true;
      }
      s.error = observed.status === 'pending' ? '저장 요청이 보류되어 있어요. 취소하면 전송하지 않은 입력으로 남습니다.' : '완료 여부를 확인하지 못했어요. 원래 요청을 자동으로 다시 실행하지 않습니다.';
      s.uncertain = observed.status === 'unresolved'; update(); return false;
    } catch (error) { s.error = message(error); update(); return false; }
  };
  const cancelPending = async (): Promise<boolean> => {
    if (s.busy || s.action?.type === 'edit') return false;
    try {
      const renderedOperation = pendingAt(renderSession) ?? (s.action?.type === 'command' ? s.action.intent.command : null);
      const source = read(), session = selected(source), operation = pendingAt(session);
      if (!session || !operation) return recover();
      if (!renderedOperation || !exact(operation, renderedOperation) || !exact(headView(session), headView(renderSession))) return changedBeforeAction();
      if (s.action?.type === 'command' && !exact(operation, s.action.intent.command)) return false;
      const intent = captureConversationCancellation(source, session.sessionId, operation.operationId);
      const original = s.action; s.action = null;
      const result = await runEdit(intent, source.context);
      if (!result) { if (!s.action) s.action = original; return false; }
      if (result.effect.kind === 'applied') {
        if (operation.kind === 'append' && s.editor?.draftId === operation.turn.draft.draftId) s.editor = blankEditor(s.exposure);
        if (operation.kind === 'close') s.editor = null;
      }
      s.uncertain = false; s.error = null; update(); return true;
    } catch (error) { s.error = message(error); update(); return false; }
  };
  const requestDelete = () => {
    if (s.busy || s.action || s.editor?.dirty || s.uncertain) return;
    try { const source = read(), session = selected(source); if (!session || pendingAt(session)) return;
      s.deletion = { source, sessionId: session.sessionId, label: session.source.label, intent: captureConversationDeletion(source, session.sessionId) }; update(); }
    catch (error) { s.error = message(error); update(); }
  };
  const confirmDelete = async () => {
    const deletion = s.deletion; if (!deletion || s.busy || s.action) return false;
    try {
      const source = read();
      if (s.deletion !== deletion || !exact(source.envelope?.sessions.find(item => item.sessionId === deletion.sessionId), deletion.source.envelope?.sessions.find(item => item.sessionId === deletion.sessionId))) return false;
      s.deletion = null;
      const result = await runEdit(deletion.intent, deletion.source.context);
      if (!result) return false; choose(null); update(); return true;
    } catch (error) { s.error = message(error); update(); return false; }
  };
  const selectDraft = async (draftId: string) => {
    if (s.busy || s.action || s.editor?.dirty && !await save() || s.editor?.dirty || !bound()) return false;
    try { const source = read(), session = selected(source); if (!editorSavedAt(session) || !exact(headView(session), headView(renderSession))) return changedBeforeAction(); const draft = session?.drafts.find(item => item.draftId === draftId);
      if (!draft || session?.closed || !session || !supportedSource(session.source)) return false; s.exposure = mergeExposure(s.exposure, draft.exposure); s.editor = fromDraft(draft); s.editor.exposure = { ...s.exposure }; s.editor.dirty = !exact(s.editor.exposure, draft.exposure); update(); return true; }
    catch { return false; }
  };
  const requestDiscardInput = () => {
    if (s.busy || s.action || s.uncertain || !s.editor?.dirty || pendingAt(selected())) return;
    try { read(true); s.discard = { editor: s.editor, scope: s.scope }; update(); } catch {}
  };
  const confirmDiscardInput = () => {
    const discard = s.discard;
    if (!discard || s.busy || s.action || s.uncertain || discard.editor !== s.editor || discard.scope !== s.scope) return false;
    try { const source = read(true); if (s.editor !== discard.editor || s.scope !== discard.scope) return false;
      choose(selected(source)); s.error = null; update(); return true; } catch { return false; }
  };
  const observeExposure = (facts: Partial<Exposure>) => {
    if (document.visibilityState !== 'visible') return;
    try {
      read(); if (!selected() || selected()?.closed) return;
      let changed = false;
      for (const key of ['example', 'reading', 'meaning', 'hint'] as const) {
        // Exposure is sticky. A hidden setting cannot erase earlier display.
        if (facts[key] === 'shown' && s.exposure[key] !== 'shown') { s.exposure[key] = 'shown'; changed = true; }
      }
      if (changed && s.editor) { s.editor = { ...s.editor, version: s.editor.version + 1, exposure: { ...s.exposure } }; if (s.editor.input) s.editor.dirty = true; update(); }
    } catch { /* Retired/unrendered surfaces do not add exposure facts. */ }
  };
  const session = available ? selected() : null, pendingOperation = available ? pendingAt(session) ?? (s.action?.type === 'command' ? s.action.intent.command : null) : null;
  const status: 'unavailable' | 'idle' | 'unsaved' | 'saving' | 'pending' | 'uncertain' | 'saved' = !available ? 'unavailable' : s.busy ? 'saving' : s.uncertain ? 'uncertain' : pendingOperation ? 'pending' : s.editor?.dirty ? 'unsaved' : session ? 'saved' : 'idle';
  return { available, identity: available ? s.scope : null, snapshot: available ? s.source : null, session,
    sessions: available ? s.source?.envelope?.sessions ?? [] : [], input: available ? s.editor?.input ?? '' : '', status,
    busy: s.busy, error: available ? s.error : '이 계정의 기기 저장 상태를 확인하고 있어요. 입력은 보존됩니다.', missing: s.missing,
    pendingOperation, deletion: available && s.deletion ? { sessionId: s.deletion.sessionId, label: s.deletion.label } : null,
    unsupported: Boolean(session && !supportedSource(session.source)),
    discardingInput: available && Boolean(s.discard),
    checkCurrent: () => { if (!bound()) return false; try { read(); return bound(); } catch { return false; } },
    requestDiscardInput: () => { if (bound()) requestDiscardInput(); }, cancelDiscardInput: () => { if (bound()) { s.discard = null; update(); } },
    confirmDiscardInput: () => bound() ? confirmDiscardInput() : false,
    canEdit: available && !s.missing && Boolean(session && !session.closed && supportedSource(session.source)) && !s.deletion && !s.discard && !(s.action?.type === 'edit' && (s.action.intent.kind === 'create' || s.action.intent.kind === 'delete')) && !(s.action?.type === 'command' && s.action.intent.command.kind === 'close'),
    observeExposure: (facts: Partial<Exposure>) => { if (bound()) observeExposure(facts); }, typeInput: (value: string) => { if (bound()) type(value); }, insertExample: () => { if (!bound()) return; try { const session = selected(read()); if (session) type(session.source.content.japanese, true); } catch {} },
    save: () => bound() ? save() : Promise.resolve(false), send: () => bound() ? command('append') : Promise.resolve(false), end: () => bound() ? command('close') : Promise.resolve(false),
    start: (scriptId: string) => bound() ? start(scriptId) : Promise.resolve(false), open: (sessionId: string) => bound() ? open(sessionId) : Promise.resolve(false),
    leave: () => bound() ? leave() : Promise.resolve(false), recover: () => bound() ? recover() : Promise.resolve(false), cancelPending: () => bound() ? cancelPending() : Promise.resolve(false),
    requestDelete: () => { if (bound()) requestDelete(); }, cancelDelete: () => { if (bound()) { s.deletion = null; update(); } },
    confirmDelete: () => bound() ? confirmDelete() : Promise.resolve(false), selectDraft: (draftId: string) => bound() ? selectDraft(draftId) : Promise.resolve(false) };
}
