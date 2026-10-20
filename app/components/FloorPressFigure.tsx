import { floorPressPose, projectFloorPoint, type Vector3 } from '../lib/floorPressMotion';

export default function FloorPressFigure({ progress, label }: { progress: number; label: string }) {
  const p = floorPressPose(progress);
  return <svg viewBox="0 0 300 450" role="img" aria-label={`${label}. 위 사선은 양팔, 아래 옆면은 한쪽 팔과 바닥 접촉.`} className="mx-auto w-full max-w-72">
    {(['oblique', 'side'] as const).map(view => {
      const project = (v: Vector3) => projectFloorPoint(v, view);
      const points = (...vs: Vector3[]) => vs.map(v => { const q = project(v); return `${q.x},${q.y}`; }).join(' ');
      const head = project(p.head);
      return <g key={view} transform={view === 'side' ? 'translate(0 300)' : undefined}>
        {view === 'oblique' ? <polygon points={points({x:-70,y:-50,z:0},{x:70,y:-50,z:0},{x:70,y:165,z:0},{x:-70,y:165,z:0})} fill="#e2e8f0" stroke="#94a3b8" /> : <path d="M12 110H270" stroke="#94a3b8" strokeWidth="3" />}
        <g fill="none" stroke="#818cf8" strokeWidth={view === 'side' ? 11.4 : 7} strokeLinecap="round" strokeLinejoin="round">
          <polyline points={points(p.left.shoulder, p.leftHip, p.leftKnee, p.leftAnkle, p.leftToe)} />
          {view === 'oblique' && <polyline points={points(p.left.shoulder, p.left.elbow, p.left.hand)} />}
        </g>
        <g fill="none" stroke="#3730a3" strokeWidth={view === 'side' ? 11.4 : 7} strokeLinecap="round" strokeLinejoin="round">
          <polyline points={points(p.head, p.neck, p.hip)} />
          <polyline points={points(p.right.shoulder, p.rightHip, p.rightKnee, p.rightAnkle, p.rightToe)} />
          <polyline points={points(p.left.shoulder, p.right.shoulder)} />
          <polyline points={points(p.right.shoulder, p.right.elbow, p.right.hand)} />
        </g>
        <circle cx={head.x} cy={head.y} r="10.4" fill="#c7d2fe" stroke="#3730a3" strokeWidth="2" />
        {(view === 'oblique' ? [p.left, p.right] : [p.right]).map((arm, i) => {
          const h = project(arm.hand), e = project(arm.elbow);
          return <g key={i}><circle cx={e.x} cy={e.y} r="4" fill="#fbbf24" />
            <path d={`M${h.x-9} ${h.y}h18M${h.x-9} ${h.y-5}v10M${h.x+9} ${h.y-5}v10`} stroke="#475569" strokeWidth="4" strokeLinecap="round" />
          </g>;
        })}
        <text x="15" y={view === 'side' ? 135 : 275} fill="#475569" fontSize="12">{view === 'side' ? '옆면 · 한쪽 팔과 바닥 접촉' : '사선 · 높이를 펼쳐 표시 (동일한 자세)'}</text>
      </g>;
    })}
  </svg>;
}
