export type TemplateAsset = { id: string; path: string; label: string; group: string; sha256: string; size: number; lessonIds: string[]; note: string };
const LIMIT = 15_000_000;
export async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}
export function templatePath(owner: string, asset: TemplateAsset) {
  if (!/^[a-f0-9-]{36}$/i.test(owner) || !/^tpl-[a-f0-9]{12}$/.test(asset.id) || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw Error("자료 경로 오류");
  return `${owner}/learning/drawing/universal-150-v1/${asset.id}-${asset.sha256}.png`;
}

// Read only known central-directory entries, then verify the ORIGINAL PNG byte hashes.
// No extraction paths, JS, SVG, arbitrary files, or zip64 archives are executed/imported.
export async function readTemplateZip(buffer: ArrayBuffer, assets: TemplateAsset[]) {
  if (buffer.byteLength > LIMIT || buffer.byteLength < 22) throw Error("15MB 이하의 원본 템플릿 ZIP을 선택해 주세요.");
  const view = new DataView(buffer); let end = -1;
  for (let p = buffer.byteLength - 22; p >= Math.max(0, buffer.byteLength - 65_557); p--) {
    if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === buffer.byteLength) { end = p; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw Error("원본 ZIP 구성을 확인하지 못했어요.");
  const count = view.getUint16(end + 10, true); let cursor = view.getUint32(end + 16, true);
  if (count > 500 || count !== view.getUint16(end + 8, true) || cursor + view.getUint32(end + 12, true) !== end) throw Error("지원하지 않는 ZIP 구성이에요.");
  const wanted = new Map(assets.map(a => [a.path, a])); const found = new Set<string>();
  const results: { asset: TemplateAsset; bytes: Uint8Array<ArrayBuffer> }[] = [];
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw Error("ZIP 목록이 손상됐어요.");
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true), raw = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true), next = cursor + 46 + nameLength + extra + comment;
    if (next > end) throw Error("ZIP 파일 이름이 손상됐어요.");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(buffer, cursor + 46, nameLength));
    cursor = next; const asset = wanted.get(name); if (!asset) continue;
    if (found.has(name) || (flags & 1) || ![0, 8].includes(method) || raw !== asset.size || raw > 200_000 || compressed > LIMIT || local + 30 > end) throw Error("템플릿 원본과 다른 ZIP이에요.");
    if (view.getUint32(local, true) !== 0x04034b50) throw Error("ZIP 이미지가 손상됐어요.");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + compressed > end) throw Error("ZIP 이미지 범위 오류");
    let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(buffer.slice(start, start + compressed));
    if (method === 8) {
      let decoder: DecompressionStream;
      try { decoder = new DecompressionStream("deflate-raw"); } catch { throw Error("이 브라우저는 ZIP 풀기를 지원하지 않아요. 최신 데스크톱 브라우저에서 한 번 등록해 주세요."); }
      const reader = new Blob([bytes]).stream().pipeThrough(decoder).getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) { const result = await reader.read(); if (result.done) break; size += result.value.length; if (size > raw) { await reader.cancel(); throw Error("템플릿 이미지 크기가 다릅니다."); } chunks.push(result.value); }
      bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    }
    if (bytes.length !== raw || await sha256(bytes) !== asset.sha256) throw Error("템플릿 원본과 파일 내용이 달라요.");
    found.add(name); results.push({ asset, bytes });
  }
  if (results.length !== assets.length) throw Error("원본 템플릿 150종이 모두 들어 있는 ZIP을 선택해 주세요.");
  return results;
}
