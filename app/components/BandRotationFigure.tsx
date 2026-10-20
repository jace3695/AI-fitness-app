import { bandRotationPose, projectRotationPoint, type RotationPoint } from '../lib/bandRotationMotion';
export default function BandRotationFigure({progress,label}:{progress:number;label:string}) {
  const p=bandRotationPose(progress);
  return <svg viewBox="0 0 300 440" role="img" aria-label={`${label}. 정면은 고정 상완, 윗면은 전완 회전을 표시합니다.`} className="mx-auto w-full max-w-72">
    {(['front','top'] as const).map(view=>{
      const q=(v:RotationPoint)=>projectRotationPoint(v,view);
      const line=(...vs:RotationPoint[])=>vs.map(v=>`${q(v).x},${q(v).y}`).join(' ');
      const anchor=q(p.anchor),elbow=q(p.elbow),hand=q(p.hand);
      return <g key={view} transform={view==='top'?'translate(0 285)':undefined}>
        {view==='front'?<>
          <path d="M95 230H205" stroke="#94a3b8" strokeWidth="3"/>
          <path d="M128.4 68.5H171.6L167 139.75H133Z" fill="#c7d2fe" stroke="#818cf8" strokeWidth="3"/>
          <path d="M150 56V139.75M150 139.75L133.8 224.3H125M150 139.75L166.2 224.3H175M128.4 68.5V108.4L116 139" fill="none" stroke="#818cf8" strokeWidth="9" strokeLinecap="round"/>
          <circle cx="150" cy="41.9" r="14" fill="#c7d2fe" stroke="#3730a3" strokeWidth="3"/>
          <polyline points={line(p.shoulder,p.elbow)} fill="none" stroke="#3730a3" strokeWidth="10" strokeLinecap="round"/>
        </>:<>
          <ellipse cx="150" cy="50" rx="17.1" ry="14" fill="#c7d2fe" stroke="#818cf8" strokeWidth="3"/>
          <text x="150" y="26" textAnchor="middle" fontSize="11" fill="#475569">몸통</text>
          <path d="M150 114V128L146 123M150 128L154 123" fill="none" stroke="#64748b" strokeWidth="2"/>
          <text x="164" y="127" fontSize="11" fill="#475569">몸 앞쪽</text>
        </>}
        <polyline points={line(p.anchor,p.hand)} fill="none" stroke="#b45309" strokeWidth="3"/>
        <circle cx={anchor.x} cy={anchor.y} r="6" fill="white" stroke="#92400e" strokeWidth="2"/>
        <polyline points={line(p.elbow,p.hand)} fill="none" stroke="#3730a3" strokeWidth="9" strokeLinecap="round"/>
        <circle cx={elbow.x} cy={elbow.y} r="4" fill="#fbbf24"/>
        <circle cx={hand.x} cy={hand.y} r="4" fill="#3730a3"/>
        <text x="16" y={view==='front'?94:82} fontSize="11" fill="#78350f">반대쪽 고정점</text>
        <text x="15" y={view==='front'?255:151} fontSize="12" fill="#475569">{view==='front'?'정면 · 상완과 몸통 고정':'윗면 · 노란 점=고정 팔꿈치'}</text>
      </g>;
    })}
  </svg>;
}
