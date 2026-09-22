"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { supabase } from "@/app/lib/supabase";
import catalog from "@/content/drawing/template-catalog.json";
import { templatePath, type TemplateAsset } from "@/lib/drawing/template-zip";
import { loadTemplate, registerTemplates } from "@/lib/drawing/template-store";
import { useUnsavedChanges } from "@/components/useUnsavedChanges";

export default function TemplateReferences({ owner, lessonId }: { owner: string | null; lessonId: string }) {
  const [selected, setSelected] = useState<TemplateAsset | null>(null);
  const [image, setImage] = useState<{ owner: string; assetId: string; url: string } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const [group, setGroup] = useState("동물가이드");
  const liveOwner = useRef(owner); liveOwner.current = owner;
  const running = useRef(false);
  const mounted = useRef(true);
  const [revision, setRevision] = useState(0);
  const [registered, setRegistered] = useState<{ owner: string; count: number } | null>(null);
  const [listError, setListError] = useState(false);
  useUnsavedChanges(busy);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!owner || !supabase) return;
    let active = true;
    const prefix = templatePath(owner, catalog.assets[0]).split('/').slice(0, -1).join('/');
    void supabase.storage.from('growth-resources').list(prefix, { limit: 200 }).then(result => {
      if (!active) return;
      setListError(Boolean(result.error));
      if (!result.error) {
        const names = new Set(result.data.map(item => item.name));
        setRegistered({ owner, count: catalog.assets.filter(asset => names.has(`${asset.id}-${asset.sha256}.png`)).length });
      }
    }).catch(() => { if (active) setListError(true); });
    return () => { active = false; };
  }, [owner, revision]);
  useEffect(() => {
    if (!owner || !supabase || !selected) return;
    let active = true; let url = "";
    const client = supabase;
    void (async () => {
      const blob = await loadTemplate(client.storage.from("growth-resources"), owner, selected);
      if (!active) return;
      url = URL.createObjectURL(blob);
      setImage({ owner, assetId: selected.id, url }); setStatus("");
    })().catch(e => { if (active) setStatus(e instanceof Error ? e.message : "템플릿을 불러오지 못했어요. 다시 열어 주세요."); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [owner, selected, revision]);

  async function register(file: File) {
    if (!owner || !supabase || running.current) return;
    const id = owner, client = supabase;
    const active = () => mounted.current && liveOwner.current === id;
    running.current = true; setBusy(true); setStatus("원본 템플릿 150종을 확인하고 있어요.");
    try {
      if (file.size > 15_000_000) throw Error("15MB 이하의 템플릿 ZIP을 선택해 주세요.");
      await registerTemplates(client.storage.from("growth-resources"), id, await file.arrayBuffer(), catalog.assets, active,
        (done, total) => { if (active()) setStatus(`저장된 원본 확인 중… ${done} / ${total}`); });
      if (active()) { setStatus("템플릿 150종을 본인 계정에 등록했어요. 같은 계정으로 다른 기기에서도 열 수 있어요."); setRevision(n => n + 1); }
    } catch (e) { if (active()) setStatus(e instanceof Error ? e.message : "등록하지 못했어요."); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  const recommended = catalog.assets.filter(a => a.lessonIds.includes(lessonId));
  const visible = all ? catalog.assets.filter(a => a.group === group) : recommended;
  return <section className="drawing-card" aria-label="만능 템플릿 원본 자료">
    <h2 className="text-lg font-bold">내 만능 템플릿 150종</h2>
    <p className="mt-2 text-sm text-slate-600">제공해 주신 실제 원본이에요. 오늘 필요한 부분만 살펴봐요. 단계별 시범과 별도로 참고하는 자료예요.</p>
    {registered?.owner === owner && <p className="mt-2 text-sm" aria-label="템플릿 등록 상태">보관함에 {registered.count} / 150종 있어요. {registered.count === 150 ? '원본을 선택해 열어 보세요.' : '아래에서 같은 ZIP으로 등록을 마칠 수 있어요.'}</p>}
    {listError && <p className="mt-2 text-sm">보관함 목록을 확인하지 못했어요. 연결 후 <button className="underline" onClick={() => setRevision(n => n + 1)}>다시 확인</button>해 주세요.</p>}
    <div className="my-3 flex flex-wrap gap-2"><button className="drawing-button" aria-pressed={!all} onClick={() => setAll(false)}>현재 수업 참고</button><button className="drawing-button" aria-pressed={all} onClick={() => setAll(true)}>150종 둘러보기</button></div>
    {all && <label className="text-sm">자료 종류<select className="drawing-input" value={group} onChange={e => setGroup(e.target.value)}>{["동물가이드", "이목구비", "표정", "포즈가이드", "효과선"].map(g => <option key={g}>{g}</option>)}</select></label>}
    {!visible.length && <p className="text-sm">이 수업에 직접 맞는 원본은 아직 연결하지 않았어요. 전체 자료는 둘러볼 수 있어요.</p>}
    <div className="my-3 flex flex-wrap gap-2">{visible.map(asset => <button key={asset.id} disabled={!owner || busy} className="drawing-button" onClick={() => { setSelected(asset); setRevision(n => n + 1); }}>{asset.label}</button>)}</div>
    {selected && <div className="rounded-2xl border border-violet-100 p-3"><h3 className="font-semibold">{selected.label}</h3><p className="my-2 text-sm">{selected.note}</p>{image?.owner === owner && image.assetId === selected.id && <Image src={image.url} alt={`첨부 교재 원본: ${selected.label}`} width={800} height={800} unoptimized className="mx-auto h-auto max-h-[32rem] w-auto max-w-full rounded-xl bg-white" />}</div>}
    <details className="mt-4"><summary className="cursor-pointer py-3 font-semibold">처음 한 번 원본 ZIP 등록</summary><p className="mb-3 text-sm">이미 주신 ‘만능 템플릿 150종’ ZIP을 그대로 선택해요. 본인 계정 전용 보관함에 등록돼요. 등록 중에는 화면을 닫지 마세요.</p><input aria-label="만능 템플릿 ZIP" type="file" accept=".zip,application/zip" disabled={!owner || busy} className="max-w-full text-sm" onChange={e => { const file = e.target.files?.[0]; if (file) void register(file); e.target.value = ""; }} /></details>
    {status && <p className="mt-3 text-sm" role="status">{status}</p>}
  </section>;
}
