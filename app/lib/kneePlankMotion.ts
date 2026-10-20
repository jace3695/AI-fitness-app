/** Original constrained side-plank geometry; x head-to-knee, y front, z up. */
export type KneePlankPoint={x:number;y:number;z:number};
export const kneePlankGuide={
 name:'무릎 사이드 플랭크',view:'사선 + 윗면',
 outward:'팔꿈치와 아래쪽 무릎을 지지하며 골반 올리기',returning:'앞뒤로 흔들지 않고 골반을 천천히 낮추기',
 limitation:'팔꿈치로 지지한 낮은 준비 자세에서 한쪽 골반의 올림·내림만 보여 줍니다. 바닥에 눕거나 반대쪽으로 돌아눕는 전환은 포함하지 않습니다. 무릎을 굽힌 두 다리는 겹쳐 둡니다.',
 steps:['옆으로 누워 무릎을 굽히고 팔꿈치와 전완으로 지지할 준비를 합니다. 위쪽 손은 골반에 둡니다.',
 '지지 팔꿈치가 어깨 아래에 오도록 유지하며 골반을 천천히 올립니다. 몸통이 앞뒤로 돌거나 어깨가 귀 쪽으로 올라가지 않게 합니다.',
 '골반을 제어하며 낮춥니다. 반대쪽은 자세를 완전히 다시 준비한 후 확인합니다. 유지 시간이나 반복 횟수는 이 도해에서 정하지 않습니다.'],
 caution:'허리·어깨 통증이나 저림, 지지 불안정이 있으면 중단하세요. 그림의 상승 높이나 관절 각도를 개인 목표로 삼지 마세요.',
 sourceTitle:'Royal Berkshire NHS — Side planks with bent legs (문서 5쪽)',
 sourceUrl:'https://www.royalberkshire.nhs.uk/media/u3rjel1a/strength-and-conditioning-exercise-class_jul25.pdf',
} as const;
export function kneePlankMotionId(id:string|undefined):'knee-side-plank'|null{return id==='knee-side-plank'?id:null;}
export function kneePlankPose(progress:number){
 const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
 const lift=p===0||p===1?0:(1-Math.cos(2*Math.PI*p))/2;
 const angle=.1*(1-lift)**2;
 const elbow={x:70,y:0,z:5},hand={x:70,y:35,z:5};
 const shoulder={x:70+45*Math.sin(angle),y:0,z:5+45*Math.cos(angle)};
 const knee={x:70+Math.sqrt(145**2-45**2),y:0,z:5};
 const dx=knee.x-shoulder.x,dz=knee.z-shoulder.z,d=Math.hypot(dx,dz),a=(80**2-65**2+d*d)/(2*d);
 const h=Math.sqrt(Math.max(0,80**2-a*a));
 const hip={x:shoulder.x+a*dx/d+h*dz/d,y:0,z:shoulder.z+a*dz/d-h*dx/d};
 const head={x:shoulder.x+24*(shoulder.x-hip.x)/80,y:0,z:shoulder.z+24*(shoulder.z-hip.z)/80};
 const ankle={x:knee.x,y:-45,z:5},toe={x:knee.x+12,y:-45,z:5};
 // Free hand rests on hip; solve a fixed 45/40 upper/lower arm in the torso plane.
 const vx=hip.x-shoulder.x,vz=hip.z-shoulder.z,t=(45**2-40**2+80**2)/(2*80**2),r=Math.sqrt(45**2-(t*80)**2);
 const freeElbow={x:shoulder.x+t*vx+r*(-vz/80),y:0,z:shoulder.z+t*vz+r*vx/80};
 const upper=(v:KneePlankPoint)=>({...v,z:v.z+8});
 return {elbow,hand,shoulder,knee,hip,head,ankle,toe,freeElbow,upperHip:upper(hip),upperKnee:upper(knee),upperAnkle:upper(ankle),upperToe:upper(toe)};
}
export function projectKneePlank(p:KneePlankPoint,view:'oblique'|'top'){
 return {x:40+.85*p.x+(view==='oblique'?.5*p.y:0),y:view==='oblique'?180-.95*p.z+.2*p.y:80+.8*p.y};
}
