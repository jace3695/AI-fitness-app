"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/app/lib/supabase";
import { parseAttempt, type Attempt } from "@/lib/drawing/model";
import { draftKey, localDrafts, localWrite, type LocalDraft } from "@/lib/drawing/local-store";

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function useDrawingRecords() {
  const [owner, setOwner] = useState<string | null>(null);
  const [records, setRecords] = useState<Attempt[]>([]);
  const [recovery, setRecovery] = useState<LocalDraft[]>([]);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const ownerRef = useRef<string | null>(null);
  const queue = useRef(Promise.resolve());
  const working = useRef(false);

  useEffect(() => {
    if (!supabase) return;
    let alive = true; let generation = 0;
    const load = async (id: string | null) => {
      const ticket = ++generation;
      if (!alive) return;
      ownerRef.current = id; setOwner(id); setRecords([]); setRecovery([]); setReady(false);
      if (!id) { setReady(true); return; }
      const active = () => alive && generation === ticket && ownerRef.current === id;
      try { const drafts = await localDrafts(id); if (active()) setRecovery(drafts); }
      catch { if (active()) setNotice("이 기기의 임시 저장을 읽지 못했어요. 브라우저 저장 공간을 확인해 주세요."); }
      try {
        const items: Attempt[] = [];
        for (let offset = 0; ; offset += 50) {
          const result = await supabase!.from("growth_drawing_attempts").select("*").eq("user_id", id).order("updated_at", { ascending: false }).order("id").range(offset, offset + 49).abortSignal(AbortSignal.timeout(15_000));
          if (result.error) throw result.error;
          if (!active()) return;
          items.push(...(result.data ?? []).map(parseAttempt));
          if ((result.data?.length ?? 0) < 50) break;
        }
        if (active()) setRecords(items);
      } catch { if (active()) setNotice("그림 기록을 불러오지 못했어요. 임시 그림은 유지돼요. 연결 후 새로고침해 주세요."); }
      if (active()) setReady(true);
    };
    void supabase.auth.getUser().then(({ data }) => { if (alive && generation === 0) void load(data.user?.id ?? null); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== ownerRef.current) void load(session?.user.id ?? null);
    });
    return () => { alive = false; generation++; data.subscription.unsubscribe(); };
  }, []);

  const checkpoint = useCallback((draft: LocalDraft) => {
    const id = ownerRef.current;
    if (!id || draft.attempt.user_id !== id) return Promise.reject(Error("account changed"));
    const operation = queue.current.catch(() => {}).then(async () => {
      await localWrite(draftKey(id, draft.attempt.id), draft);
      if (ownerRef.current === id) setRecovery(previous => draft.pending ? [draft, ...previous.filter(d => d.attempt.id !== draft.attempt.id)] : previous.filter(d => d.attempt.id !== draft.attempt.id));
    });
    queue.current = operation;
    return operation;
  }, []);

  async function save(attempt: Attempt): Promise<Attempt | null> {
    const id = ownerRef.current;
    if (!id || !supabase || working.current || attempt.user_id !== id) return null;
    if (new Blob([JSON.stringify(attempt.document)]).size > 2_800_000) { setNotice("그림이 너무 커요. 원본을 내보낸 뒤 사진 크기나 선 수를 줄여 주세요."); return null; }
    working.current = true; setBusy(true);
    let staged = false;
    try {
      parseAttempt(attempt);
      // Persist the exact request before contacting the server. Retry retains the attempt UUID.
      await checkpoint({ attempt, baseRevision: attempt.revision, pending: true });
      staged = true;
      const query = attempt.revision === 0
        ? supabase.from("growth_drawing_attempts").insert({ id: attempt.id, user_id: id, status: attempt.status, document: attempt.document }).select("*").abortSignal(AbortSignal.timeout(20_000)).maybeSingle()
        : supabase.from("growth_drawing_attempts").update({ document: attempt.document, status: attempt.status, revision: attempt.revision + 1 }).eq("id", attempt.id).eq("user_id", id).eq("revision", attempt.revision).select("*").abortSignal(AbortSignal.timeout(20_000)).maybeSingle();
      const result = await query;
      let saved = result.data ? parseAttempt(result.data) : null;
      // A lost reply is not a failed write. Confirm exact payload before treating it as saved.
      if (result.error || !saved) {
        const check = await supabase.from("growth_drawing_attempts").select("*").eq("id", attempt.id).eq("user_id", id).abortSignal(AbortSignal.timeout(15_000)).maybeSingle();
        if (check.error || !check.data || check.data.status !== attempt.status || canonical(check.data.document) !== canonical(attempt.document))
          throw Error(check.data ? "conflict" : "unconfirmed");
        saved = parseAttempt(check.data);
      }
      if (ownerRef.current !== id) return null;
      try { await checkpoint({ attempt: saved, baseRevision: saved.revision, pending: false }); }
      catch { /* Exact server response is authoritative even when local storage is full. */ }
      setRecords(previous => [saved!, ...previous.filter(a => a.id !== saved!.id)]);
      setNotice("그림과 자기확인을 함께 저장했어요.");
      return saved;
    } catch (error) {
      if (ownerRef.current === id) setNotice(!staged ? "이 기기의 임시 저장에도 실패했어요. 화면을 닫기 전에 현재 그림을 내보내 주세요."
        : error instanceof Error && error.message === "conflict"
        ? "다른 기기에서 바뀐 기록이 있어요. 덮어쓰지 않았어요. 현재 그림을 내보낸 뒤 새로고침해 비교해 주세요."
        : "클라우드 저장을 확인하지 못했어요. 이 기기의 임시 그림으로 남겨두었어요. 연결 후 다시 저장해 주세요.");
      return null;
    } finally { working.current = false; setBusy(false); }
  }

  async function remove(attempt: Attempt): Promise<boolean> {
    const id = ownerRef.current;
    if (!id || !supabase || working.current || attempt.user_id !== id) return false;
    working.current = true; setBusy(true);
    try {
      const result = await supabase.from("growth_drawing_attempts").delete().eq("id", attempt.id).eq("user_id", id).eq("revision", attempt.revision).select("id").abortSignal(AbortSignal.timeout(15_000));
      if (result.error || !result.data?.length) throw Error("delete");
      if (ownerRef.current !== id) return false;
      await queue.current.catch(() => {});
      await localWrite(draftKey(id, attempt.id), undefined);
      setRecords(previous => previous.filter(a => a.id !== attempt.id)); setRecovery(previous => previous.filter(d => d.attempt.id !== attempt.id)); setNotice("선택한 그림과 자기확인을 삭제했어요."); return true;
    } catch { if (ownerRef.current === id) setNotice("삭제를 확인하지 못했어요. 새로고침 후 확인해 주세요."); return false; }
    finally { working.current = false; setBusy(false); }
  }
  return { owner, records, recovery, ready, notice, setNotice, busy, checkpoint, save, remove };
}
