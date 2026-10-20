import {routineJoint as joint,routinePose,type RoutinePoint as P} from './routineMotion.ts';
export const cooldownStages=[
{id:'march',name:'천천히 제자리 걷기',peak:.25,guide:'숨이 차면 먼저 천천히 제자리에서 걷습니다. 어지러우면 중단하고 앉아서 호흡을 정리합니다.'},
{id:'shoulder-back',name:'어깨 뒤로 돌리기',peak:.5,guide:'몸통을 세우고 어깨를 작게 뒤로 돌립니다. 허리를 젖히지 않습니다.'},
{id:'chest-open',name:'가슴 가볍게 열기',peak:.5,guide:'팔을 편하게 내린 상태에서 살짝 뒤로 보내며 가슴을 가볍게 엽니다. 허리를 꺾거나 숨을 참지 않습니다.'},
{id:'quad-left',name:'지지하고 왼쪽 앞 허벅지 늘리기',peak:.5,guide:'단단한 지지대를 오른손으로 잡고 왼손으로 왼발 앞쪽을 잡은 준비 자세입니다. 무릎을 나란히 두고 발을 아주 조금 당겼다가 힘을 풉니다. 발이 손에 닿지 않거나 균형이 불안하면 건너뜁니다. 잡기·놓기 전환은 생략했습니다.'},
{id:'quad-right',name:'지지하고 오른쪽 앞 허벅지 늘리기',peak:.5,guide:'양발을 내려 자세를 다시 준비한 뒤 반대쪽을 확인합니다. 지지대를 왼손으로 잡고 오른발 앞쪽을 오른손으로 잡습니다. 무릎을 옆으로 벌리거나 허리를 젖히지 않습니다.'},
{id:'calf-left',name:'왼쪽 종아리 늘리기',peak:.5,guide:'양손을 벽에 대고 왼발을 뒤에 둡니다. 뒤꿈치와 발끝을 바닥에 둔 채 앞 무릎을 조금 굽혔다가 돌아옵니다. 뒤 무릎은 편 상태를 유지합니다.'},
{id:'calf-right',name:'오른쪽 종아리 늘리기',peak:.5,guide:'다시 서서 양발 위치를 바꾼 뒤 오른발을 뒤에 둡니다. 뒤꿈치를 들거나 반동을 주지 않습니다. 좌우 전환은 애니메이션에 포함하지 않았습니다.'},
{id:'breathing',isStatic:true,name:'편안하게 호흡 정리',peak:.5,guide:'편하게 서거나 앉아 코로 들이마시고 입으로 내쉽니다. 그림의 진행 속도에 호흡을 맞출 필요는 없습니다. 이 단계는 정지 자세 안내입니다.'},
] as const;
export type CooldownStageId=typeof cooldownStages[number]['id'];
export const cooldownMotionId=(id:string|undefined)=>id==='basic-cooldown'?'basic-cooldown':null;
export function cooldownPose(id:Exclude<CooldownStageId,'march'>,progress:number){
 const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0,lift=p===0||p===1?0:(1-Math.cos(2*Math.PI*p))/2;
 if(id==='shoulder-back')return {...routinePose('shoulder-roll',.5+p*.5),support:'none' as const,armLengths:[35,32],legLengths:[55,55],phase:lift};
 const quad=id.startsWith('quad'),calf=id.startsWith('calf'),working=id.endsWith('left')?-1:1;
 const y=calf?6*lift:0,z=calf?5+Math.sqrt(110**2-(y+40)**2):105;
 const hip={x:0,y,z},neck={x:0,y,z:z+50},head={x:0,y,z:z+77};
 const leg=(side:number)=>{
  const h={x:side*18,y,z},isWorking=working===side;
  if(quad&&isWorking){const angle=2.3+.15*lift,knee={x:h.x,y:0,z:z-55},foot={x:h.x,y:-55*Math.sin(angle),z:knee.z-55*Math.cos(angle)};return {hip:h,knee,foot,toe:{x:foot.x,y:foot.y+14,z:foot.z},moving:true};}
  const foot={x:h.x,y:calf?(isWorking?-40:40):0,z:5};
  const knee=calf&&isWorking?{x:h.x,y:(h.y+foot.y)/2,z:(h.z+5)/2}:joint(h,foot,55,55,{x:0,y:1,z:0});
  return {hip:h,knee,foot,toe:{x:foot.x,y:foot.y+14,z:5},moving:false};
 };
 const leftLeg=leg(-1),rightLeg=leg(1);
 const arm=(side:number)=>{
  const shoulder={x:side*22,y,z:z+50};let hand:P;
  if(quad)hand=side===working?(side===-1?leftLeg:rightLeg).foot:{x:side*45,y:30,z:120};
  else if(calf)hand={x:side*22,y:70,z:140};
  else {const a=id==='chest-open'?.15*lift:0;hand={x:side*28,y:-78*Math.sin(a),z:shoulder.z-78*Math.cos(a)};}
  return {shoulder,elbow:joint(shoulder,hand,40,45,{x:side,y:0,z:0}),hand};
 };
 return {hip,neck,head,headYaw:0,left:arm(-1),right:arm(1),leftLeg,rightLeg,supported:quad||calf,support:quad?'rail' as const:calf?'wall' as const:'none' as const,armLengths:[40,45],legLengths:[55,55],phase:lift};
}
