/** Original two-bone arm geometry for a standing anti-rotation press. */
export type PallofPoint={x:number;y:number;z:number};
export const pallofGuide={
  name:'밴드 팔로프 프레스',view:'정면 + 윗면 동시',
  outward:'몸통 방향을 유지하며 양손을 몸 앞으로 밀기',
  returning:'옆으로 끌려가지 않도록 제어하며 양손을 가슴 앞으로 돌아오기',
  limitation:'한 방향의 측면 저항 예시입니다. 윗면의 점선은 손이 앞으로 움직이는 방향이며 몸통이 회전하는 경로가 아닙니다. 실제 힘·밴드 저항·복부 긴장을 측정하지 않습니다.',
  steps:['제조사 지침에 맞는 고정 장치와 밴드를 확인합니다. 고정점이 몸 옆, 가슴 높이에 오도록 서서 양손으로 밴드를 잡습니다.',
    '무릎을 부드럽게 유지합니다. 골반과 가슴 방향을 그대로 두고 양손을 천천히 앞으로 밀어냅니다.',
    '어깨·허리를 돌리거나 젖히지 않고 양손을 가슴 앞으로 되돌립니다. 반대쪽은 고정점 방향부터 다시 준비합니다.'],
  caution:'고정 상태가 불확실하거나 몸통을 유지하기 어려우면 중단하세요. 통증·저림이 있으면 멈추세요. 그림의 저항과 팔 뻗는 범위는 개인별 권장값이 아닙니다.',
  sourceTitle:'PureGym — Pallof Press (동작 설명)',
  sourceUrl:'https://www.puregym.com/exercises/abs/pallof-press/',
} as const;
export function pallofMotionId(value:string|undefined):'band-pallof-press'|null{
  return value==='band-pallof-press'?value:null;
}
export function pallofPose(progress:number){
  const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
  const lift=p===0||p===1?0:(1-Math.cos(2*Math.PI*p))/2;
  const arm=(side:number)=>{
    const shoulder={x:side*24,y:0,z:170},hand={x:side*4,y:22+30*lift,z:135};
    const v={x:hand.x-shoulder.x,y:hand.y,z:hand.z-shoulder.z};
    const d2=v.x*v.x+v.y*v.y+v.z*v.z;
    const t=(38**2-32**2+d2)/(2*d2);
    // Downward elbow bend in the plane normal to the shoulder-hand vector.
    const normal={x:v.x*v.z/d2,y:v.y*v.z/d2,z:-1+v.z*v.z/d2};
    const norm=Math.hypot(normal.x,normal.y,normal.z);
    const radius=Math.sqrt(Math.max(0,38**2-t*t*d2));
    const elbow={x:shoulder.x+t*v.x+radius*normal.x/norm,y:t*v.y+radius*normal.y/norm,z:shoulder.z+t*v.z+radius*normal.z/norm};
    return {shoulder,elbow,hand};
  };
  return {left:arm(-1),right:arm(1),grip:{x:0,y:22+30*lift,z:135},
    anchor:{x:-110,y:22,z:135},head:{x:0,y:0,z:198},hip:{x:0,y:0,z:95},
    leftFoot:{x:-24,y:0,z:6},rightFoot:{x:24,y:0,z:6}};
}
export function projectPallofPoint(p:PallofPoint,view:'front'|'top'){
  return {x:150+p.x*.9,y:view==='front'?230-p.z*.95:35+p.y*1.35};
}
