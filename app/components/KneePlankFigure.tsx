import {kneePlankPose,projectKneePlank,type KneePlankPoint} from '../lib/kneePlankMotion';
export default function KneePlankFigure({progress,label}:{progress:number;label:string}){
 const p=kneePlankPose(progress);
 return <svg viewBox="0 0 300 415" role="img" aria-label={`${label}. 굽힌 두 무릎을 겹쳐 두고 팔꿈치와 전완, 아래쪽 무릎을 지지합니다.`} className="mx-auto w-full max-w-72">
 {(['oblique','top'] as const).map(view=>{
  const q=(v:KneePlankPoint)=>projectKneePlank(v,view),points=(...vs:KneePlankPoint[])=>vs.map(v=>`${q(v).x},${q(v).y}`).join(' ');
  const head=q(p.head);
  return <g key={view} transform={view==='top'?'translate(0 260)':undefined}>
   {view==='oblique'&&<polygon points={points({x:10,y:-60,z:0},{x:245,y:-60,z:0},{x:245,y:50,z:0},{x:10,y:50,z:0})} fill="#f1f5f9" stroke="#cbd5e1"/>}
   <g fill="none" stroke="#6366f1" strokeWidth="9.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points={points(p.hand,p.elbow,p.shoulder,p.hip,p.knee,p.ankle,p.toe)}/>
    <polyline points={points(p.shoulder,p.head)}/>
   </g>
   <polyline points={points(p.upperHip,p.upperKnee,p.upperAnkle,p.upperToe)} fill="none" stroke="#a5b4fc" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>
   <polyline points={points(p.shoulder,p.freeElbow,p.hip)} fill="none" stroke="#3730a3" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
   <circle cx={head.x} cy={head.y} r="11" fill="#c7d2fe" stroke="#4338ca" strokeWidth="3"/>
   <circle cx={q(p.elbow).x} cy={q(p.elbow).y} r="3" fill="#f59e0b"/>
   <circle cx={q(p.knee).x} cy={q(p.knee).y} r="3" fill="#f59e0b"/>
   <text x="16" y={view==='oblique'?222:135} fontSize="11" fill="#475569">{view==='oblique'?'사선 · 팔꿈치와 아래 무릎 지지':'윗면 · 굽힌 다리, 전완 접촉은 고정'}</text>
  </g>;
 })}
 </svg>;
}
