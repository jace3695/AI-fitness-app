"use client";
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/app/lib/supabase';
import { handwritingMaterialPath, validateHandwritingPackage } from '@/app/data/handwritingMaterials';
import { materialReadNotice, materialReadDiagnostic } from './material-read-status';

async function digest(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
export function usePrivateMaterials(owner: string | undefined, pdfPage: number) {
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [opening, setOpening] = useState(false);
  const [version, setVersion] = useState(0);
  const [diagnostic, setDiagnostic] = useState<ReturnType<typeof materialReadDiagnostic> | null>(null);
  const generation = useRef({ value: 0 }), liveOwner = useRef(owner), mounted = useRef(true);
  const importLock = useRef<object | null>(null), pdfLock = useRef<object | null>(null);
  const pdfUrls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  if (liveOwner.current !== owner) { liveOwner.current = owner; generation.current.value++; }
  useEffect(() => { const lifecycle = generation.current; mounted.current = true; return () => { mounted.current = false; lifecycle.value++; }; }, []);
  useEffect(() => {
    const lifecycle = generation.current, urls = pdfUrls.current;
    importLock.current = null; pdfLock.current = null;
    setImporting(false); setOpening(false); setImportStatus('');
    return () => {
      lifecycle.value++;
      for (const [url, timer] of urls) { clearTimeout(timer); URL.revokeObjectURL(url); }
      urls.clear();
    };
  }, [owner]);
  useEffect(() => {
    setImageUrl(''); setError(''); setDiagnostic(null); setLoading(false);
    if (!owner) return;
    if (!supabase) { setError('교재 연결을 준비하지 못했어요. 잠시 후 다시 열어 주세요.'); return; }
    const client = supabase; let cancelled = false; let url = '';
    setImageUrl(''); setError(''); setLoading(true);
    void (async () => {
      let stage: 'registration' | 'page' = 'registration';
      try {
        const ready = await client.storage.from('growth-resources').download(handwritingMaterialPath(owner, 'ready.txt'));
        if (cancelled) return;
        if (ready.error) throw ready.error;
        stage = 'page';
        const response = await client.storage.from('growth-resources').download(handwritingMaterialPath(owner, `page-${String(pdfPage).padStart(2, '0')}.webp`));
        if (cancelled) return;
        if (response.error) throw response.error;
        url = URL.createObjectURL(response.data); setImageUrl(url);
      } catch (e) { if (!cancelled) { setError(materialReadNotice(e, stage)); setDiagnostic(materialReadDiagnostic(e, stage)); } }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [owner, pdfPage, version]);

  async function importPackage(file: File) {
    if (!mounted.current || !owner || liveOwner.current !== owner || !supabase || importLock.current) return;
    const ticket = {}, startedGeneration = generation.current.value;
    const current = () => mounted.current && liveOwner.current === owner && generation.current.value === startedGeneration && importLock.current === ticket;
    if (file.size > 20_000_000) { setImportStatus('20MB 이하의 교재 묶음 파일을 선택해 주세요.'); return; }
    importLock.current = ticket;
    setImporting(true); setImportStatus('파일 구성을 확인하고 있어요.');
    try {
      const text = await file.text();
      if (!current()) return;
      const pack = validateHandwritingPackage(JSON.parse(text));
      // Validate every payload before writing any file. Existing originals are never overwritten.
      const decoded = [];
      for (const item of pack.files) {
        const bytes = Uint8Array.from(atob(item.base64), c => c.charCodeAt(0));
        const hash = await digest(bytes);
        if (!current()) return;
        if (hash !== item.sha256) throw Error('파일이 손상됐어요. 원래 묶음 파일을 다시 선택해 주세요.');
        decoded.push({ ...item, bytes });
      }
      const client = supabase;
      for (let index = 0; index < decoded.length; index++) {
        if (!current()) return;
        const item = decoded[index]; const path = handwritingMaterialPath(owner, item.name);
        setImportStatus(`내 비공개 보관함에 등록 중… ${index + 1} / 54`);
        const uploaded = await client.storage.from('growth-resources').upload(path, item.bytes, { contentType: item.mimeType, upsert: false });
        if (!current()) return;
        if (uploaded.error) {
          const existing = await client.storage.from('growth-resources').download(path);
          if (!current()) return;
          if (existing.error) throw Error('등록을 마치지 못했어요. 같은 파일로 다시 시도할 수 있으며 기존 자료는 덮어쓰지 않아요.');
          const bytes = await existing.data.arrayBuffer();
          if (!current()) return;
          const hash = await digest(new Uint8Array(bytes));
          if (!current()) return;
          if (hash !== item.sha256) throw Error('등록을 마치지 못했어요. 같은 파일로 다시 시도할 수 있으며 기존 자료는 덮어쓰지 않아요.');
        }
      }
      if (!current()) return;
      const marker = await client.storage.from('growth-resources').upload(handwritingMaterialPath(owner, 'ready.txt'), new Blob(['yeoni-private-handwriting-v1'], { type: 'text/plain' }), { contentType: 'text/plain', upsert: false });
      if (!current()) return;
      if (marker.error) {
        const existing = await client.storage.from('growth-resources').download(handwritingMaterialPath(owner, 'ready.txt'));
        if (!current()) return;
        if (existing.error) throw Error('등록 완료 상태를 확인하지 못했어요. 같은 파일로 다시 시도해 주세요.');
        const markerText = await existing.data.text();
        if (!current()) return;
        if (markerText !== 'yeoni-private-handwriting-v1') throw Error('등록 완료 상태를 확인하지 못했어요. 같은 파일로 다시 시도해 주세요.');
      }
      setImportStatus('교재를 내 계정에 비공개로 등록했어요. 다른 기기에서도 같은 계정으로 열 수 있어요.'); setVersion(n => n + 1);
    } catch (e) { if (current()) setImportStatus(e instanceof Error ? e.message : '자료를 등록하지 못했어요.'); }
    finally { if (current()) { importLock.current = null; setImporting(false); } }
  }
  async function downloadPdf() {
    if (!mounted.current || !owner || liveOwner.current !== owner || !supabase || pdfLock.current) return;
    const ticket = {}, startedGeneration = generation.current.value;
    const current = () => mounted.current && liveOwner.current === owner && generation.current.value === startedGeneration && pdfLock.current === ticket;
    pdfLock.current = ticket; setOpening(true); setError(''); setDiagnostic(null);
    try {
      const result = await supabase.storage.from('growth-resources').download(handwritingMaterialPath(owner, 'workbook.pdf'));
      if (!current()) return;
      if (result.error) throw result.error;
      const url = URL.createObjectURL(result.data);
      const timer = setTimeout(() => { URL.revokeObjectURL(url); pdfUrls.current.delete(url); }, 60000);
      pdfUrls.current.set(url, timer);
      const anchor = document.createElement('a');
      try { anchor.href = url; anchor.download = 'film-handwriting-workbook.pdf'; document.body.append(anchor); anchor.click(); }
      finally { anchor.remove(); }
    } catch { if (current()) setError('원본 PDF를 불러오지 못했어요. 교재 등록과 연결 상태를 확인해 주세요.'); }
    finally { if (current()) { pdfLock.current = null; setOpening(false); } }
  }
  return { imageUrl, error, diagnostic, loading, importing, importStatus, opening, importPackage, downloadPdf, retry: () => setVersion(n => n + 1) };
}
