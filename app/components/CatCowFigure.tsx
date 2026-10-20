import {catCowPose,type CatPoint} from '../lib/catCowMotion';
export default function CatCowFigure({progress,label}:{progress:number;label:string}){
 const p=catCowPose(progress),points=(...ps:CatPoint[])=>ps.map(v=>`${v.x},${v.y}`).join(' ');
 const zoom=p.spine.map(v=>({x:50+2*(v.x-p.hip.x),y:75+3*(v.y-p.hip.y)}));
 return <svg viewBox="0 0 300 400" role="img" aria-label={`${label}. 손과 무릎을 고정한 옆모습과 세로 변화 3배의 모식 등선 확대입니다.`} className="mx-auto w-full max-w-72">
  <path d="M25 195H260" stroke="#94a3b8" strokeWidth="2"/>
  <g fill="none" stroke="#6366f1" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round">
   <polyline points={points(p.toe,p.ankle,p.knee,p.hip)}/>
   <polyline points={points(p.shoulder,p.hand)}/>
   <polyline points={points(p.shoulder,p.head)}/>
  </g>
  <polyline points={points(...p.spine)} fill="none" stroke="#3730a3" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round"/>
  <circle cx={p.head.x} cy={p.head.y} r="13" fill="#c7d2fe" stroke="#3730a3" strokeWidth="3"/>
  <text x="20" y="224" fontSize="12" fill="#475569">옆면 · 손과 무릎의 지지 유지</text>
  <g transform="translate(0 250)">
   <path d="M50 75H210" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 3"/>
   <polyline points={points(...zoom)} fill="none" stroke="#3730a3" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
   {zoom.map((v,i)=><circle key={i} cx={v.x} cy={v.y} r="2.5" fill="#f59e0b"/>)}
   <text x="20" y="113" fontSize="11" fill="#475569">모식 등선 · 세로 변화 3배 / 점선은 중립</text>
   <text x="20" y="133" fontSize="11" fill="#475569">확대된 굽힘 크기를 따라 하지 마세요</text>
  </g>
 </svg>;
}
