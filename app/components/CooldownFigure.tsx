import {cooldownPose,type CooldownStageId} from '../lib/cooldownMotion';
import type {RoutinePoint} from '../lib/routineMotion';
import AlternatingExerciseFigure from './AlternatingExerciseFigure';
export default function CooldownFigure({stage,progress,label}:{stage:CooldownStageId;progress:number;label:string}){
 if(stage==='march')return <AlternatingExerciseFigure id="indoor-walk" progress={progress} label={label}/>;
 const p=cooldownPose(stage,progress),q=(v:RoutinePoint)=>({x:150+.8*v.x+.8*v.y,y:220-.9*v.z+.08*v.y});
 const points=(...vs:RoutinePoint[])=>vs.map(v=>`${q(v).x},${q(v).y}`).join(' '),h=q(p.head);
 return <svg viewBox="0 0 300 285" role="img" aria-label={`${label}. 지지와 자세 변화의 모식도이며 가동 범위 처방이 아닙니다.`} className="mx-auto w-full max-w-72">
 <polygon points={points({x:-60,y:-60,z:0},{x:60,y:-60,z:0},{x:60,y:90,z:0},{x:-60,y:90,z:0})} fill="#f1f5f9" stroke="#cbd5e1"/>
 {p.support==='wall'&&<polygon points={points({x:-45,y:70,z:0},{x:45,y:70,z:0},{x:45,y:70,z:180},{x:-45,y:70,z:180})} fill="#e0e7ff" stroke="#94a3b8"/>}
 {p.support==='rail'&&<polyline points={points({x:-55,y:30,z:0},{x:-55,y:30,z:120},{x:55,y:30,z:120},{x:55,y:30,z:0})} fill="none" stroke="#94a3b8" strokeWidth="4"/>}
 <g fill="none" stroke="#818cf8" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"><polyline points={points(p.neck,p.hip)}/><polyline points={points(p.left.shoulder,p.neck,p.right.shoulder)}/>{[p.leftLeg,p.rightLeg].map((a,i)=><polyline key={i} points={points(p.hip,a.hip,a.knee,a.foot,a.toe)}/>)}</g>
 {[p.left,p.right].map((a,i)=><polyline key={i} points={points(a.shoulder,a.elbow,a.hand)} fill="none" stroke="#4338ca" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>)}
 <ellipse cx={h.x} cy={h.y} rx="13" ry="14" fill="#c7d2fe" stroke="#4338ca" strokeWidth="2"/>
 <text x="12" y="260" fontSize="10" fill="#475569">{stage==='breathing'?'정지 자세 · 코로 들이마시고 입으로 내쉬기':stage.startsWith('quad')?'발을 잡은 준비 자세에서 작게 늘리고 풀기':'작은 움직임 · 반동 없이 편한 범위'}</text>
 </svg>;
}
