"use client";
import type {Attempt,DrawingDocument,ProjectState} from '@/lib/drawing/model';
import {projectCandidates,projectEdit,projectSavePatch,projectSessionReady,projectSource,projectState} from '@/lib/drawing/projects';
import {DrawingCanvas,paintStrokes} from './DrawingCanvas';
import {download} from '@/lib/drawing/export';
import PracticeOptions from './PracticeOptions';

const prompts:Record<string,string[]>={
  C01:['오늘의 기분과 유지할 특징 하나','첫 표정에서 눈·입을 어떻게 바꿨나요?','다른 감정과 그대로 둔 특징','두 표정을 비교하고 수정한 한 곳'],
  C02:['인사·앉기·걷기 중 고른 상황과 이유','몸·팔·다리가 향하는 방향','큰 덩어리에 더한 캐릭터 특징','추가한 표정과 기준형에서 유지한 특징'],
  C03:['친구 캐릭터의 다른 역할','다르게 그린 큰 몸 모양','친구만의 구별되는 특징 하나','두 캐릭터의 공통점과 구별점'],
  C04:['캐릭터가 쓰일 화면과 역할','작게 보았을 때 남길 특징','추가한 표정 또는 인사·앉기·걷기 자세','작은 크기에서도 알아볼 수 있는 특징'],
};
export default function ProjectPractice({attempt,records,disabled,onChange,onSave,simple=false,onStartBasic}:{simple?:boolean;onStartBasic?:()=>void;attempt:Attempt;records:Attempt[];disabled:boolean;onChange:(patch:Partial<DrawingDocument>)=>void;onSave:(patch:Partial<DrawingDocument>)=>Promise<boolean|undefined>}) {
  const d=attempt.document,p=projectState(d),id=d.lesson.id,step=d.step;
  const candidates=projectCandidates(attempt,records),two=id==='C01';
  const labels=two?['첫 표정','다른 표정']:['이번 프로젝트 그림','보조 그림'];
  const instructions:Record<string,string[]>={
    C01:['내가 그린 그림을 하나 고르고, 어떤 기분으로 바꿀지 적어요.','고른 그림을 보면서 첫 번째 표정을 그려요. 눈과 입만 바꿔도 좋아요.','이번에는 다른 표정을 그려요. 웃는 얼굴을 놀란 얼굴로 바꿔 볼까요?','두 표정을 나란히 보고, 무엇을 바꿨는지 적어요.'],
    C02:['고른 그림을 인사·앉기·걷기 중 어떤 모습으로 바꿀지 적어요.','몸과 팔·다리가 향할 쪽을 긴 선으로 먼저 그려요.','그 선에 동그라미 같은 큰 모양을 더해 몸을 그려요.','눈과 입을 더하고 처음 그림과 비교해요.'],
    C03:['내 그림의 새 친구를 만들어요. 어떤 일을 하는 친구일까요?','친구의 몸을 동그라미나 네모처럼 큰 모양부터 그려요.','귀·머리·무늬 중 하나를 바꾸어 새 친구의 특징을 만들어요.','두 친구를 비교하고 같은 점과 다른 점을 적어요.'],
    C04:['내 캐릭터를 어디에 쓰고 싶은지 적어요. 예: 프로필 사진.','작은 그림에서도 잘 보이는 특징을 크게 그려요.','표정이나 자세를 하나 바꾸어 그려요.','이름을 붙이고 작은 그림끼리 비교한 뒤 그림 파일로 저장해요.'],
  };
  const examples:Record<string,string[]>={C01:['기쁜 얼굴. 둥근 귀는 그대로 둘 거예요.','입을 위로 휘게 그렸어요.','놀란 얼굴. 눈을 크게 그렸어요.','입 모양은 달라도 같은 귀가 보여요.'],C02:['손을 흔들며 인사하는 모습으로 그릴래요.','오른팔이 위로 향하게 했어요.','몸은 동그랗게 그렸어요.','웃는 입을 넣고 둥근 귀는 남겼어요.'],C03:['꽃을 가꾸는 친구를 만들래요.','몸을 길쭉한 네모로 그렸어요.','머리에 잎사귀를 넣었어요.','눈은 같고 몸 모양은 달라요.'],C04:['내 프로필 사진에 쓰고 싶어요.','동그란 귀를 크게 그렸어요.','한 손을 흔들게 바꿨어요.','작아도 둥근 귀가 잘 보여요.']};
  const missing = p.saved.slice(0,step).some(done=>!done) ? '앞 단계를 먼저 저장해 주세요.' : d.tool==='app'&&!p.source ? '먼저 아래에서 내 그림을 하나 골라 주세요.' : d.tool==='app'&&step>=1&&!p.boards[0].some(s=>!s.erase) ? '빈 연습장에 선을 그려 주세요.' : d.tool==='app'&&step>=2&&two&&!p.boards[1].some(s=>!s.erase) ? '다른 표정도 연습장에 그려 주세요.' : !p.notes[step].trim() ? '아래 메모에 한마디만 적어 주세요.' : step===3&&id==='C04'&&!p.name.trim() ? '그림의 이름을 적어 주세요.' : step===3&&!p.compared ? '그림을 비교한 뒤 확인 표시를 눌러 주세요.' : '';
  function edit(patch:Partial<ProjectState>){onChange(projectEdit(d,patch));}
  function move(next:number){const active=two&&next===2?1:next===3?p.active:0;onChange({step:next,project:{...p,active},strokes:p.boards[active]});}
  function card(){
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=two?1450:1000;
    const ctx=canvas.getContext('2d');if(!ctx)return;ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#34314b';ctx.font='32px sans-serif';ctx.fillText(`${id} · ${p.name||d.lesson.title}`,40,50,1120);
    const frames=[{label:'선택한 내 기준형',strokes:p.source?.strokes??[]},{label:labels[0],strokes:p.boards[0]},...(two?[{label:labels[1],strokes:p.boards[1]}]:[])];
    frames.forEach((frame,i)=>{const x=40+(i%2)*580,y=90+Math.floor(i/2)*590;ctx.font='24px sans-serif';ctx.fillText(frame.label,x,y);const panel=document.createElement('canvas');panel.width=panel.height=530;paintStrokes(panel,frame.strokes,true);ctx.drawImage(panel,x,y+20);});
    canvas.toBlob(blob=>{if(blob)download(blob,`${id}-project-card.png`);},'image/png');
  }
  return <fieldset disabled={disabled} aria-label="지속 프로젝트 연습" className="min-w-0">
    {simple && <div className="drawing-tip"><b>지금은 {step+1}번째 단계예요</b><p className="mt-2">{instructions[id][step]}</p></div>}
    <PracticeOptions simple={simple} title="다른 단계 보기 · 사용 방법"><p className="my-3 text-sm">회차마다 10~20분, 기한 없이 이어 해요. 저장한 원본의 복사본을 보고 연습해요. 회차를 다시 수정하면 그 뒤 회차도 다시 확인해요.</p>
    <div className="mb-4 flex flex-wrap gap-2">{p.saved.map((saved,i)=><button key={i} className={step===i?'drawing-primary':'drawing-button'} disabled={i>0&&!p.saved[i-1]} aria-current={step===i?'step':undefined} onClick={()=>move(i)}>{i+1}회차{saved?' · 저장됨':''}</button>)}</div></PracticeOptions>
    {step===0&&d.tool==='app'&&<><label className="block text-sm">{simple ? "어떤 내 그림을 바꿔 볼까요?" : "기준으로 삼을 내 그림"}<select className="drawing-input mt-2 w-full" value={p.source?.attemptId??''} onChange={e=>{const source=candidates.find(a=>a.id===e.target.value);if(source){const snapshot=projectSource(source);onChange({...projectEdit(d,{source:snapshot}),references:[snapshot.attemptId]});}}}><option value="">여기를 눌러 내 그림 고르기</option>{candidates.map(a=><option key={a.id} value={a.id}>{a.document.lesson.id} · {a.document.character.name||a.document.lesson.title}</option>)}{p.source&&!candidates.some(a=>a.id===p.source!.attemptId)&&<option value={p.source.attemptId}>{p.source.label} · 보관한 복사본</option>}</select></label>{!candidates.length&&!p.source&&<p className="my-3 text-sm">아직 고를 그림이 없어요. 쉬운 그림 하나를 그리고 저장한 뒤 돌아와요.</p>}</>}
    {simple && step===0 && d.tool==='app' && !candidates.length && !p.source && <button className="drawing-primary" onClick={onStartBasic}>쉬운 그림부터 그리기</button>}
    {p.source&&<div className="my-4"><p className="text-sm">따라 볼 내 그림 · {p.source.label} · 처음 그림은 그대로 남아요</p><div className={id==='C04'||simple?'mt-2 w-24':'mt-2 max-w-xs'}><DrawingCanvas strokes={p.source.strokes} preview /></div>{id==='C04'&&<p className="text-xs">작아도 어떤 캐릭터인지 알아볼 수 있나요?</p>}</div>}
    {step>0&&d.tool==='app'&&<>
      {two&&step===3&&<div className="my-3 flex flex-wrap gap-2">{labels.map((label,i)=><button key={label} className={p.active===i?'drawing-primary':'drawing-button'} onClick={()=>onChange({project:{...p,active:i},strokes:p.boards[i]})}>{label} 수정</button>)}</div>}
      <h4 className="my-3 font-semibold">{labels[p.active]}</h4><DrawingCanvas simple={simple} key={`${attempt.id}-${p.active}`} strokes={p.boards[p.active]} disabled={disabled} onChange={strokes=>{const boards=structuredClone(p.boards);boards[p.active]=strokes;edit({boards});}} />
    </>}
    {d.tool!=='app'&&<p className="my-4 text-sm">기준 그림과 회차별 그림을 {d.tool==='paper'?'종이에':'다른 그림 앱에'} 보관해요. 아래 회차 메모에 무엇을 했는지 적고, 사진은 선택해서 가져와요. 앱 안의 선 모음으로 기록하지 않아요.</p>}
    <label className="my-4 block text-sm">{simple ? "무엇을 했나요? 한마디만 적어요." : prompts[id][step]}<textarea aria-label="이번 회차 메모" maxLength={500} placeholder={`예: ${examples[id][step]}`} className="drawing-input mt-2 w-full" value={p.notes[step]} onChange={e=>{const notes=[...p.notes] as ProjectState['notes'];notes[step]=e.target.value;edit({notes});}} /></label>
    {step===3&&<><div className="grid grid-cols-2 gap-3">{(two?p.boards:[p.source?.strokes??[],p.boards[0]]).map((strokes,i)=><div key={i}><p className="text-sm">{two?labels[i]:i===0?'처음 그림':'새 그림'}</p><div className={id==='C04'?'w-24 max-w-full':''}><DrawingCanvas strokes={strokes} preview /></div></div>)}</div>
      {id==='C04'&&<label className="my-3 block text-sm">{simple ? "그림 이름" : "묶음 이름"}<input maxLength={100} className="drawing-input w-full" value={p.name} onChange={e=>edit({name:e.target.value})}/></label>}
      <label className="my-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={p.compared} onChange={e=>edit({compared:e.target.checked})}/>{d.lesson.check} · 직접 비교했어요</label>
      <button className="drawing-button mb-3" disabled={d.tool!=='app'||!projectSessionReady(d)} onClick={card}>{simple ? "그림 카드 내려받기 (PNG)" : "프로젝트 카드 PNG"}</button>
    </>}
    {simple && missing && <p role="status" className="drawing-tip">{missing}</p>}
    <button className="drawing-primary" disabled={!projectSessionReady(d)} onClick={()=>void onSave(projectSavePatch(d))}>{simple ? "이 단계 저장하기" : "이번 회차 저장"}</button>
    {simple && p.saved[step] && step<3 && <button className="drawing-primary ml-2" onClick={()=>move(step+1)}>다음 단계로</button>}
    <p role="status" className="mt-2 text-sm">{p.saved[step]?(step<3?'저장했어요! 다음 단계로 가거나 나중에 이어 해요.':'네 단계를 모두 저장했어요. 아래에서 오늘 연습을 마칠 수 있어요.'):simple?'메모와 그림을 다 했으면 이 단계를 저장해요.':'이번 회차의 선택·그림과 메모를 확인한 뒤 저장해요.'}</p>
    {!simple && <p className="mt-4 text-xs">막히면 학습 지도에서 표정 D62~D64, 자세 D66~D69를 복습해요. 새 각도나 어려운 자세를 추가하지 않아도 돼요.</p>}
  </fieldset>;
}
