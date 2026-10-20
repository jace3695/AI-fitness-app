import {pullApartPose,projectPullPoint,type PullPoint} from '../lib/pullApartMotion';
export default function PullApartFigure({progress,label}:{progress:number;label:string}) {
  const p=pullApartPose(progress);
  return <svg viewBox="0 0 300 455" role="img" aria-label={`${label}. 정면과 윗면은 동일한 양팔 수평 벌림이며 손바닥은 아래 방향입니다.`} className="mx-auto w-full max-w-72">
    {(['front','top'] as const).map(view=>{
      const q=(v:PullPoint)=>projectPullPoint(v,view);
      const line=(...vs:PullPoint[])=>vs.map(v=>`${q(v).x},${q(v).y}`).join(' ');
      return <g key={view} transform={view==='top'?'translate(0 285)':undefined}>
        {view==='front'?<>
          <path d="M95 230H205" stroke="#94a3b8" strokeWidth="3"/>
          <path d="M128.4 68.5H171.6L167 139.75H133Z" fill="#c7d2fe" stroke="#818cf8" strokeWidth="3"/>
          <path d="M150 56V139.75M150 139.75L133.8 224.3H125M150 139.75L166.2 224.3H175" fill="none" stroke="#818cf8" strokeWidth="9" strokeLinecap="round"/>
          <circle cx="150" cy="41.9" r="14" fill="#c7d2fe" stroke="#3730a3" strokeWidth="3"/>
        </>:<>
          <ellipse cx="150" cy="35" rx="17.1" ry="14" fill="#c7d2fe" stroke="#818cf8" strokeWidth="3"/>
          <text x="150" y="12" textAnchor="middle" fontSize="11" fill="#475569">몸통</text>
          <path d="M150 125V138L146 133M150 138L154 133" fill="none" stroke="#64748b" strokeWidth="2"/>
          <text x="164" y="138" fontSize="11" fill="#475569">몸 앞쪽</text>
        </>}
        <polyline points={line(p.left.hand,p.right.hand)} fill="none" stroke="#b45309" strokeWidth="3"/>
        {[p.left,p.right].map((arm,i)=>{
          const e=q(arm.elbow),h=q(arm.hand);
          return <g key={i}>
            <polyline points={line(arm.shoulder,arm.elbow,arm.hand)} fill="none" stroke={i?'#3730a3':'#6366f1'} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx={e.x} cy={e.y} r="3" fill="#fbbf24"/>
            <rect x={h.x-5} y={h.y-3} width="10" height="6" rx="2" fill="#3730a3"/>
          </g>;
        })}
        <text x="15" y={view==='front'?255:162} fontSize="12" fill="#475569">{view==='front'?'정면 · 양손 높이와 몸통 유지':'윗면 · 팔 길이를 유지하며 벌리기'}</text>
      </g>;
    })}
  </svg>;
}
