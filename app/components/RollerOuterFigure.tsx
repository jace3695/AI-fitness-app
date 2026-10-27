import { rollerOuterPose, type RollerOuterStageId } from '../lib/rollerOuterMotion';
import type { RoutinePoint as Point } from '../lib/routineMotion';

export default function RollerOuterFigure({ stage, progress, label }: {
  stage: RollerOuterStageId; progress: number; label: string;
}) {
  const p = rollerOuterPose(stage, progress);
  const project = (v: Point) => ({ x: 16 + 0.95 * v.x + 0.35 * v.y, y: 175 - 0.95 * v.z + 0.2 * v.y });
  const points = (...values: Point[]) => values.map(v => {
    const q = project(v);
    return `${q.x.toFixed(3)},${q.y.toFixed(3)}`;
  }).join(' ');
  const working = p.side === -1 ? p.leftLeg : p.rightLeg;
  const support = p.side === -1 ? p.rightLeg : p.leftLeg;
  const r = p.roller, a = project({ ...r, y: r.y - r.halfWidth }), b = project({ ...r, y: r.y + r.halfWidth });
  const head = project(p.head), contact = project(p.contact);
  const insetContactX = 42 + 210 * p.contactFraction;
  const limb = (v: typeof working, color: string) => <polyline points={points(v.hip, v.knee, v.foot)} stroke={color} strokeWidth="12" />;

  return <figure className="mx-auto my-3 w-full max-w-80">
    <svg viewBox="0 35 320 175" role="img" aria-label={`${label}. 아래쪽 전완, 반대 손과 발의 바닥 지지를 유지한 왕복 모식도. 전외측 근육 접촉 의도는 아래 위치도에 따로 표시합니다.`}>
      <polygon points={points({ x: 0, y: -65, z: 0 }, { x: 290, y: -65, z: 0 }, { x: 290, y: 65, z: 0 }, { x: 0, y: 65, z: 0 })} fill="#f1f5f9" stroke="#cbd5e1" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">{limb(support, '#a5b4fc')}</g>
      <g fill="#fed7aa" stroke="#c2410c" strokeWidth="1.5">
        <path d={`M${a.x} ${a.y - r.radius * 0.95}L${b.x} ${b.y - r.radius * 0.95}A${r.radius * 0.95} ${r.radius * 0.95} 0 0 1 ${b.x} ${b.y + r.radius * 0.95}L${a.x} ${a.y + r.radius * 0.95}Z`} />
        <ellipse cx={a.x} cy={a.y} rx={r.radius * 0.95} ry={r.radius * 0.95} />
        <ellipse cx={b.x} cy={b.y} rx={r.radius * 0.95} ry={r.radius * 0.95} />
        <path d={`M${b.x} ${b.y}L${b.x + r.radius * 0.75 * Math.cos(r.angle)} ${b.y - r.radius * 0.75 * Math.sin(r.angle)}`} strokeWidth="2" />
      </g>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {limb(working, '#818cf8')}
        <polyline points={points(p.leftLeg.hip, p.hip, p.rightLeg.hip)} stroke="#818cf8" strokeWidth="10" />
        <polyline points={points(p.hip, p.shoulder)} stroke="#818cf8" strokeWidth="12" />
        <polyline points={points(p.left.shoulder, p.shoulder, p.right.shoulder)} stroke="#818cf8" strokeWidth="10" />
        <polyline points={points(p.shoulder, p.head)} stroke="#818cf8" strokeWidth="6" />
        <polyline points={points(p.target.start, p.target.end)} stroke="#0f766e" strokeWidth="12" />
        {[p.left, p.right].map((v, i) => <polyline key={i} points={points(v.shoulder, v.elbow, v.hand)} stroke="#4338ca" strokeWidth="7" />)}
      </g>
      <circle cx={head.x} cy={head.y} r="11" fill="#c7d2fe" stroke="#4338ca" strokeWidth="2" />
      <circle cx={contact.x} cy={contact.y} r="3" fill="#0f766e" stroke="white" />
      <text x="12" y="202" fontSize="11" fill="#475569">전완 + 반대 손·발 지지 / 초록: 대상 부위</text>
    </svg>
    <svg viewBox="0 0 320 154" role="img" aria-label={`${label}의 위치 구분 모식도. 허벅지 앞쪽과 가쪽 사이의 외측 대퇴사두근이 대상입니다. 가쪽 IT밴드 띠, 골반 가까운 TFL, 무릎과 골반 뼈는 이 장면의 대상이 아닙니다. 정확한 해부학적 경계나 압력 분포를 재현한 그림은 아닙니다.`}>
      <rect x="1" y="1" width="318" height="152" rx="8" fill="#f8fafc" stroke="#cbd5e1" />
      <text x="12" y="20" fontSize="12" fontWeight="600" fill="#334155">{p.side === -1 ? '왼쪽' : '오른쪽'} 허벅지 위치 구분 · 축척 없는 펼친 그림</text>
      <text x="135" y="39" fontSize="11" fill="#475569">앞쪽</text>
      <rect x="42" y="47" width="210" height="52" rx="20" fill="#e0e7ff" stroke="#818cf8" />
      <rect x="111" y="58" width="72" height="27" rx="12" fill="#99f6e4" stroke="#0f766e" />
      <circle cx={insetContactX} cy="72" r="4" fill="#0f766e" />
      <path d="M82 101H238" stroke="#b91c1c" strokeWidth="3" strokeDasharray="5 4" />
      <circle cx="60" cy="88" r="7" fill="none" stroke="#b91c1c" strokeDasharray="3 2" />
      <text x="11" y="68" fontSize="10" fill="#475569">골반</text>
      <text x="263" y="68" fontSize="10" fill="#475569">무릎</text>
      <text x="35" y="124" fontSize="10" fill="#991b1b">TFL 제외</text>
      <text x="135" y="124" fontSize="11" fill="#991b1b">가쪽 IT밴드 띠 제외</text>
      <text x="12" y="143" fontSize="10" fill="#0f766e">초록: 전외측 근육 / 점: 현재 접촉 위치의 대응</text>
    </svg>
    <figcaption className="mt-2 space-y-2 text-sm leading-relaxed text-slate-700">
      <p><strong>대상:</strong> 허벅지 앞쪽과 가쪽 사이의 외측 대퇴사두근입니다. 아래쪽 전완과 반대 손·발의 바닥 지지를 표시합니다.</p>
      <p><strong>목표에서 제외:</strong> 가쪽 IT밴드 띠, 골반 가까운 TFL, 골반의 돌출 뼈, 무릎·슬개골입니다.</p>
      <p>외측 대퇴사두근을 설명하기 위한 새 일반 정의입니다. IT밴드 자체의 압박·늘리기를 목표로 하지 않습니다.
        위치도는 대상 구분용이며 조직의 분리·압력·개인별 적합성을 계산하지 않습니다.</p>
    </figcaption>
  </figure>;
}
