/** Original horizontal-abduction model; hands stay at upper-chest height. */
export type PullPoint = {x:number;y:number;z:number};
export const pullApartGuide = {
  name:'밴드 풀어파트',view:'정면 + 윗면 동시',
  outward:'팔꿈치를 부드럽게 유지하며 양손을 좌우로 벌리기',
  returning:'몸통을 젖히지 않고 양손을 천천히 앞으로 모으기',
  limitation:'수평 벌림의 한 범위 예시입니다. 손바닥은 아래로 향하는 변형입니다. 정면에서 짧아 보이는 팔의 앞뒤 길이는 윗면에서 확인합니다. 모든 개인에게 그림 끝 범위까지 벌리라는 뜻이 아닙니다.',
  steps:['손상 없는 밴드를 양손으로 잡고 가슴 높이에서 앞으로 둡니다. 손바닥을 아래로 하고 팔꿈치는 완전히 잠그지 않습니다.',
    '어깨를 으쓱하거나 가슴·허리를 젖히지 않고 양손을 천천히 좌우로 벌립니다.',
    '밴드가 튕기지 않도록 제어하며 시작 위치로 돌아옵니다.'],
  caution:'손목을 꺾거나 어깨 앞쪽 통증·저림이 생기면 중단하세요. 그림의 밴드 늘어남은 실제 제품의 저항이나 허용 신장률을 의미하지 않습니다.',
  sourceTitle:'IJSPT — Band Pull-Apart Exercise (2022, 동작 변형)',
  sourceUrl:'https://ijspt.scholasticahq.com/article/33026-band-pull-apart-exercise-effects-of-movement-direction-and-hand-position-on-shoulder-muscle-activity',
} as const;
export function pullApartMotionId(value:string|undefined):'band-pull-apart'|null {
  return value==='band-pull-apart'?value:null;
}
export function pullApartPose(progress:number) {
  const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
  const lift=p===0||p===1?0:(1-Math.cos(2*Math.PI*p))/2;
  const a=1.1*lift;
  const arm=(side:number)=>{
    const shoulder={x:side*24,y:0,z:170};
    const elbow={x:shoulder.x+side*Math.sqrt(38**2-8**2)*Math.sin(a+.08),y:Math.sqrt(38**2-8**2)*Math.cos(a+.08),z:162};
    const hand={x:elbow.x+side*Math.sqrt(32**2-8**2)*Math.sin(a-.08),y:elbow.y+Math.sqrt(32**2-8**2)*Math.cos(a-.08),z:154};
    return {shoulder,elbow,hand};
  };
  return {left:arm(-1),right:arm(1),head:{x:0,y:0,z:198},hip:{x:0,y:0,z:95},
    leftFoot:{x:-18,y:0,z:6},rightFoot:{x:18,y:0,z:6}};
}
export function projectPullPoint(p:PullPoint,view:'front'|'top') {
  return {x:150+p.x*.9,y:view==='front'?230-p.z*.95:35+p.y*1.15};
}
