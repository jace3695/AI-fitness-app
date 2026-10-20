/** Original geometry. x: forward, y: lateral, z: height. */
export type RowPoint={x:number;y:number;z:number};
export const supportedRowGuide={
 name:'의자/테이블 지지 원암 덤벨 로우',view:'사선 + 윗면',
 outward:'지지 손과 양발을 유지하며 팔꿈치를 옆구리 쪽으로 당기기',
 returning:'몸통을 돌리지 않고 덤벨을 천천히 내려오기',
 limitation:'한쪽 팔만 보여 줍니다. 반대쪽은 덤벨을 안전하게 내려놓고 지지 자세부터 다시 준비하세요. 양발은 바닥, 반대 손은 받침대에 둔 변형입니다. 받침대 하중·안정성·실제 체중 분포는 계산하지 않습니다.',
 steps:['흔들림과 미끄러짐 없이 체중을 지지할 수 있는 받침대에 한 손을 짚습니다. 양발은 바닥에 두고 몸통을 기울여 준비합니다.',
 '목과 등 방향을 유지하며 팔꿈치를 옆구리 쪽으로 당깁니다. 몸통을 비틀거나 어깨를 으쓱하지 않습니다.',
 '몸통과 지지점을 그대로 두고 팔을 천천히 내립니다. 좌우 변경 과정과 바닥에서 덤벨을 집는 과정은 이 도해에 포함하지 않습니다.'],
 caution:'받침대가 불안정하거나 허리·어깨가 불편하면 중단하세요. 각도·중량·횟수는 권장값이 아닙니다. 기존 안내와 중단 기준을 우선하세요.',
 sourceTitle:'ACE Single-arm Row — 팔 경로·몸통 고정 원리만 참고; 지지 방식은 기존 앱 가이드',
 sourceUrl:'https://www.acefitness.org/resources/everyone/exercise-library/126/single-arm-row/',
} as const;
export function supportedRowMotionId(v:string|undefined):'one-arm-dumbbell-row-supported'|null{
 return v==='one-arm-dumbbell-row-supported'?v:null;
}
function knee(hip:RowPoint,ankle:RowPoint){
 const dx=ankle.x-hip.x,dz=ankle.z-hip.z,d=Math.hypot(dx,dz),a=d/2,h=Math.sqrt(55**2-a*a);
 return {x:hip.x+dx/2+h*(-dz/d),y:hip.y,z:hip.z+dz/2+h*dx/d};
}
export function supportedRowPose(progress:number){
 const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
 const lift=p===0||p===1?0:(1-Math.cos(2*Math.PI*p))/2;
 const angle=1.4*lift;
 const shoulder={x:64,y:20,z:148};
 const elbow={x:64-40*Math.sin(angle),y:20,z:148-40*Math.cos(angle)};
 const hand={x:elbow.x,y:20,z:elbow.z-35};
 const supportShoulder={x:64,y:-20,z:148},supportHand={x:90,y:-20,z:85};
 const leftHip={x:0,y:-20,z:100},rightHip={x:0,y:20,z:100};
 const leftAnkle={x:25,y:-20,z:5},rightAnkle={x:-22,y:20,z:5};
 return {shoulder,elbow,hand,supportShoulder,supportHand,
  hip:{x:0,y:0,z:100},neck:{x:64,y:0,z:148},head:{x:86,y:0,z:164},
  leftHip,rightHip,leftKnee:knee(leftHip,leftAnkle),rightKnee:knee(rightHip,rightAnkle),
  leftAnkle,rightAnkle,leftToe:{...leftAnkle,x:43},rightToe:{...rightAnkle,x:-4},
  table:[{x:70,y:-40,z:85},{x:118,y:-40,z:85},{x:118,y:-6,z:85},{x:70,y:-6,z:85}],
 };
}
export function projectSupportedRow(p:RowPoint,view:'oblique'|'top'){
 return {x:120+.9*p.x-(view==='oblique'?.65*p.y:0),y:view==='oblique'?230-.95*p.z+.25*p.y:65+1.2*p.y};
}
