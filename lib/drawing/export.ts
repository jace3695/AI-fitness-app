import type { Attempt, Example } from "./model";

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export function exportAttempt(attempt: Attempt) {
  // Do not include account identifiers in portable exports.
  download(new Blob([JSON.stringify({ schemaVersion: 1, status: attempt.status, document: attempt.document }, null, 2)], { type: "application/json" }), `${attempt.document.lesson.id}-my-drawing.json`);
}
export function exportExample(example: Example, constructionIds?: string[]) {
  // Paths have been schema validated and contain no markup or external URLs.
  const paths = example.lines.filter(l => constructionIds ? constructionIds.includes(l.id) && l.group === "guide" : l.group !== "guide" && l.group !== "gesture").map(l => `<path d="${l.d}"${l.fill === "ink" ? ' fill="#161616" stroke="none"' : ''}/>`).join("");
  download(new Blob([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="800" height="800"><rect width="400" height="400" fill="white"/><g fill="none" stroke="#34314b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`], { type: "image/svg+xml" }), `${example.id}-${constructionIds ? "construction" : "example"}.svg`);
}
export async function compressPhoto(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 15_000_000) throw Error("JPG·PNG·WebP 사진을 15MB 이하로 선택해 주세요.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    const ctx = canvas.getContext("2d"); if (!ctx) throw Error("사진 준비 실패");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", .8); if (data.length > 1_500_000) throw Error("사진이 커요. 그림 부분만 잘라서 다시 선택해 주세요."); return data;
  } finally { URL.revokeObjectURL(url); }
}
