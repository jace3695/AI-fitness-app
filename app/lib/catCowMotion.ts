/** Original fixed-length schematic spinal chain; not a biomechanical spine model. */
export type CatPoint={x:number;y:number};
export const catCowGuide={
 name:'캣카우',view:'옆면 + 등선 변화 확대',
 outward:'들이쉬며 가슴을 가볍게 열기',returning:'내쉬며 등을 부드럽게 둥글게 만들기',
 limitation:'등선은 실제 척추뼈 개수나 개인의 관절 각도가 아닌 모식 분절선입니다. 확대도는 세로 변화를 3배로 표시합니다. 그림의 굽힘 크기를 따라 늘리지 마세요.',
 steps:['손은 어깨 아래, 무릎은 골반 아래에 두고 네발기기로 준비합니다.',
 '들이쉬며 가슴을 가볍게 열고, 내쉬며 등을 부드럽게 둥글게 만듭니다. 각 동작 사이 중립으로 돌아옵니다.',
 '목을 과하게 젖히거나 숙이지 않고 반동 없이 움직입니다. 손과 무릎의 지지를 유지합니다.'],
 caution:'통증·저림이 있으면 중단하세요. 허리를 과하게 꺾거나 그림의 확대된 등선을 목표로 삼지 마세요. 개인별 가동 범위·횟수는 지정하지 않습니다.',
 sourceTitle:'Mayo Clinic — Cat stretch (동작 원리)',
 sourceUrl:'https://www.mayoclinic.org/healthy-lifestyle/adult-health/in-depth/back-pain/art-20546859',
} as const;
export function catCowMotionId(id:string|undefined):'cat-cow'|null{return id==='cat-cow'?id:null;}
export function catCowPhase(progress:number){
 const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
 if(p===0||p===.5||p===1)return '중립 준비 자세';
 if(p===.25)return '가슴을 가볍게 연 자세';
 if(p===.75)return '등을 둥글게 한 자세';
 return p<.25?'들이쉬며 가슴을 가볍게 열기':p<.5?'중립으로 돌아오기':p<.75?'내쉬며 등을 둥글게 만들기':'중립으로 돌아오기';
}
export function catCowPose(progress:number){
 const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0;
 const wave=p===0||p===1?0:Math.sin(2*Math.PI*p);
 const angle=wave>=0?-.14*wave:-.32*wave;
 const angles=Array.from({length:8},(_,i)=>angle*(-1+2*i/7));
 const span=angles.reduce((sum,a)=>sum+10*Math.cos(a),0);
 const hipX=130-span/2,bodyY=190-Math.sqrt(65**2-(hipX-90)**2);
 const spine:CatPoint[]=[{x:hipX,y:bodyY}];
 for(const a of angles){const last=spine[spine.length-1];spine.push({x:last.x+10*Math.cos(a),y:last.y+10*Math.sin(a)});}
 const shoulder=spine[8];
 return {spine,hip:spine[0],shoulder,hand:{x:170,y:190},knee:{x:90,y:190},ankle:{x:60,y:190},toe:{x:45,y:190},
  head:{x:shoulder.x+25*Math.cos(angle),y:shoulder.y+25*Math.sin(angle)},angle};
}
