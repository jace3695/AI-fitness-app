import {loopWalkPose,projectWalkPoint,type WalkPoint,type LoopWalkId} from '../lib/loopWalkMotion';
export default function LoopWalkFigure({id,progress,label}:{id:LoopWalkId;progress:number;label:string}){
  const p=loopWalkPose(id,progress),q=(v:WalkPoint)=>projectWalkPoint(v,'oblique');
  const line=(...vs:WalkPoint[])=>vs.map(v=>`${q(v).x},${q(v).y}`).join(' ');
  const head=q(p.head),lb=q(p.left.band),rb=q(p.right.band);
  return <svg viewBox="0 0 300 450" role="img" aria-label={`${label}. 아래 발자국에서 주황은 이동, 남색은 바닥 지지.`} className="mx-auto w-full max-w-72">
    <polygon points={line({x:-100,y:-30,z:0},{x:100,y:-30,z:0},{x:100,y:80,z:0},{x:-100,y:80,z:0})} fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1.5"/>
    {[p.left,p.right].map((leg,i)=><g key={i}><polyline points={line(leg.hip,leg.knee,leg.ankle,leg.toe)} fill="none" stroke={i?'#3730a3':'#818cf8'} strokeWidth="11.4" strokeLinecap="round" strokeLinejoin="round"/><circle cx={q(leg.ankle).x} cy={q(leg.ankle).y} r="4" fill={leg.ankle.z>6.01?'#ea580c':'#3730a3'}/></g>)}
    <g fill="none" stroke="#3730a3" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={line(p.head,p.shoulder,p.hip)}/><polyline points={line(p.left.hip,p.right.hip)}/>
      <polyline points={line(p.leftShoulder,p.rightShoulder)}/>
      <polyline points={line(p.leftShoulder,p.leftElbow,p.leftHand)}/><polyline points={line(p.rightShoulder,p.rightElbow,p.rightHand)}/>
    </g>
    <circle cx={head.x} cy={head.y} r="13" fill="#c7d2fe" stroke="#3730a3" strokeWidth="3"/>
    <path d={`M${lb.x-7} ${lb.y-3}L${rb.x+7} ${rb.y-3}V${rb.y+3}L${lb.x-7} ${lb.y+3}Z`} fill="#fbbf24" stroke="#92400e" strokeWidth="1.5"/>
    <text x="15" y="280" fontSize="12" fill="#475569">사선 · 무릎 굽힘과 한 발씩 이동</text>
    <g transform="translate(0 300)">
      <path d="M250 55V25L246 30M250 25L254 30" fill="none" stroke="#64748b" strokeWidth="2"/>
      <text x="262" y="38" fontSize="11" fill="#475569">앞</text>
      {[-1,1].map(side=>{
        const start=projectWalkPoint({x:side*24,y:0,z:0},'footprint');
        const target=projectWalkPoint({x:id==='loopband-sidewalk'?side*24+26:side*32,y:id==='loopband-sidewalk'?0:24,z:0},'footprint');
        return <g key={side}><path d={`M${start.x} ${start.y}L${target.x} ${target.y}`} stroke="#94a3b8" strokeWidth="2" strokeDasharray="3 3"/><rect x={start.x-5} y={start.y-18} width="10" height="20" rx="4" fill="none" stroke="#94a3b8"/></g>;
      })}
      {[p.left,p.right].map((leg,i)=>{const f=projectWalkPoint(leg.ankle,'footprint');return <rect key={i} x={f.x-5} y={f.y-18} width="10" height="20" rx="4" fill={leg.ankle.z>6.01?'#ea580c':'#3730a3'}/>;})}
      <text x="15" y="140" fontSize="12" fill="#475569">발자국 · 주황: 이동 / 남색: 바닥</text>
    </g>
  </svg>;
}
