export type DeadBugVariant='opposite-limbs'|'arms-only';
export function deadBugReviewPose(variant:DeadBugVariant,progress:number){
 const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
 const phase=p<.5?p*2:(p-.5)*2,lift=phase===0||phase===1?0:(1-Math.cos(2*Math.PI*phase))/2;
 const active=p<.5?1:-1;
 const hip={x:145,y:0,z:6},shoulder={x:85,y:0,z:6},head={x:60,y:0,z:12};
 const arm=(side:number)=>{const angle=side===active?.55*lift:0,a={...shoulder,y:side*18};const elbow={x:a.x-35*Math.sin(angle),y:a.y,z:a.z+35*Math.cos(angle)},hand={x:a.x-70*Math.sin(angle),y:a.y,z:a.z+70*Math.cos(angle)};return {shoulder:a,elbow,hand};};
 const leg=(side:number)=>{const working=variant==='opposite-limbs'&&side===-active,angle=working?.65*lift:0,shin=working?-.15*lift:0,h={...hip,y:side*15},knee={x:h.x+55*Math.sin(angle),y:h.y,z:h.z+55*Math.cos(angle)},foot={x:knee.x+55*Math.cos(shin),y:h.y,z:knee.z+55*Math.sin(shin)};return {hip:h,knee,foot};};
 return {hip,shoulder,head,left:arm(-1),right:arm(1),leftLeg:leg(-1),rightLeg:leg(1),active:lift===0?0:active};
}
