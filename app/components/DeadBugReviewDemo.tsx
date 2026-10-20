'use client';
import {deadBugReviewPose,type DeadBugVariant} from '../lib/deadBugReviewMotion';
import type {RoutinePoint as P} from '../lib/routineMotion';
import StagedMotionDemo from './StagedMotionDemo';
const stages=[{id:'opposite-limbs',name:'검토 A · 반대 팔·다리 작은 움직임',peak:.25,guide:'이미 양팔과 무릎을 올린 준비 자세에서 오른팔·왼다리, 왼팔·오른다리를 번갈아 움직이는 축소 범위 초안입니다. 개인에게 허용된 범위가 아니며 허리가 뜨는지 그림으로 판단할 수 없습니다.'},{id:'arms-only',name:'검토 B · 다리는 유지하고 팔만',peak:.25,guide:'다리는 준비 자세로 유지하고 양팔만 번갈아 움직이는 별도 초안입니다. 이 변형도 개인에게 안전하거나 적합하다고 판정하지 않았습니다. 통증이 있는 상태에서 따라 할 대안으로 자동 추천하지 않습니다.'}];
function renderFigure(id:string,progress:number,label:string){
 const p=deadBugReviewPose(id as DeadBugVariant,progress),q=(v:P)=>({x:20+.95*v.x+.4*v.y,y:150-v.z+.2*v.y}),points=(...vs:P[])=>vs.map(v=>`${q(v).x},${q(v).y}`).join(' '),h=q(p.head);
 return <svg viewBox="0 30 300 175" role="img" aria-label={`${label}. 개인 적용 전 검토용이며 카탈로그에 연결하지 않은 시범입니다.`} className="mx-auto w-full max-w-80">
 <polygon points={points({x:25,y:-40,z:0},{x:265,y:-40,z:0},{x:265,y:40,z:0},{x:25,y:40,z:0})} fill="#f1f5f9" stroke="#cbd5e1"/>
 <g fill="none" strokeLinecap="round" strokeLinejoin="round"><polyline points={points(p.shoulder,p.hip)} stroke="#818cf8" strokeWidth="12"/>{[p.leftLeg,p.rightLeg].map((v,i)=><polyline key={i} points={points(v.hip,v.knee,v.foot)} stroke={i===0?'#0f766e':'#818cf8'} strokeWidth="8"/>)}{[p.left,p.right].map((v,i)=><polyline key={i} points={points(v.shoulder,v.elbow,v.hand)} stroke={i===0?'#0f766e':'#4338ca'} strokeWidth="7"/>)}</g>
 <circle cx={h.x} cy={h.y} r="12" fill="#c7d2fe" stroke="#4338ca"/>
 <text x="12" y="180" fontSize="11" fill="#475569">{p.active===0?'준비 자세':p.active===1?'오른팔 차례 · 초록은 왼쪽 팔다리':'왼팔 차례 · 초록은 왼쪽 팔다리'}</text>
 <text x="12" y="198" fontSize="10" fill="#475569">범위·속도는 처방값이 아닙니다</text>
 </svg>;
}
/** Review-only entry. Intentionally not imported by ExerciseMotionDemo or any catalog resolver. */
export default function DeadBugReviewDemo(){return <StagedMotionDemo title="데드버그 · 미연결 검토 초안" intro="적용할 변형은 아직 선택하지 않았습니다. 기존 제한·추천을 바꾸지 않으며 이 초안을 완성 시연으로 집계하지 않습니다." stages={stages} renderFigure={renderFigure}/>;}
