import {routineJoint as joint,type RoutinePoint as P,warmupStages} from './routineMotion.ts';
export type RollerRegion='calf'|'quad'|'glute'|'upper-back';
export type RollerStageId='calf-left'|'calf-right'|'quad-left'|'quad-right'|'glute-left'|'glute-right'|'upper-back';
const pair=(region:'calf'|'quad'|'glute',name:string,guide:string)=>([-1,1] as const).map(side=>({id:`${region}-${side===-1?'left':'right'}` as RollerStageId,name:`${side===-1?'왼쪽':'오른쪽'} ${name}`,peak:.5,guide}));
const calf=pair('calf','종아리','양손을 뒤 바닥에 짚고 반대 발로 지지한 준비 자세입니다. 롤러는 종아리 가운데에 두고 작게 이동합니다. 무릎·발목 관절에 닿지 않게 하며 다리를 겹쳐 압력을 늘리지 않습니다.');
const quad=pair('quad','앞 허벅지','양쪽 전완을 바닥에 두고 반대 발로 지지합니다. 롤러는 앞 허벅지 가운데에 두고 몸을 작게 앞뒤로 옮깁니다. 무릎과 골반 뼈를 굴리지 않습니다.');
const glute=pair('glute','엉덩이','양손과 반대 발로 지지하고 해당 쪽 발목을 반대 무릎에 얹은 준비 자세입니다. 한쪽 엉덩이 연부조직 위에서 작게 이동합니다. 다리 겹치기가 불편하면 건너뜁니다. 꼬리뼈나 허리까지 올라가지 않습니다.');
const upper={id:'upper-back' as const,name:'등 위쪽',peak:.5,guide:'양발로 지지하고 양손으로 머리를 받친 준비 자세입니다. 어깨 아래 등 위쪽의 좁은 구간만 천천히 이동합니다. 목과 허리 아래로 롤러를 보내지 않고 허리를 꺾지 않습니다.'};
export const rollerStages=[...calf,...quad,...glute,upper] as const;
export const rollerPrepStages=[...rollerStages,...warmupStages.map(s=>({...s,id:'warmup-'+s.id,name:'몸풀기 · '+s.name}))];
const deferred=(side:string)=>({id:'outer-'+side,name:(side==='left'?'왼쪽':'오른쪽')+' 바깥 허벅지 · 시범 보류',peak:0,isStatic:true,guide:'기존 “바깥 허벅지” 안내만으로 외측 대퇴 근육과 IT밴드 직접 압박을 구별할 수 없습니다. 전문가가 대상 연부조직·피해야 할 부위·지지 변형을 정하기 전에는 이 장면을 제공하지 않습니다. 회복 루틴 전체는 미완료입니다.'});
export const rollerRecoveryStages=[...calf,...quad,deferred('left'),deferred('right'),...glute,upper];
export const rollerMotionId=(id:string|undefined)=>id==='foam-roller-prep'||id==='foam-roller-recovery'?id:null;
/** Original rigid segment illustration; contact geometry is not a biomechanical pressure model. */
export function rollerPose(id:RollerStageId,progress:number){
 const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0,shift=p===0||p===1?0:8*(1-Math.cos(2*Math.PI*p))/2,travel=2*shift;
 const region:RollerRegion=id.startsWith('calf')?'calf':id.startsWith('quad')?'quad':id.startsWith('glute')?'glute':'upper-back',side=id.endsWith('left')?-1:1;
 const radius=14,skin=6,baseX=region==='calf'?110:region==='quad'?150:region==='glute'?110:170;
 const hip:P={x:baseX+travel,y:0,z:region==='glute'?36.5:34};
 const elbowBase:P={x:70,y:0,z:3.5};
 const shoulder:P=region==='quad'?joint(elbowBase,hip,50,60,{x:0,y:0,z:1}):region==='upper-back'?{x:hip.x-60,y:0,z:34}:{x:hip.x-20,y:region==='glute'?side*6:0,z:hip.z+Math.sqrt(60**2-20**2-(region==='glute'?36:0))};
 const head:P={x:shoulder.x+(shoulder.x-hip.x)*27/60,y:shoulder.y+(shoulder.y-hip.y)*27/60,z:shoulder.z+(shoulder.z-hip.z)*27/60};
 const hips=(s:number):P=>({x:hip.x,y:s*18,z:region==='glute'?(s===side?34:39):34});
 const supportSide=-side,footSupport:P={x:region==='calf'?170:region==='quad'?240:180,y:supportSide*(region==='quad'?35:18),z:6};
 const supportHip=hips(supportSide),supportKnee=joint(supportHip,footSupport,55,55,{x:0,y:0,z:1});
 const leg=(s:number)=>{
  const h=hips(s);let knee:P,foot:P;
  if(region==='upper-back'){foot={x:245,y:s*18,z:6};knee=joint(h,foot,55,55,{x:0,y:0,z:1});}
  else if(s!==side){knee=supportKnee;foot=footSupport;}
  else if(region==='glute'){foot=supportKnee;knee=joint(h,foot,55,55,{x:0,y:s,z:0});}
  else {knee={x:h.x+55,y:h.y,z:34};foot={x:h.x+110,y:h.y,z:34};}
  return {hip:h,knee,foot,grounded:region==='upper-back'||s!==side};
 };
 const leftLeg=leg(-1),rightLeg=leg(1);
 const arm=(s:number)=>{
  const a={...shoulder,y:shoulder.y+s*22};let hand:P,elbow:P;
  if(region==='quad'){elbow={x:70,y:s*22,z:3.5};hand={x:20,y:s*22,z:3.5};}
  else if(region==='upper-back'){hand={x:head.x+4,y:s*10,z:head.z};elbow=joint(a,hand,35,35,{x:0,y:s,z:1});}
  else {hand={x:65,y:s*30,z:3.5};elbow=joint(a,hand,50,50,{x:0,y:s,z:0});}
  return {shoulder:a,elbow,hand};
 };
 const rollerX=(region==='calf'?195:region==='quad'?178:region==='glute'?110:125)+shift;
 const contact:P={x:rollerX,y:region==='upper-back'?0:side*18,z:28};
 const roller={x:rollerX,y:region==='calf'||region==='quad'?side*30:0,z:radius,radius,halfWidth:region==='calf'||region==='quad'?22:36,angle:-shift/radius};
 return {region,side,hip,shoulder,head,left:arm(-1),right:arm(1),leftLeg,rightLeg,roller,contact,skin,travel,shift,armLength:region==='upper-back'?35:50};
}
