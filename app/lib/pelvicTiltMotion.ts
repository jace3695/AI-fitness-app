/** Original small pelvic rotation with fixed floor contact and leg constraints. */
export type PelvicPoint={x:number;y:number};
export const pelvicTiltGuide={
 name:'골반 기울이기',view:'옆면 + 작은 변화 확대',
 outward:'골반을 작게 말아 허리선이 바닥에 가까워지기',returning:'허리를 과하게 띄우지 않고 중립으로 돌아오기',
 limitation:'허리 표면선은 척추뼈 모형이 아닙니다. 확대도의 허리선 변화는 세로 3배, 골반 기호 크기는 2배입니다. 확대 크기를 따라 움직이지 마세요. 골반을 들어 올리는 브리지 동작은 포함하지 않습니다.',
 steps:['누워 무릎을 세우고 발바닥을 바닥에 둡니다. 머리·어깨와 골반의 지지를 유지합니다.',
 '숨을 편하게 내쉬며 골반을 작게 말아 허리가 바닥에 조금 가까워지게 합니다. 골반을 위로 들어 올리거나 허리를 세게 누르지 않습니다.',
 '천천히 중립으로 돌아옵니다. 허리를 더 크게 띄우는 방향으로 이어 가지 않습니다.'],
 caution:'허리 통증·저림이나 힘 조절의 어려움이 있으면 중단하세요. 그림은 개인별 관절 각도·횟수·유지 시간을 처방하지 않습니다.',
 sourceTitle:'Cambridge University Hospitals NHS — Pelvic tilts (뒤로 기울이는 원리)',
 sourceUrl:'https://www.cuh.nhs.uk/patient-information/back-mobility-exercises/',
} as const;
export function pelvicTiltMotionId(id:string|undefined):'pelvic-tilt'|null{return id==='pelvic-tilt'?id:null;}
export function pelvicTiltPose(progress:number){
 const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
 const lift=p===0||p===1?0:(1-Math.cos(2*Math.PI*p))/2,angle=-.12*lift;
 const radiusY=Math.hypot(15*Math.sin(angle),8*Math.cos(angle));
 const center={x:140,y:194-radiusY}; // ellipse stroke radius 1 keeps floor contact at y=195.
 const rotate=(x:number,y:number)=>({x:center.x+x*Math.cos(angle)-y*Math.sin(angle),y:center.y+x*Math.sin(angle)+y*Math.cos(angle)});
 const hip=rotate(6,-3),marker=rotate(8,-7),foot={x:220,y:190};
 const dx=foot.x-hip.x,dy=foot.y-hip.y,d=Math.hypot(dx,dy),h=Math.sqrt(55**2-d*d/4);
 const knee={x:hip.x+dx/2+h*dy/d,y:hip.y+dy/2-h*dx/d};
 return {lift,angle,center,radiusY,hip,marker,knee,foot,toe:{x:240,y:190},head:{x:45,y:182},
  shoulder:{x:68,y:188},backEnd:{x:128,y:188},backControl:{x:98,y:178+10*lift}};
}
