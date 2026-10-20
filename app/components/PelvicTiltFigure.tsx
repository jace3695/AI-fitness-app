import {pelvicTiltPose} from '../lib/pelvicTiltMotion';
export default function PelvicTiltFigure({progress,label}:{progress:number;label:string}){
 const p=pelvicTiltPose(progress),degrees=p.angle*180/Math.PI;
 return <svg viewBox="0 115 300 285" role="img" aria-label={`${label}. 골반은 바닥 지지를 유지합니다. 허리 표면선과 골반 방향을 확대한 모식도를 함께 보여 줍니다.`} className="mx-auto w-full max-w-72">
  <path d="M20 195H267" stroke="#94a3b8" strokeWidth="2"/>
  <circle cx={p.head.x} cy={p.head.y} r="12" fill="#c7d2fe" stroke="#4338ca" strokeWidth="2"/>
  <circle cx={p.shoulder.x} cy={p.shoulder.y} r="7" fill="#6366f1"/>
  <path d={`M57 185L68 188Q98 ${p.backControl.y} 128 188`} fill="none" stroke="#4338ca" strokeWidth="6" strokeLinecap="round"/>
  <ellipse cx={p.center.x} cy={p.center.y} rx="15" ry="8" transform={`rotate(${degrees} ${p.center.x} ${p.center.y})`} fill="#c7d2fe" stroke="#4338ca" strokeWidth="2"/>
  <path d={`M${p.hip.x} ${p.hip.y}L${p.knee.x} ${p.knee.y}L220 190H240`} fill="none" stroke="#6366f1" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round"/>
  <circle cx={p.marker.x} cy={p.marker.y} r="3" fill="#f59e0b"/>
  <text x="18" y="222" fontSize="12" fill="#475569">옆면 · 골반과 발의 바닥 지지 유지</text>
  <g transform="translate(0 255)">
   <path d="M30 92H170" stroke="#94a3b8" strokeWidth="2"/>
   <path d={`M40 70Q100 ${40+30*p.lift} 160 70`} fill="none" stroke="#4338ca" strokeWidth="5"/>
   <path d="M40 70Q100 40 160 70" fill="none" stroke="#94a3b8" strokeDasharray="3 3"/>
   <ellipse cx="225" cy="70" rx="30" ry="16" transform={`rotate(${degrees} 225 70)`} fill="#c7d2fe" stroke="#4338ca" strokeWidth="2"/>
   <path d="M225 70L241 56" transform={`rotate(${degrees} 225 70)`} stroke="#b45309" strokeWidth="3"/>
   <text x="20" y="114" fontSize="11" fill="#475569">허리 표면 변화 세로 3배 · 골반 기호 2배</text>
   <text x="20" y="133" fontSize="11" fill="#475569">확대 크기는 운동 목표가 아닙니다</text>
  </g>
 </svg>;
}
