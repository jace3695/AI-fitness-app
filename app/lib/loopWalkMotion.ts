/** Original footfall sequences and constant-length 3D legs, not captured motion. */
export type LoopWalkId='loopband-sidewalk'|'loopband-monster-walk';
export type WalkPoint={x:number;y:number;z:number};
const common={
  view:'사선 + 발자국 평면도',
  limitation:'무릎 위 밴드의 짧은 이동·복귀 예시입니다. 주황 발자국은 이동 중, 남색은 바닥 지지를 뜻합니다. 실제 체중 분배·동적 균형·밴드 저항을 계산하지 않습니다.',
  caution:'통증·저림, 균형 상실이나 밴드 말림이 생기면 중단하세요. 밴드를 무릎 관절 위에 직접 두지 마세요. 보폭·깊이·저항을 그림에 맞춰 늘리지 마세요.',
  sourceTitle:'ACE — Glute Medius Exercises / Lateral Band Walks & Monster Walks',
  sourceUrl:'https://www.acefitness.org/resources/pros/expert-articles/6936/6-glute-medius-exercises-for-strength-amp-stability/',
};
export const loopWalkGuides={
  'loopband-sidewalk':{...common,name:'루프밴드 사이드워크',outward:'옆으로 한 발 옮기고 다른 발이 따라오기',returning:'반대 방향으로 한 발씩 돌아오기',
    steps:['밴드를 무릎 관절보다 위의 허벅지에 두고 양발을 벌립니다. 무릎과 엉덩이를 약간 굽혀 준비합니다.',
      '몸통과 골반 높이를 유지하며 한 발을 옆으로 들어 옮깁니다. 반대발을 끌지 않고 간격을 유지하며 따라옵니다.',
      '반대 방향도 같은 방식으로 한 발씩 옮깁니다. 두 발이 교차하거나 서로 붙지 않도록 합니다.']},
  'loopband-monster-walk':{...common,name:'루프밴드 몬스터워크',outward:'발을 번갈아 대각선 앞으로 옮기기',returning:'발을 번갈아 뒤로 옮겨 돌아오기',
    steps:['밴드를 무릎 관절보다 위의 허벅지에 두고 양발을 벌립니다. 무릎과 엉덩이를 약간 굽혀 준비합니다.',
      '한 발씩 대각선 앞으로 들어 옮깁니다. 몸통이 크게 흔들리거나 무릎이 안쪽으로 무너지지 않도록 합니다.',
      '뒤로 돌아올 때도 발을 끌지 않고 한 발씩 옮깁니다. 이동 공간과 뒤쪽 장애물을 먼저 확인합니다.']},
} as const;
export function loopWalkMotionId(value:string|undefined):LoopWalkId|null{
  return value==='loopband-sidewalk'||value==='loopband-monster-walk'?value:null;
}
const smooth=(t:number)=>t*t*t*(10+t*(-15+6*t));
export function loopWalkPose(id:LoopWalkId,progress:number){
  const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
  const phase=Math.min(3,Math.floor(p*4)),t=p===1?1:p*4-phase,u=smooth(t);
  // Per-stage targets: lateral travel right/left versus diagonal forward/back.
  const states=id==='loopband-sidewalk'
    ? [[-24,0,24,0],[-24,0,50,0],[2,0,50,0],[-24,0,50,0],[-24,0,24,0]]
    : [[-24,0,24,0],[-24,0,32,24],[-32,24,32,24],[-32,24,24,0],[-24,0,24,0]];
  const from=states[phase],to=states[phase+1];
  const moving=from[0]!==to[0]||from[1]!==to[1]?'left':'right';
  const height=t===0||t===1?0:8*Math.sin(Math.PI*t)**2;
  const leftAnkle={x:from[0]+(to[0]-from[0])*u,y:from[1]+(to[1]-from[1])*u,z:6+(moving==='left'?height:0)};
  const rightAnkle={x:from[2]+(to[2]-from[2])*u,y:from[3]+(to[3]-from[3])*u,z:6+(moving==='right'?height:0)};
  const centerX=(leftAnkle.x+rightAnkle.x)/2,centerY=(leftAnkle.y+rightAnkle.y)/2;
  const leg=(side:number,ankle:WalkPoint)=>{
    const hip={x:centerX+side*20,y:centerY,z:108};
    // Knee stays in the toe's sagittal plane. Solve two circles in y/z.
    const dx=ankle.x-hip.x,dy=ankle.y-hip.y,dz=ankle.z-hip.z,d2=dy*dy+dz*dz;
    const upperYZ2=60**2-dx*dx;
    const along=(upperYZ2-58**2+d2)/(2*d2);
    const radius=Math.sqrt(Math.max(0,upperYZ2-along*along*d2)),length=Math.sqrt(d2);
    const knee={x:ankle.x,y:hip.y+along*dy-radius*dz/length,z:hip.z+along*dz+radius*dy/length};
    const band={x:hip.x+.75*(knee.x-hip.x),y:hip.y+.75*(knee.y-hip.y),z:hip.z+.75*(knee.z-hip.z)};
    return {hip,knee,ankle,toe:{x:ankle.x,y:ankle.y+18,z:ankle.z},band};
  };
  const body=(x:number,y:number,z:number)=>({x:centerX+x,y:centerY+y,z});
  return {phase,moving,left:leg(-1,leftAnkle),right:leg(1,rightAnkle),
    hip:body(0,0,108),shoulder:body(0,14,184),head:body(0,18,210),
    leftShoulder:body(-24,14,184),rightShoulder:body(24,14,184),
    leftElbow:body(-20,25,143),rightElbow:body(20,25,143),
    leftHand:body(-5,34,158),rightHand:body(5,34,158)};
}
export function loopWalkPhase(id:LoopWalkId,progress:number){
  const p=loopWalkPose(id,progress);
  if(progress>=1)return '시작 위치로 돌아와 두 발 지지';
  return id==='loopband-sidewalk'
    ? ['화면 오른쪽 발을 옆으로 옮기기','화면 왼쪽 발이 간격을 유지하며 따라오기','화면 왼쪽 발을 반대 방향으로 옮기기','화면 오른쪽 발이 간격을 유지하며 따라오기'][p.phase]
    : ['화면 오른쪽 발을 대각선 앞으로','화면 왼쪽 발을 대각선 앞으로','화면 오른쪽 발을 뒤로','화면 왼쪽 발을 뒤로'][p.phase];
}
export function projectWalkPoint(p:WalkPoint,view:'oblique'|'footprint'){
  return view==='oblique'?{x:140+p.x*.8+p.y*.65,y:245-p.z*.95+p.y*.25}:{x:140+p.x*.95,y:100-p.y*1.1};
}
