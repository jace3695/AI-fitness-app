/** Original front-loaded squat landmarks, with a separately constrained vertical dumbbell. */
export type GobletPoint={x:number;y:number;z:number};
export const gobletGuide={
  name:'덤벨 고블릿 스쿼트',view:'정면 + 옆면 동시',
  outward:'덤벨을 가슴 앞에 유지하며 엉덩이와 무릎을 굽히기',
  returning:'발의 지지를 유지하며 천천히 일어서기',
  limitation:'양손으로 세로 덤벨 윗부분을 받친 변형입니다. 덤벨을 집어 들거나 내려놓는 과정은 표시하지 않습니다. 그림의 깊이·발 간격·중량을 개인별 목표로 삼지 마세요.',
  steps:['발끝을 약간 바깥으로 두고 양발로 바닥을 지지합니다. 덤벨을 세로로 가슴 가까이에 두고 양손으로 윗부분을 받칩니다.',
    '가슴이 무너지거나 덤벨이 몸에서 멀어지지 않도록 유지하며 엉덩이와 무릎을 천천히 굽힙니다.',
    '무릎이 발 방향을 따르도록 확인하며 발의 지지를 유지하고 천천히 일어섭니다.'],
  caution:'통증·저림, 균형 상실, 그립 불안정이나 허리 과신전이 생기면 중단하세요. 그림만 보고 하중을 정하거나 깊이를 늘리지 마세요.',
  sourceTitle:'NASM — Goblet Squat (동작 설명)',
  sourceUrl:'https://www.nasm.org/resource-center/exercise-library/goblet-squat',
} as const;
export function gobletMotionId(value:string|undefined):'dumbbell-goblet-squat'|null{
  return value==='dumbbell-goblet-squat'?value:null;
}
export function gobletPose(progress:number){
  const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
  const lift=p===0||p===1?0:(1-Math.cos(2*Math.PI*p))/2;
  const kneeY=25*lift,kneeOut=kneeY/3,kneeZ=6+Math.sqrt(58**2-kneeY**2-kneeOut**2);
  const hipY=kneeY-57*lift,hipZ=kneeZ+Math.sqrt(60**2-(4+kneeOut)**2-(57*lift)**2);
  const lean=.25*lift,shoulderY=hipY+78*Math.sin(lean),shoulderZ=hipZ+78*Math.cos(lean);
  const arm=(side:number)=>{
    const shoulder={x:side*24,y:shoulderY,z:shoulderZ};
    const hand={x:side*7,y:shoulderY+24,z:shoulderZ-14};
    const v={x:hand.x-shoulder.x,y:24,z:-14},d2=v.x*v.x+v.y*v.y+v.z*v.z;
    const t=(35**2-32**2+d2)/(2*d2),radius=Math.sqrt(35**2-t*t*d2);
    const normal={x:v.x*v.z/d2,y:v.y*v.z/d2,z:-1+v.z*v.z/d2},norm=Math.hypot(normal.x,normal.y,normal.z);
    const elbow={x:shoulder.x+t*v.x+radius*normal.x/norm,y:shoulder.y+t*v.y+radius*normal.y/norm,z:shoulder.z+t*v.z+radius*normal.z/norm};
    return {shoulder,elbow,hand};
  };
  const leg=(side:number)=>({hip:{x:side*20,y:hipY,z:hipZ},knee:{x:side*(24+kneeOut),y:kneeY,z:kneeZ},ankle:{x:side*24,y:0,z:6},toe:{x:side*30,y:18,z:6}});
  return {leftArm:arm(-1),rightArm:arm(1),leftLeg:leg(-1),rightLeg:leg(1),
    hip:{x:0,y:hipY,z:hipZ},shoulder:{x:0,y:shoulderY,z:shoulderZ},
    head:{x:0,y:shoulderY+24*Math.sin(lean),z:shoulderZ+24*Math.cos(lean)},
    weightTop:{x:0,y:shoulderY+24,z:shoulderZ-10},weightBottom:{x:0,y:shoulderY+24,z:shoulderZ-32}};
}
export function projectGobletPoint(p:GobletPoint,view:'front'|'side'){
  return {x:150+(view==='front'?p.x:p.y)*.95,y:250-p.z*.95};
}
