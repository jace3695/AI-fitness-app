import {pallofPose,projectPallofPoint,type PallofPoint} from '../lib/pallofMotion';
export default function PallofFigure({progress,label}:{progress:number;label:string}){
  const p=pallofPose(progress);
  return <svg viewBox="0 0 300 455" role="img" aria-label={`${label}. 옆 고정점의 저항을 받으며 몸통은 고정하고 손만 앞으로 움직입니다.`} className="mx-auto w-full max-w-72">
    {(['front','top'] as const).map(view=>{
      const q=(v:PallofPoint)=>projectPallofPoint(v,view);
      const line=(...vs:PallofPoint[])=>vs.map(v=>`${q(v).x},${q(v).y}`).join(' ');
      const anchor=q(p.anchor),grip=q(p.grip);
      return <g key={view} transform={view==='top'?'translate(0 285)':undefined}>
        {view==='front'?<>
          <path d="M95 230H205" stroke="#94a3b8" strokeWidth="3"/>
          <path d="M128.4 68.5H171.6L167 139.75H133Z" fill="#c7d2fe" stroke="#818cf8" strokeWidth="3"/>
          <path d="M150 56V139.75M150 139.75L132 180L128.4 224.3H119M150 139.75L168 180L171.6 224.3H181" fill="none" stroke="#818cf8" strokeWidth="9" strokeLinecap="round"/>
          <circle cx="150" cy="41.9" r="14" fill="#c7d2fe" stroke="#3730a3" strokeWidth="3"/>
        </>:<>
          <ellipse cx="150" cy="35" rx="17.1" ry="14" fill="#c7d2fe" stroke="#818cf8" strokeWidth="3"/>
          <text x="150" y="12" textAnchor="middle" fontSize="11" fill="#475569">몸통 방향 유지</text>
          <path d="M150 53V128L146 123M150 128L154 123" fill="none" stroke="#64748b" strokeWidth="2" strokeDasharray="4 3"/>
          <text x="164" y="128" fontSize="11" fill="#475569">몸 앞으로</text>
        </>}
        <polyline points={line(p.anchor,p.grip)} fill="none" stroke="#b45309" strokeWidth="3"/>
        <circle cx={anchor.x} cy={anchor.y} r="6" fill="white" stroke="#92400e" strokeWidth="2"/>
        <text x="15" y={view==='front'?84:53} fontSize="11" fill="#78350f">옆 고정점</text>
        {[p.left,p.right].map((arm,i)=>{
          const e=q(arm.elbow);
          return <g key={i}><polyline points={line(arm.shoulder,arm.elbow,arm.hand)} fill="none" stroke={i?'#3730a3':'#6366f1'} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/><circle cx={e.x} cy={e.y} r="3" fill="#fbbf24"/></g>;
        })}
        <path d={`M${grip.x-5} ${grip.y}h10`} stroke="#3730a3" strokeWidth="7" strokeLinecap="round"/>
        <text x="15" y={view==='front'?255:162} fontSize="12" fill="#475569">{view==='front'?'정면 · 몸통과 골반 고정':'윗면 · 손은 앞으로, 밴드는 옆에서'}</text>
      </g>;
    })}
  </svg>;
}
