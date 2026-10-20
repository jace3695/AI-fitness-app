/** Original foot-assisted shoulder preparation; fixed hands/arms, small trunk travel. */
export type BarPoint={x:number;y:number;z:number};
export const assistedBarGuide={
 name:'턱걸이 초기자세',view:'정면 + 상대 움직임 확대',
 outward:'발 지지를 유지하며 어깨가 귀에서 멀어지는 작은 준비 움직임',
 returning:'발 지지를 유지하며 준비 상태로 천천히 돌아오기',
 limitation:'완전 매달리기나 턱걸이 반복이 아닙니다. 손·발 접촉과 팔 길이는 고정하고 작은 몸통·무릎 연동을 모식으로 표시합니다. 실제 발 보조 하중·견갑골 세부 움직임은 계산하지 않습니다.',
 steps:['설치 상태가 확인된 바를 양손으로 잡고 양발을 바닥에 둡니다. 도해의 바 높이는 설치 기준이 아닙니다.',
 '발로 체중을 지지하면서 어깨가 귀에서 멀어지는 작은 준비 움직임을 확인합니다. 발을 떼거나 몸을 크게 끌어올리지 않습니다.',
 '허리를 젖히거나 반동을 주지 않고 제어하며 준비 상태로 돌아옵니다. 시간·횟수는 지정하지 않습니다.'],
 caution:'어깨 통증·저림·지지 불안정이 있으면 중단하세요. 확대도의 움직임 크기를 따라 하지 마세요. 개인별 운동 적합성은 이 도해로 판단할 수 없습니다.',
 sourceTitle:'기존 턱걸이 준비 안내의 발 보조 범위',
 sourceUrl:'',
} as const;
export function assistedBarMotionId(id:string|undefined):'pullup-basic-posture'|null{return id==='pullup-basic-posture'?id:null;}
export function assistedBarPose(progress:number){
 const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
 const lift=p===0||p===1?0:(1-Math.cos(2*Math.PI*p))/2,rise=3*lift;
 const arm=(side:number)=>{
  const shoulder={x:side*22,y:0,z:165},hand={x:side*45,y:0,z:230};
  const d=Math.hypot(23,65),h=Math.sqrt(35**2-d*d/4);
  const elbow={x:side*(33.5+h*65/d),y:0,z:197.5-h*23/d};
  return {shoulder,elbow,hand};
 };
 const leg=(side:number)=>{
  const hip={x:side*18,y:0,z:95+rise},foot={x:side*24,y:0,z:5};
  const distance=hip.z-foot.z,upperYZ2=55**2-6**2,a=(upperYZ2-55**2+distance**2)/(2*distance);
  const knee={x:foot.x,y:Math.sqrt(upperYZ2-a*a),z:hip.z-a};
  return {hip,knee,foot,toe:{x:side*34,y:0,z:5}};
 };
 return {rise,left:arm(-1),right:arm(1),leftLeg:leg(-1),rightLeg:leg(1),head:{x:0,y:0,z:192+rise},neck:{x:0,y:0,z:165+rise},hip:{x:0,y:0,z:95+rise}};
}
