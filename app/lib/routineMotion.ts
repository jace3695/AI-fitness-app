/** Original staged routine geometry. No exercise prescription or automatic stage advancement. */
export type RoutinePoint={x:number;y:number;z:number};
export type RoutineStageId='neck-turn'|'shoulder-roll'|'hip-shift'|'small-knee-bend'|'ankle-left'|'ankle-right'|'march';
export const warmupStages=[
 {id:'neck-turn',name:'목을 가볍게 좌우로 보기',peak:.25,guide:'몸통은 그대로 두고 목을 편한 범위에서 천천히 좌우로 돌립니다. 목을 크게 원으로 돌리거나 끝까지 밀지 않습니다.'},
 {id:'shoulder-roll',name:'어깨 앞뒤로 돌리기',peak:.25,guide:'목과 몸통을 유지하고 어깨를 작은 원으로 앞뒤로 움직입니다. 팔을 크게 휘두르거나 힘껏 으쓱하지 않습니다.'},
 {id:'hip-shift',name:'골반 좌우로 움직이기',peak:.25,guide:'양발을 바닥에 두고 골반과 몸통을 작게 좌우로 옮깁니다. 허리를 크게 비틀지 않습니다.'},
 {id:'small-knee-bend',name:'무릎 살짝 굽혔다 펴기',peak:.5,guide:'양발 지지를 유지하며 무릎을 작게 굽혔다가 돌아옵니다. 도해의 깊이를 목표로 삼지 않습니다.'},
 {id:'ankle-left',name:'지지하고 왼쪽 발목 돌리기',peak:.25,guide:'흔들리지 않는 지지대를 양손으로 잡고 한쪽 발을 살짝 든 준비 자세에서 발목만 작게 돌립니다. 지지대를 준비할 수 없거나 균형이 불안하면 이 단계를 생략합니다.'},
 {id:'ankle-right',name:'지지하고 오른쪽 발목 돌리기',peak:.25,guide:'다시 양발을 바닥에 두고 지지 상태를 확인한 뒤 반대쪽 발목을 작게 돌립니다. 발을 드는 전환은 이 장면에 포함하지 않습니다.'},
 {id:'march',name:'제자리 걷기',peak:.25,guide:'공간을 확인하고 천천히 제자리에서 걷습니다. 어지럽거나 균형이 흔들리면 중단합니다.'},
] as const;
export function routineMotionId(id:string|undefined):'basic-warmup'|null{return id==='basic-warmup'?id:null;}
export function routineJoint(a:RoutinePoint,b:RoutinePoint,l1:number,l2:number,preferred:RoutinePoint){
 const v={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},d2=v.x*v.x+v.y*v.y+v.z*v.z;
 const t=(l1*l1-l2*l2+d2)/(2*d2),dot=(preferred.x*v.x+preferred.y*v.y+preferred.z*v.z)/d2;
 const n={x:preferred.x-dot*v.x,y:preferred.y-dot*v.y,z:preferred.z-dot*v.z},norm=Math.hypot(n.x,n.y,n.z),r=Math.sqrt(Math.max(0,l1*l1-t*t*d2));
 return {x:a.x+t*v.x+r*n.x/norm,y:a.y+t*v.y+r*n.y/norm,z:a.z+t*v.z+r*n.z/norm};
}
export function routinePose(id:Exclude<RoutineStageId,'march'>,progress:number){
 const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
 const wave=p===0||p===1?0:Math.sin(2*Math.PI*p),lift=p===0||p===1?0:(1-Math.cos(2*Math.PI*p))/2;
 const shift=id==='hip-shift'?5*wave:0,drop=id==='small-knee-bend'?6*lift:0,back=id==='small-knee-bend'?-8*lift:0;
 const hip={x:shift,y:back,z:95-drop},neck={x:shift,y:back,z:165-drop};
 const ankle=id==='ankle-left'||id==='ankle-right';
 const rollTime=p<.5?p*2:(p-.5)*2,rollDir=p<.5?1:-1;
 const shoulderY=id==='shoulder-roll'&&p!==0&&p!==.5&&p!==1?rollDir*3*Math.sin(2*Math.PI*rollTime):0;
 const shoulderZ=id==='shoulder-roll'?3*(1-Math.cos(2*Math.PI*rollTime)):0;
 const arm=(side:number)=>{
  const shoulder={x:shift+side*22,y:back+shoulderY,z:165-drop+shoulderZ};
  const hand=ankle?{x:side*22,y:35,z:125}:{x:shift+side*28,y:back+shoulderY,z:100-drop+shoulderZ};
  return {shoulder,elbow:routineJoint(shoulder,hand,35,32,{x:side,y:0,z:0}),hand};
 };
 const leg=(side:number)=>{
  const moving=(id==='ankle-left'&&side===-1)||(id==='ankle-right'&&side===1);
  const thigh={x:shift+side*18,y:back,z:95-drop},foot={x:side*24,y:0,z:moving?12:5};
  const yaw=moving?.25*wave:0,pitch=moving?.15*(1-Math.cos(2*Math.PI*p)):0;
  const toe={x:foot.x+18*Math.sin(yaw)*Math.cos(pitch),y:18*Math.cos(yaw)*Math.cos(pitch),z:foot.z+18*Math.sin(pitch)};
  return {hip:thigh,knee:routineJoint(thigh,foot,55,55,{x:0,y:1,z:0}),foot,toe,moving};
 };
 return {hip,neck,head:{x:shift,y:back,z:192-drop},headYaw:id==='neck-turn'?.35*wave:0,left:arm(-1),right:arm(1),leftLeg:leg(-1),rightLeg:leg(1),supported:ankle};
}
