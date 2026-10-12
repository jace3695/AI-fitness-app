"use client";
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/app/lib/supabase';
import { HANDWRITING_PACKAGE_FORMAT, handwritingMaterialPath, validateHandwritingPackage } from '@/app/data/handwritingMaterials';
import { hashBytes, type WorksheetIdentity } from '@/lib/handwriting-draft';

export function usePrivateMaterials(owner: string | undefined, pdfPage: number, isOwnerActive: (owner: string) => boolean = () => true) {
  const [imageUrl, setImageUrl] = useState('');
  const [worksheet, setWorksheet] = useState<WorksheetIdentity | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false); const [importStatus, setImportStatus] = useState('');
  const [opening, setOpening] = useState(false); const [version, setVersion] = useState(0);
  const generation = useRef(0), ownerGeneration = useRef(0), mounted = useRef(false), ownerRef = useRef(owner), activeRef = useRef(isOwnerActive);
  const importingRef = useRef(false), openingRef = useRef(false);
  // Synchronous refs reject a late owner-A callback even before effect cleanup.
  ownerRef.current = owner; activeRef.current = isOwnerActive;
  const owned = (id: string) => mounted.current && ownerRef.current === id && activeRef.current(id);
  const active = (id: string, token: number) => owned(id) && token === generation.current;
  const actionActive = (id: string, token: number) => owned(id) && token === ownerGeneration.current;
  async function assertOwner(id: string, token: number, action = false) {
    const current = () => action ? actionActive(id, token) : active(id, token);
    if (!supabase || !current()) throw Error('handwriting_owner_changed');
    const auth = await supabase.auth.getUser();
    if (!current() || auth.error || auth.data.user?.id !== id) throw Error('handwriting_owner_changed');
  }
  useEffect(() => {
    mounted.current = true; ownerGeneration.current++;
    importingRef.current = false; openingRef.current = false; setImporting(false); setOpening(false); setImportStatus('');
    // Invalidate asynchronous owner actions; this ref does not point to a DOM node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { mounted.current = false; ownerGeneration.current++; };
  }, [owner]);
  useEffect(() => {
    if (!owner || !supabase) return;
    const client = supabase, token = ++generation.current; let cancelled = false; let url = '';
    const current = () => !cancelled && active(owner, token);
    setImageUrl(''); setWorksheet(null); setError(''); setLoading(true);
    void (async () => {
      try {
        await assertOwner(owner, token);
        const ready = await client.storage.from('growth-resources').download(handwritingMaterialPath(owner, 'ready.txt'));
        await assertOwner(owner, token);
        if (ready.error || await ready.data.text() !== HANDWRITING_PACKAGE_FORMAT) throw Error('등록된 비공개 교재를 확인하지 못했어요. 처음이라면 아래에서 교재 묶음을 등록해 주세요.');
        await assertOwner(owner, token);
        const path = handwritingMaterialPath(owner, `page-${String(pdfPage).padStart(2, '0')}.webp`);
        const response = await client.storage.from('growth-resources').download(path);
        await assertOwner(owner, token);
        if (response.error) throw Error('연습지를 불러오지 못했어요. 연결을 확인하고 다시 불러와 주세요.');
        const sha256 = await hashBytes(response.data); await assertOwner(owner, token);
        if (!current()) return;
        url = URL.createObjectURL(response.data); setWorksheet({ path, version: HANDWRITING_PACKAGE_FORMAT, sha256 }); setImageUrl(url);
      } catch (e) { if (current()) setError(e instanceof Error ? e.message : '교재를 불러오지 못했어요.'); }
      finally { if (current()) setLoading(false); }
    })();
    // Invalidate outstanding asynchronous work, not a DOM-ref cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { cancelled = true; generation.current++; if (url) URL.revokeObjectURL(url); };
    // Owner/page/version define the request. Active callback is read synchronously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, pdfPage, version]);
  async function importPackage(file: File) {
    if (!owner || !supabase || importingRef.current) return;
    if (file.size > 20_000_000) { setImportStatus('20MB 이하의 교재 묶음 파일을 선택해 주세요.'); return; }
    const token = ownerGeneration.current, client = supabase;
    importingRef.current = true; setImporting(true); setImportStatus('파일 구성을 확인하고 있어요.');
    try {
      await assertOwner(owner, token, true);
      const pack = validateHandwritingPackage(JSON.parse(await file.text())); await assertOwner(owner, token, true);
      const decoded = [];
      for (const item of pack.files) {
        const bytes = Uint8Array.from(atob(item.base64), c => c.charCodeAt(0));
        if (await hashBytes(bytes) !== item.sha256) throw Error('파일이 손상됐어요. 원래 묶음 파일을 다시 선택해 주세요.');
        await assertOwner(owner, token, true); decoded.push({ ...item, bytes });
      }
      for (let index = 0; index < decoded.length; index++) {
        const item = decoded[index], path = handwritingMaterialPath(owner, item.name);
        await assertOwner(owner, token, true); setImportStatus(`내 비공개 보관함에 등록 중… ${index + 1} / 54`);
        await client.storage.from('growth-resources').upload(path, item.bytes, { contentType: item.mimeType, upsert: false });
        await assertOwner(owner, token, true);
        const existing = await client.storage.from('growth-resources').download(path); await assertOwner(owner, token, true);
        if (existing.error || await hashBytes(existing.data) !== item.sha256) throw Error('등록을 마치지 못했어요. 같은 파일로 다시 시도할 수 있으며 기존 자료는 덮어쓰지 않아요.');
        await assertOwner(owner, token, true);
      }
      await client.storage.from('growth-resources').upload(handwritingMaterialPath(owner, 'ready.txt'), new Blob([HANDWRITING_PACKAGE_FORMAT], { type: 'text/plain' }), { contentType: 'text/plain', upsert: false });
      await assertOwner(owner, token, true);
      const existing = await client.storage.from('growth-resources').download(handwritingMaterialPath(owner, 'ready.txt')); await assertOwner(owner, token, true);
      if (existing.error || await existing.data.text() !== HANDWRITING_PACKAGE_FORMAT) throw Error('등록 완료 상태를 확인하지 못했어요. 같은 파일로 다시 시도해 주세요.');
      await assertOwner(owner, token, true);
      setImportStatus('교재를 내 계정에 비공개로 등록했어요. 다른 기기에서도 같은 계정으로 열 수 있어요.'); setVersion(n => n + 1);
    } catch (e) { if (actionActive(owner, token)) setImportStatus(e instanceof Error ? e.message : '자료를 등록하지 못했어요.'); }
    finally { if (actionActive(owner, token)) { importingRef.current = false; setImporting(false); } }
  }
  async function downloadPdf() {
    if (!owner || !supabase || openingRef.current) return;
    const token = ownerGeneration.current, client = supabase;
    openingRef.current = true; setOpening(true); setError('');
    try {
      await assertOwner(owner, token, true);
      const result = await client.storage.from('growth-resources').download(handwritingMaterialPath(owner, 'workbook.pdf')); await assertOwner(owner, token, true);
      if (result.error) throw result.error;
      const url = URL.createObjectURL(result.data), anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'film-handwriting-workbook.pdf'; document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { if (actionActive(owner, token)) setError('원본 PDF를 불러오지 못했어요. 교재 등록과 연결 상태를 확인해 주세요.'); }
    finally { if (actionActive(owner, token)) { openingRef.current = false; setOpening(false); } }
  }
  return { imageUrl, worksheet, error, loading, importing, importStatus, opening, importPackage, downloadPdf, retry: () => setVersion(n => n + 1) };
}
