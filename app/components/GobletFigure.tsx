import {gobletPose,projectGobletPoint,type GobletPoint} from '../lib/gobletMotion';
export default function GobletFigure({progress,label}:{progress:number;label:string}){
  const p=gobletPose(progress);
  return <svg viewBox="0 0 300 565" role="img" aria-label={`${label}. 정면은 양손 덤벨 지지와 무릎 방향, 옆면은 가슴 앞 하중과 발 접촉.`} className="mx-auto w-full max-w-72">
    {(['front','side'] as const).map(view=>{
      const q=(v:GobletPoint)=>projectGobletPoint(v,view);
      const line=(...vs:GobletPoint[])=>vs.map(v=>`${q(v).x},${q(v).y}`).join(' ');
      const head=q(p.head),top=q(p.weightTop),bottom=q(p.weightBottom);
      return <g key={view} transform={view==='side'?'translate(0 285)':undefined}>
        <path d="M70 250H230" stroke="#94a3b8" strokeWidth="3"/>
        {[p.leftLeg,p.rightLeg].map((leg,i)=><polyline key={i} points={line(leg.hip,leg.knee,leg.ankle,leg.toe)} fill="none" stroke={i?'#3730a3':'#818cf8'} strokeWidth="11.4" strokeLinecap="round" strokeLinejoin="round"/>)}
        <polyline points={line(p.head,p.shoulder,p.hip)} fill="none" stroke="#3730a3" strokeWidth="10" strokeLinecap="round"/>
        <polyline points={line(p.leftLeg.hip,p.rightLeg.hip)} fill="none" stroke="#3730a3" strokeWidth="10" strokeLinecap="round"/>
        <polyline points={line(p.leftArm.shoulder,p.rightArm.shoulder)} fill="none" stroke="#3730a3" strokeWidth="10" strokeLinecap="round"/>
        {[p.leftArm,p.rightArm].map((arm,i)=><polyline key={i} points={line(arm.shoulder,arm.elbow,arm.hand)} fill="none" stroke={i?'#3730a3':'#818cf8'} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>)}
        <circle cx={head.x} cy={head.y} r="13" fill="#c7d2fe" stroke="#3730a3" strokeWidth="3"/>
        <path d={`M${top.x} ${top.y}V${bottom.y}`} stroke="#475569" strokeWidth="5"/>
        <rect x={top.x-11} y={top.y-3.8} width="22" height="7.6" rx="2" fill="#475569"/>
        <rect x={bottom.x-11} y={bottom.y-3.8} width="22" height="7.6" rx="2" fill="#475569"/>
        {[p.leftArm,p.rightArm].map((arm,i)=>{const hand=q(arm.hand);return <circle key={i} cx={hand.x} cy={hand.y} r="3" fill="#fbbf24"/>;})}
        <text x="15" y="275" fontSize="12" fill="#475569">{view==='front'?'정면 · 양손 받침과 무릎/발 방향':'옆면 · 덤벨은 가슴 가까이, 발은 바닥'}</text>
      </g>;
    })}
  </svg>;
}
