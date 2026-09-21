export const HANDWRITING_MATERIAL_FOLDER = 'learning/film-v1';
export const HANDWRITING_PACKAGE_FORMAT = 'yeoni-private-handwriting-v1';
export const HANDWRITING_FILE_NAMES = ['workbook.pdf', ...Array.from({ length: 53 }, (_, i) => `page-${String(i + 2).padStart(2, '0')}.webp`)];
export type HandwritingPackage = { format: string; files: { name: string; mimeType: string; base64: string; sha256: string }[] };
export function validateHandwritingPackage(value: unknown): HandwritingPackage {
  if (!value || typeof value !== 'object') throw Error('올바른 교재 묶음 파일이 아니에요.');
  const p = value as HandwritingPackage;
  if (p.format !== HANDWRITING_PACKAGE_FORMAT || !Array.isArray(p.files) || p.files.length !== 54) throw Error('원본 PDF와 53개 연습지가 모두 들어 있는 묶음 파일을 선택해 주세요.');
  const names = new Set<string>();
  for (const file of p.files) {
    if (!file || !HANDWRITING_FILE_NAMES.includes(file.name) || names.has(file.name) || file.mimeType !== (file.name === 'workbook.pdf' ? 'application/pdf' : 'image/webp') || typeof file.base64 !== 'string' || file.base64.length === 0 || file.base64.length > 14_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('교재 파일 구성이 올바르지 않아요.');
    names.add(file.name);
  }
  return p;
}
export function handwritingMaterialPath(owner: string, name: string) {
  if (!/^[a-f0-9-]{36}$/i.test(owner) || (!HANDWRITING_FILE_NAMES.includes(name) && name !== 'ready.txt')) throw Error('올바르지 않은 교재 경로');
  return `${owner}/${HANDWRITING_MATERIAL_FOLDER}/${name}`;
}
