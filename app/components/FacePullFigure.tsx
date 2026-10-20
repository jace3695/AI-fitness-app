import {facePullPose,projectFacePull,type FacePoint} from '../lib/facePullMotion';
export default function FacePullFigure({progress,label}:{progress:number;label:string}){
 const p=facePullPose(progress);
 return <svg viewBox="0 0 300 520" role="img" aria-label={`${label}. 밴드와 손은 얼굴 앞쪽에 있으며 몸통과 목은 고정됩니다. 윗면과 옆면은 같은 동작입니다.`} className="mx-auto w-full max-w-72">
 {(['top','side'] as const).map(view=>{
  const q=(v:FacePoint)=>projectFacePull(v,view),points=(...vs:FacePoint[])=>vs.map(v=>`${q(v).x},${q(v).y}`).join(' ');
  const head=q(p.head),anchor=q(p.anchor);
  return <g key={view} transform={view==='side'?'translate(0 240)':undefined}>
   {view==='top'?<>
    <ellipse cx="150" cy="180" rx="21" ry="14" fill="#c7d2fe" stroke="#818cf8" strokeWidth="3"/>
    <path d="M247 118V53L243 59M247 53L251 59" fill="none" stroke="#64748b" strokeWidth="2"/>
    <text x="257" y="64" fontSize="11" fill="#475569">앞</text>
   </>:<>
    <path d="M30 240H125" stroke="#94a3b8" strokeWidth="2"/>
    <path d="M65 94V154.5L74.5 195L65 235.5H82" fill="none" stroke="#818cf8" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx={head.x} cy={head.y} r="13" fill="#c7d2fe" stroke="#4338ca" strokeWidth="3"/>
   </>}
   {(view==='top'?[p.left,p.right]:[p.right]).map((arm,i)=><g key={i}>
    <polyline points={points(p.anchor,arm.hand)} fill="none" stroke="#b45309" strokeWidth="3"/>
    <polyline points={points(arm.shoulder,arm.elbow,arm.hand)} fill="none" stroke={i?'#3730a3':'#6366f1'} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx={q(arm.elbow).x} cy={q(arm.elbow).y} r="3" fill="#fbbf24"/>
   </g>)}
   <circle cx={anchor.x} cy={anchor.y} r="5" fill="white" stroke="#92400e" strokeWidth="2"/>
   <text x={view==='top'?165:180} y={view==='top'?46:73} fontSize="11" fill="#78350f">앞 고정점</text>
   <text x="15" y={view==='top'?222:262} fontSize="12" fill="#475569">{view==='top'?'윗면 · 양손을 벌리며 당김':'옆면 · 얼굴 앞 공간 유지, 양팔 겹침'}</text>
  </g>;
 })}
 </svg>;
}
