import {routinePose,type RoutineStageId,type RoutinePoint} from '../lib/routineMotion';
import AlternatingExerciseFigure from './AlternatingExerciseFigure';
export default function RoutineFigure({stage,progress,label}:{stage:RoutineStageId;progress:number;label:string}){
 if(stage==='march')return <AlternatingExerciseFigure id="indoor-walk" progress={progress} label={label}/>;
 const p=routinePose(stage,progress),q=(v:RoutinePoint)=>({x:150+.9*v.x+.35*v.y,y:230-.9*v.z+.12*v.y});
 const points=(...vs:RoutinePoint[])=>vs.map(v=>`${q(v).x},${q(v).y}`).join(' ');
 const head=q(p.head),moving=p.leftLeg.moving?p.leftLeg:p.rightLeg;
 return <svg viewBox="0 0 300 385" role="img" aria-label={`${label}. 작은 준비 움직임을 보여 주는 모식도이며 실제 가동 범위를 뜻하지 않습니다.`} className="mx-auto w-full max-w-72">
  <polygon points={points({x:-50,y:-15,z:0},{x:50,y:-15,z:0},{x:50,y:45,z:0},{x:-50,y:45,z:0})} fill="#f1f5f9" stroke="#cbd5e1"/>
  {p.supported&&<g fill="none" stroke="#94a3b8" strokeWidth="4"><polyline points={points({x:-40,y:35,z:0},{x:-40,y:35,z:125},{x:40,y:35,z:125},{x:40,y:35,z:0})}/></g>}
  <g fill="none" stroke="#818cf8" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
   <polyline points={points(p.neck,p.hip)}/>
   <polyline points={points(p.left.shoulder,p.neck,p.right.shoulder)}/>
   {[p.leftLeg,p.rightLeg].map((leg,i)=><polyline key={i} points={points(p.hip,leg.hip,leg.knee,leg.foot,leg.toe)}/>)}
  </g>
  {[p.left,p.right].map((arm,i)=><polyline key={i} points={points(arm.shoulder,arm.elbow,arm.hand)} fill="none" stroke="#4338ca" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>)}
  <ellipse cx={head.x} cy={head.y} rx={13*Math.cos(p.headYaw)} ry="14" fill="#c7d2fe" stroke="#4338ca" strokeWidth="2"/>
  <path d={`M${head.x+10*Math.sin(p.headYaw)} ${head.y-3}v7`} stroke="#4338ca" strokeWidth="2"/>
  <text x="16" y="255" fontSize="11" fill="#475569">{p.supported?'지지대를 잡은 발목 준비 변형':'몸통과 지지를 유지하며 작게 움직이기'}</text>
  {p.supported?<g transform="translate(0 275)">
   <circle cx="110" cy="35" r="5" fill="#4338ca"/>
   <path d={`M110 35L${110+2*(moving.toe.x-moving.foot.x)} ${35+2*(moving.toe.y-moving.foot.y)}`} stroke="#4338ca" strokeWidth="8" strokeLinecap="round"/>
   <path d={`M205 65L${205+2*(moving.toe.y-moving.foot.y)} ${65-2*(moving.toe.z-moving.foot.z)}`} stroke="#4338ca" strokeWidth="8" strokeLinecap="round"/>
   <text x="16" y="94" fontSize="11" fill="#475569">발목 방향 확대 · 윗면 / 옆면, 크기 2배</text>
  </g>:<g transform="translate(0 275)">
   {stage==='neck-turn'?<>
    <circle cx="150" cy="35" r="23" fill="#c7d2fe" stroke="#4338ca" strokeWidth="2"/>
    <path d={`M150 35L${150+30*Math.sin(p.headYaw)} ${35-30*Math.cos(p.headYaw)}`} stroke="#4338ca" strokeWidth="3"/>
    <text x="20" y="94" fontSize="11" fill="#475569">머리 윗면 모식도 · 좌우 보기</text>
   </>:stage==='shoulder-roll'?<>
    <circle cx="150" cy="40" r="22" fill="none" stroke="#94a3b8" strokeDasharray="3 3"/>
    <circle cx={150+5*p.left.shoulder.y} cy={55-5*(p.left.shoulder.z-165)} r="6" fill="#4338ca"/>
    <text x="20" y="94" fontSize="11" fill="#475569">어깨 경로 변화 5배 확대 · 따라 키우지 않기</text>
   </>:<text x="20" y="45" fontSize="11" fill="#475569">속도·크기·반복 횟수는 권장값이 아닙니다</text>}
  </g>}
 </svg>;
}
