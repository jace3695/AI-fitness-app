import bundled from "../../content/drawing/foundations-v1.json";
import { parsePack, type Pack } from "./model.ts";
import { localRead, localWrite } from "./local-store.ts";

export const bundledPack = parsePack(bundled);
const MAX_PACK_BYTES = 3_000_000;
// The URL is configured once. Editors publish versioned JSON at that feed without changing app code.
export async function loadDrawingPack(url?: string): Promise<{ pack: Pack; notice: string }> {
  let pack = bundledPack;
  // Without a feed, a previous feed's cache must not hide updated bundled artwork.
  // Existing attempts still retain their own immutable lesson snapshot.
  if (!url) return { pack, notice: "" };
  try { const cached = await localRead<unknown>("verified-pack"); if (cached) pack = parsePack(cached); } catch { /* bundled fallback */ }
  try {
    if (new URL(url).protocol !== "https:") throw Error("HTTPS required");
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store", credentials: "omit" });
    if (!response.ok || Number(response.headers.get("content-length")) > MAX_PACK_BYTES) throw Error("pack response");
    const reader = response.body?.getReader(); if (!reader) throw Error("empty pack");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_PACK_BYTES) { await reader.cancel(); throw Error("pack too large"); } chunks.push(value); }
    const data = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    const next = parsePack(JSON.parse(new TextDecoder().decode(data)));
    if (next.id !== bundledPack.id) throw Error("pack identity");
    // Feed cannot replace a released lesson with an unreviewed candidate.
    for (const previous of pack.lessons.filter(l => l.readiness.visualMatch)) {
      if (!next.lessons.find(l => l.id === previous.id)?.readiness.visualMatch) throw Error("released lesson removed");
    }
    await localWrite("verified-pack", next);
    return { pack: next, notice: next.version === pack.version ? "" : "새 학습팩을 준비했어요. 진행 중인 그림은 원래 버전으로 유지돼요." };
  } catch { return { pack, notice: "새 학습팩을 확인하지 못해 마지막으로 확인한 내용을 사용해요." }; }
}
