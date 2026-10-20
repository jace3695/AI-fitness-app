/** Original standing band pulldown; x lateral, y forward, z up. */
export type LatPoint={x:number;y:number;z:number};
export const latPulldownGuide={
 name:'롱밴드 랫풀다운',view:'정면 + 윗면',
 outward:'몸통을 유지하며 양 팔꿈치를 아래로 당기기',
 returning:'반동 없이 제어하며 손을 위로 되돌리기',
 limitation:'서서 양발을 지지한 변형입니다. 밴드는 머리 뒤가 아니라 몸 앞쪽의 높은 고정점으로 이어집니다. 손잡이·매듭·설치 구조와 실제 저항은 표현하지 않습니다.',
 steps:['제조사 지침에 맞게 설치 상태를 확인한 높은 고정점을 사용합니다. 손상되거나 불안정한 밴드·고정 장치는 사용하지 않습니다.',
 '양발을 바닥에 두고 무릎을 부드럽게 유지합니다. 목과 몸통을 젖히지 않고 팔꿈치를 천천히 아래로 당깁니다.',
 '머리 뒤로 당기거나 몸을 흔들지 않습니다. 팔꿈치를 제어하며 손을 위로 되돌립니다.'],
 caution:'고정 상태가 불확실하거나 통증·저림이 생기면 중단하세요. 그림의 설치 높이·손 간격·가동 범위·저항은 개인별 권장값이 아닙니다.',
 sourceTitle:'PureGym — Lat exercises (수직 당김 원리); 서는 자세는 기존 앱 가이드',
 sourceUrl:'https://www.puregym.com/exercises/back/lat-exercises/',
} as const;
export function latPulldownMotionId(id:string|undefined):'longband-lat-pulldown'|null{return id==='longband-lat-pulldown'?id:null;}
export function latPulldownPose(progress:number){
 const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
 const lift=p===0||p===1?0:(1-Math.cos(2*Math.PI*p))/2;
 const angle=.55+2*lift,upperPlane=Math.sqrt(38**2-10**2),lowerHeight=Math.sqrt(40**2-20**2);
 const arm=(side:number)=>{
  const shoulder={x:side*22,y:0,z:165};
  const elbow={x:side*(22+upperPlane*Math.sin(angle)),y:10,z:165+upperPlane*Math.cos(angle)};
  return {shoulder,elbow,hand:{x:elbow.x,y:30,z:elbow.z+lowerHeight}};
 };
 return {left:arm(-1),right:arm(1),anchor:{x:0,y:90,z:280},head:{x:0,y:0,z:192},hip:{x:0,y:0,z:95},
  leftKnee:{x:-20,y:10,z:50},rightKnee:{x:20,y:10,z:50},leftFoot:{x:-24,y:0,z:5},rightFoot:{x:24,y:0,z:5}};
}
export function projectLat(p:LatPoint,view:'front'|'top'){return {x:150+.95*p.x,y:view==='front'?285-.9*p.z:140-1.1*p.y};}
