import {projectSupportedRow,supportedRowPose,type RowPoint} from '../lib/supportedRowMotion';
export default function SupportedRowFigure({progress,label}:{progress:number;label:string}){
 const p=supportedRowPose(progress);
 return <svg viewBox="0 0 300 445" role="img" aria-label={`${label}. 한 손과 양발 지지를 유지하는 원암 로우. 사선과 윗면은 같은 동작입니다.`} className="mx-auto w-full max-w-72">
 {(['oblique','top'] as const).map(view=>{
  const q=(v:RowPoint)=>projectSupportedRow(v,view);
  const points=(...vs:RowPoint[])=>vs.map(v=>`${q(v).x},${q(v).y}`).join(' ');
  const head=q(p.head),hand=q(p.hand);
  return <g key={view} transform={view==='top'?'translate(0 285)':undefined}>
   {view==='oblique'&&<polygon points={points({x:-45,y:-50,z:0},{x:135,y:-50,z:0},{x:135,y:45,z:0},{x:-45,y:45,z:0})} fill="#f1f5f9" stroke="#cbd5e1"/>}
   <polygon points={points(...p.table)} fill="#e2e8f0" stroke="#64748b" strokeWidth="2"/>
   {view==='oblique'&&p.table.filter((_,i)=>i!==1).map((corner,i)=><polyline key={i} points={points(corner,{...corner,z:0})} stroke="#94a3b8" strokeWidth="4"/>)}
   <g fill="none" stroke="#818cf8" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points={points(p.leftToe,p.leftAnkle,p.leftKnee,p.leftHip,p.rightHip,p.rightKnee,p.rightAnkle,p.rightToe)}/>
    <polyline points={points(p.hip,p.neck,p.head)}/>
    <polyline points={points(p.supportShoulder,p.shoulder)}/>
    <polyline points={points(p.supportShoulder,p.supportHand)}/>
   </g>
   <g fill="none" stroke="#818cf8" strokeWidth="9.5" strokeLinecap="round"><polyline points={points(p.leftAnkle,p.leftToe)}/><polyline points={points(p.rightAnkle,p.rightToe)}/></g>
   <circle cx={head.x} cy={head.y} r="12" fill="#c7d2fe" stroke="#4338ca" strokeWidth="3"/>
   <polyline points={points(p.shoulder,p.elbow,p.hand)} fill="none" stroke="#3730a3" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
   <path d={`M${hand.x-12} ${hand.y}h24M${hand.x-12} ${hand.y-7}v14M${hand.x+12} ${hand.y-7}v14`} stroke="#334155" strokeWidth="5" strokeLinecap="round"/>
   <circle cx={q(p.supportHand).x} cy={q(p.supportHand).y} r="4" fill="#f97316"/>
   <text x="18" y={view==='oblique'?258:140} fontSize="12" fill="#475569">{view==='oblique'?'사선 · 양발 바닥, 반대 손 지지':'윗면 · 몸통과 지지 손 고정'}</text>
  </g>;
 })}
 </svg>;
}
