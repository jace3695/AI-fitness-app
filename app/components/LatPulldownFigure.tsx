import {latPulldownPose,projectLat,type LatPoint} from '../lib/latPulldownMotion';
export default function LatPulldownFigure({progress,label}:{progress:number;label:string}){
 const p=latPulldownPose(progress);
 return <svg viewBox="0 0 300 520" role="img" aria-label={`${label}. 정면과 윗면으로 높은 앞쪽 고정점과 팔꿈치 하강을 구분합니다.`} className="mx-auto w-full max-w-72">
 {(['front','top'] as const).map(view=>{
  const q=(v:LatPoint)=>projectLat(v,view),points=(...vs:LatPoint[])=>vs.map(v=>`${q(v).x},${q(v).y}`).join(' ');
  const head=q(p.head),anchor=q(p.anchor);
  return <g key={view} transform={view==='top'?'translate(0 330)':undefined}>
   {view==='front'?<>
    <path d="M105 285H195" stroke="#94a3b8" strokeWidth="2"/>
    <g fill="none" stroke="#818cf8" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
     <polyline points={points(p.left.shoulder,p.right.shoulder)}/>
     <polyline points={points({x:0,y:0,z:170},p.hip,p.leftKnee,p.leftFoot,{x:-34,y:0,z:5})}/>
     <polyline points={points(p.hip,p.rightKnee,p.rightFoot,{x:34,y:0,z:5})}/>
    </g>
    <circle cx={head.x} cy={head.y} r="13" fill="#c7d2fe" stroke="#4338ca" strokeWidth="3"/>
   </>:<>
    <ellipse cx="150" cy="140" rx="18" ry="12" fill="#c7d2fe" stroke="#818cf8" strokeWidth="3"/>
    <path d="M245 117V55L241 61M245 55L249 61" fill="none" stroke="#64748b" strokeWidth="2"/>
    <text x="254" y="70" fontSize="11" fill="#475569">앞</text>
   </>}
   {[p.left,p.right].map((arm,i)=><g key={i}>
    <polyline points={points(p.anchor,arm.hand)} fill="none" stroke="#b45309" strokeWidth="3"/>
    <polyline points={points(arm.shoulder,arm.elbow,arm.hand)} fill="none" stroke={i?'#3730a3':'#6366f1'} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx={q(arm.elbow).x} cy={q(arm.elbow).y} r="3" fill="#fbbf24"/>
   </g>)}
   <circle cx={anchor.x} cy={anchor.y} r="5" fill="white" stroke="#92400e" strokeWidth="2"/>
   <text x="165" y={view==='front'?30:40} fontSize="11" fill="#78350f">높은 앞 고정점</text>
   <text x="18" y={view==='front'?313:177} fontSize="12" fill="#475569">{view==='front'?'정면 · 팔꿈치 아래로, 몸통 고정':'윗면 · 밴드는 머리 앞쪽'}</text>
  </g>;
 })}
 </svg>;
}
