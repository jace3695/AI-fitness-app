import {rollerPose,type RollerStageId} from '../lib/rollerMotion';
import type {RoutinePoint as P} from '../lib/routineMotion';
export default function RollerFigure({stage,progress,label}:{stage:RollerStageId;progress:number;label:string}){
 const p=rollerPose(stage,progress),q=(v:P)=>({x:25+.9*v.x+.35*v.y,y:195-.9*v.z+.2*v.y});
 const points=(...vs:P[])=>vs.map(v=>`${q(v).x},${q(v).y}`).join(' '),r=p.roller,a=q({...r,y:r.y-r.halfWidth}),b=q({...r,y:r.y+r.halfWidth}),h=q(p.head);
 const selected=p.side===-1?p.leftLeg:p.rightLeg;
 return <figure className="mx-auto my-3 w-full max-w-80">
 <svg viewBox="0 45 320 235" role="img" aria-label={`${label}. 손과 발 지지, 롤러의 작은 이동을 보여 주는 자체 모식도입니다. 압력이나 개인별 적합성을 계산하지 않습니다.`} className="mx-auto w-full max-w-80">
 <polygon points={points({x:0,y:-65,z:0},{x:290,y:-65,z:0},{x:290,y:65,z:0},{x:0,y:65,z:0})} fill="#f1f5f9" stroke="#cbd5e1"/>
 <g fill="#fed7aa" stroke="#c2410c" strokeWidth="1.5"><path d={`M${a.x} ${a.y-r.radius*.9}L${b.x} ${b.y-r.radius*.9}A${r.radius*.9} ${r.radius*.9} 0 0 1 ${b.x} ${b.y+r.radius*.9}L${a.x} ${a.y+r.radius*.9}Z`}/><ellipse cx={a.x} cy={a.y} rx={r.radius*.9} ry={r.radius*.9}/><ellipse cx={b.x} cy={b.y} rx={r.radius*.9} ry={r.radius*.9}/><path d={`M${b.x} ${b.y}L${b.x+r.radius*.75*Math.cos(r.angle)} ${b.y-r.radius*.75*Math.sin(r.angle)}`} strokeWidth="2"/></g>
 <g fill="none" strokeLinecap="round" strokeLinejoin="round">
 {[p.leftLeg,p.rightLeg].map((v,i)=><polyline key={i} points={points(v.hip,v.knee,v.foot)} stroke="#818cf8" strokeWidth="12"/>)}
 <polyline points={points(p.leftLeg.hip,p.hip,p.rightLeg.hip)} stroke="#818cf8" strokeWidth="10"/>
 <polyline points={points(p.hip,p.shoulder)} stroke="#818cf8" strokeWidth="12"/>
 {(p.region==='calf'||p.region==='quad')&&<polyline points={points({...selected.hip,x:(p.region==='calf'?selected.knee.x:selected.hip.x)+15},{...selected.hip,x:(p.region==='calf'?selected.foot.x:selected.knee.x)-15})} stroke="#0f766e" strokeWidth="12"/>}
 {p.region==='upper-back'&&<polyline points={points({...p.shoulder,x:p.shoulder.x+5},{...p.shoulder,x:p.shoulder.x+30})} stroke="#0f766e" strokeWidth="12"/>}
 {p.region==='glute'&&<polyline points={points({...selected.hip,x:selected.hip.x-18},{...selected.hip,x:selected.hip.x+18})} stroke="#0f766e" strokeWidth="12"/>}
 {[p.left,p.right].map((v,i)=><polyline key={i} points={points(v.shoulder,v.elbow,v.hand)} stroke="#4338ca" strokeWidth="7"/>)}
 </g>
 <circle cx={h.x} cy={h.y} r="11" fill="#c7d2fe" stroke="#4338ca" strokeWidth="2"/>
 {[p.left,p.right].map((v,i)=>{const pt=q(v.hand);return <circle key={i} cx={pt.x} cy={pt.y} r="3.5" fill="#4338ca"/>;})}
 <text x="12" y="230" fontSize="10" fill="#475569">초록: 대상 부위 · 주황: 롤러 · 접촉 모식도</text>
 <text x="12" y="250" fontSize="10" fill="#475569">작은 구간만 이동 · 관절·목·허리 직접 압박 제외</text>
 <text x="12" y="270" fontSize="10" fill="#475569">바닥 준비·좌우 자세 전환은 별도로 수행</text>
 </svg>
 <figcaption className="mt-2 space-y-2 text-sm leading-relaxed text-slate-700">
  <p>초록: 대상 부위 · 주황: 롤러 · 접촉 모식도</p>
  <p>작은 구간만 이동 · 관절·목·허리 직접 압박 제외</p>
  <p>바닥 준비·좌우 자세 전환은 별도로 수행</p>
 </figcaption>
 </figure>;
}
