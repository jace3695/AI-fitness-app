"use client";
import { useEffect, useState } from 'react';
import { supabase } from '@/app/lib/supabase';
import { handwritingMaterialPath, validateHandwritingPackage } from '@/app/data/handwritingMaterials';

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
  useEffect(() => {
    if (!owner || !supabase) return;
    const client = supabase; let cancelled = false; let url = '';
    setImageUrl(''); setError(''); setLoading(true);
    void (async () => {
      try {
        const ready = await client.storage.from('growth-resources').download(handwritingMaterialPath(owner, 'ready.txt'));
        if (ready.error) throw Error('등록된 비공개 교재를 확인하지 못했어요. 처음이라면 아래에서 교재 묶음을 등록해 주세요.');
        const response = await client.storage.from('growth-resources').download(handwritingMaterialPath(owner, `page-${String(pdfPage).padStart(2, '0')}.webp`));
        if (response.error) throw Error('연습지를 불러오지 못했어요. 연결을 확인하고 다시 불러와 주세요.');
        if (cancelled) return;
        url = URL.createObjectURL(response.data); setImageUrl(url);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : '교재를 불러오지 못했어요.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [owner, pdfPage, version]);

  async function importPackage(file: File) {
    if (!owner || !supabase || importing) return;
    if (file.size > 20_000_000) { setImportStatus('20MB 이하의 교재 묶음 파일을 선택해 주세요.'); return; }
    setImporting(true); setImportStatus('파일 구성을 확인하고 있어요.');
    try {
      const pack = validateHandwritingPackage(JSON.parse(await file.text()));
      // Validate every payload before writing any file. Existing originals are never overwritten.
      const decoded = [];
      for (const item of pack.files) {
        const bytes = Uint8Array.from(atob(item.base64), c => c.charCodeAt(0));
        if (await digest(bytes) !== item.sha256) throw Error('파일이 손상됐어요. 원래 묶음 파일을 다시 선택해 주세요.');
        decoded.push({ ...item, bytes });
      }
      const client = supabase;
      for (let index = 0; index < decoded.length; index++) {
        const item = decoded[index]; const path = handwritingMaterialPath(owner, item.name);
        setImportStatus(`내 비공개 보관함에 등록 중… ${index + 1} / 54`);
        const uploaded = await client.storage.from('growth-resources').upload(path, item.bytes, { contentType: item.mimeType, upsert: false });
        if (uploaded.error) {
          const existing = await client.storage.from('growth-resources').download(path);
          if (existing.error || await digest(new Uint8Array(await existing.data.arrayBuffer())) !== item.sha256) throw Error('등록을 마치지 못했어요. 같은 파일로 다시 시도할 수 있으며 기존 자료는 덮어쓰지 않아요.');
        }
      }
      const marker = await client.storage.from('growth-resources').upload(handwritingMaterialPath(owner, 'ready.txt'), new Blob(['yeoni-private-handwriting-v1'], { type: 'text/plain' }), { contentType: 'text/plain', upsert: false });
      if (marker.error) {
        const existing = await client.storage.from('growth-resources').download(handwritingMaterialPath(owner, 'ready.txt'));
        if (existing.error || await existing.data.text() !== 'yeoni-private-handwriting-v1') throw Error('등록 완료 상태를 확인하지 못했어요. 같은 파일로 다시 시도해 주세요.');
      }
      setImportStatus('교재를 내 계정에 비공개로 등록했어요. 다른 기기에서도 같은 계정으로 열 수 있어요.'); setVersion(n => n + 1);
    } catch (e) { setImportStatus(e instanceof Error ? e.message : '자료를 등록하지 못했어요.'); }
    finally { setImporting(false); }
  }
  async function downloadPdf() {
    if (!owner || !supabase || opening) return;
    setOpening(true); setError('');
    try {
      const result = await supabase.storage.from('growth-resources').download(handwritingMaterialPath(owner, 'workbook.pdf'));
      if (result.error) throw result.error;
      const url = URL.createObjectURL(result.data); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'film-handwriting-workbook.pdf'; document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { setError('원본 PDF를 불러오지 못했어요. 교재 등록과 연결 상태를 확인해 주세요.'); }
    finally { setOpening(false); }
  }
  return { imageUrl, error, loading, importing, importStatus, opening, importPackage, downloadPdf, retry: () => setVersion(n => n + 1) };
}
