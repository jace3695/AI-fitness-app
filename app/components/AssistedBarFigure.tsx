import {assistedBarPose,type BarPoint} from '../lib/assistedBarMotion';
export default function AssistedBarFigure({progress,label}:{progress:number;label:string}){
 const p=assistedBarPose(progress),q=(v:BarPoint)=>({x:150+.95*v.x,y:250-.95*v.z});
 const points=(...vs:BarPoint[])=>vs.map(v=>`${q(v).x},${q(v).y}`).join(' ');
 const head=q(p.head);
 return <svg viewBox="0 0 300 450" role="img" aria-label={`${label}. 양손과 양발 접촉은 고정되고 작은 몸통 움직임에 무릎이 연동합니다. 아래 확대도는 변화만 3배입니다.`} className="mx-auto w-full max-w-72">
  <path d="M88 31.5H212" stroke="#64748b" strokeWidth="7" strokeLinecap="round"/>
  <path d="M105 250H195" stroke="#94a3b8" strokeWidth="2"/>
  <g fill="none" stroke="#818cf8" strokeWidth="9.5" strokeLinecap="round" strokeLinejoin="round">
   <polyline points={points(p.neck,p.hip)}/>
   <polyline points={points(p.left.shoulder,p.neck,p.right.shoulder)}/>
   {[p.leftLeg,p.rightLeg].map((leg,i)=><polyline key={i} points={points(p.hip,leg.hip,leg.knee,leg.foot,leg.toe)}/>)}
  </g>
  {[p.left,p.right].map((arm,i)=><polyline key={i} points={points(arm.shoulder,arm.elbow,arm.hand)} fill="none" stroke="#3730a3" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>)}
  <circle cx={head.x} cy={head.y} r="13" fill="#c7d2fe" stroke="#4338ca" strokeWidth="3"/>
  <path d="M116 250H130M170 250H184" stroke="#f59e0b" strokeWidth="3"/>
  <text x="16" y="278" fontSize="12" fill="#475569">양발 바닥 지지 · 설치 구조는 생략</text>
  <g transform="translate(0 300)">
   <circle cx="150" cy="45" r="18" fill="none" stroke="#94a3b8" strokeDasharray="3 3"/>
   <circle cx="150" cy={45-3*p.rise} r="18" fill="#c7d2fe" stroke="#4338ca" strokeWidth="2"/>
   <path d="M105 95H195" stroke="#4338ca" strokeWidth="5" strokeLinecap="round"/>
   <path d={`M180 ${45-3*p.rise}V95M176 ${45-3*p.rise}h8M176 95h8`} stroke="#b45309" strokeWidth="2"/>
   <text x="16" y="121" fontSize="11" fill="#475569">귀·어깨 상대 변화 3배 모식 확대</text>
   <text x="16" y="139" fontSize="11" fill="#475569">크기를 따라 하지 마세요 · 발 보조 유지</text>
  </g>
 </svg>;
}
