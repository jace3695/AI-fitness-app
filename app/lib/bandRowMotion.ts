/** Original side-view geometry; drawing angles are not prescribed ranges. */
export const bandRowGuide = {
  name: '밴드 로우', view: '측면 · 팔꿈치를 굽힌 짧은 로우',
  outward: '몸통을 세운 채 팔꿈치를 뒤로 당기기',
  returning: '밴드를 놓지 않고 천천히 시작 위치로 돌아오기',
  limitation: '팔꿈치를 굽힌 상태에서 시작하는 변형만 보여 줍니다. 견갑골 움직임·손목 회전·밴드 장력과 고정 장치의 안전성은 그림으로 확인할 수 없습니다.',
  steps: ['밴드와 전용 고정 장치의 제조사 지침을 먼저 확인합니다. 그림의 고정점은 설치 방법이 아닙니다.',
    '몸통을 세우고 팔꿈치를 몸 옆에 굽혀 둡니다. 어깨를 으쓱하지 않고 팔꿈치를 천천히 뒤로 이동합니다.',
    '몸을 뒤로 젖히거나 밴드를 갑자기 놓지 않고 시작 위치로 돌아옵니다.'],
  caution: '손상된 밴드나 임의의 문손잡이·가구를 사용하지 마세요. 고정 상태가 불확실하거나 통증·저림이 생기면 중단하세요.',
  sourceTitle: 'AAOS — Shoulder Conditioning / Standing Row',
  sourceUrl: 'https://www.orthoinfo.org/recovery/rotator-cuff-and-shoulder-conditioning-program/',
} as const;
export function bandRowMotionId(value: string | undefined): 'band-row' | null {
  return value === 'band-row' ? value : null;
}
export function bandRowPose(progress: number) {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const pull = p === 0 || p === 1 ? 0 : (1 - Math.cos(2 * Math.PI * p)) / 2;
  const shoulder = { x: 120, y: 100 };
  const angle = .12 - .5 * pull;
  const elbow = { x: shoulder.x + 43 * Math.sin(angle), y: shoulder.y + 43 * Math.cos(angle) };
  const hand = { x: elbow.x + 42, y: elbow.y };
  return { head: { x: 120, y: 73 }, shoulder, hip: { x: 120, y: 181 },
    knee: { x: 125, y: 226 }, ankle: { x: 120, y: 272 }, toe: { x: 142, y: 272 },
    farKnee: { x: 100, y: 226 }, farAnkle: { x: 93, y: 272 }, farToe: { x: 115, y: 272 },
    elbow, hand, anchor: { x: 266, y: 141 } };
}
