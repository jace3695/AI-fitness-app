/** Original constrained arm model. x lateral, y forward, z height. */
export type FacePoint={x:number;y:number;z:number};
export const facePullGuide={
 name:'롱밴드 페이스풀',view:'윗면 + 옆면',
 outward:'몸통과 목을 유지하며 양손을 벌려 얼굴 앞쪽으로 당기기',
 returning:'반동 없이 양손을 앞으로 되돌리기',
 limitation:'윗면은 손을 벌리는 경로, 옆면은 얼굴 앞의 여유 공간을 보여 줍니다. 옆면에서는 양팔이 겹칩니다. 그립 회전·견갑골 세부 움직임·밴드 힘은 측정하지 않습니다.',
 steps:['제조사 지침에 맞는 밴드와 고정 장치의 상태를 확인합니다. 기존 안내처럼 얼굴 높이의 앞 고정점을 사용하고 양발을 바닥에 둡니다.',
 '목을 앞으로 빼거나 허리를 젖히지 않습니다. 팔꿈치를 바깥으로 보내며 양손이 얼굴 양옆 앞쪽으로 오도록 천천히 당깁니다.',
 '밴드를 얼굴에 닿게 하지 않고 제어하며 앞으로 돌아옵니다. 도해의 손 간격과 각도는 목표 범위가 아닙니다.'],
 caution:'고정 상태가 불확실하거나 목·어깨 통증 또는 저림이 생기면 중단하세요. 반동으로 당기지 마세요. 기존 안내와 중단 기준을 우선하세요.',
 sourceTitle:'PureGym — Face Pulls (양손 벌림·팔꿈치 바깥 방향 원리)',
 sourceUrl:'https://www.puregym.com/exercises/arms-and-shoulders/rear-delt-exercises/face-pulls/',
} as const;
export function facePullMotionId(id:string|undefined):'longband-face-pull'|null{return id==='longband-face-pull'?id:null;}
export function facePullPose(progress:number){
 const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
 const lift=p===0||p===1?0:(1-Math.cos(2*Math.PI*p))/2;
 const arm=(side:number)=>{
  const shoulder={x:side*22,y:0,z:165},hand={x:side*(20+28*lift),y:72-48*lift,z:178+10*lift};
  const v={x:hand.x-shoulder.x,y:hand.y,z:hand.z-shoulder.z},d2=v.x*v.x+v.y*v.y+v.z*v.z;
  const t=(38**2-40**2+d2)/(2*d2),dot=(side*v.x+.15*v.z)/d2;
  const n={x:side-dot*v.x,y:-dot*v.y,z:.15-dot*v.z},norm=Math.hypot(n.x,n.y,n.z);
  const r=Math.sqrt(38**2-t*t*d2);
  const elbow={x:shoulder.x+t*v.x+r*n.x/norm,y:t*v.y+r*n.y/norm,z:shoulder.z+t*v.z+r*n.z/norm};
  return {shoulder,elbow,hand};
 };
 return {left:arm(-1),right:arm(1),anchor:{x:0,y:110,z:190},head:{x:0,y:0,z:192},hip:{x:0,y:0,z:95},leftFoot:{x:-24,y:0,z:5},rightFoot:{x:24,y:0,z:5}};
}
export function projectFacePull(p:FacePoint,view:'top'|'side'){
 return view==='top'?{x:150+.95*p.x,y:180-1.2*p.y}:{x:65+.95*p.y,y:240-.9*p.z};
}
