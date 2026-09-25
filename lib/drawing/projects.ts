import type {Attempt, DrawingDocument, Lesson, Pack, ProjectState} from './model.ts';

export function projectLesson(pack:Pack,id:string):Lesson {
  const p=pack.projects.find(p=>p.id===id);
  if(!p || !/^C0[1-4]$/.test(id)) throw new Error('프로젝트를 찾지 못했어요.');
  const example=pack.lessons.find(l=>l.id==='D74')!.examples[0];
  return {id,stage:9,title:p.title,goal:p.check,instructions:p.sessions,check:p.check,easier:'한 회차에서 한 부분만 시도하고 진행 중으로 저장해요.',help:0,minutes:10,
    examples:[example],steps:p.sessions.map((text,i)=>({text,lines:[],action:i===0?'look':i===3?'compare':'draw'})),references:[],projectPractice:id as 'C01'|'C02'|'C03'|'C04',readiness:{manuscript:true,examples:true,visualMatch:true,browser:false}};
}
export function projectState(doc:DrawingDocument):ProjectState {
  return doc.project ?? {boards:[[],[]],active:0,notes:['','','',''],saved:[false,false,false,false],compared:false,name:''};
}
export function projectCandidates(attempt:Attempt,history:Attempt[]) {
  return history.filter(a=>a.id!==attempt.id&&a.user_id===attempt.user_id&&a.revision>0&&/^D\d{2}$/.test(a.document.lesson.id)&&a.document.tool==='app'&&a.document.strokes.some(s=>!s.erase));
}
export function projectSource(a:Attempt):NonNullable<ProjectState['source']> {
  return {attemptId:a.id,revision:a.revision,lessonId:a.document.lesson.id,label:`${a.document.lesson.id} · ${a.document.character.name || a.document.lesson.title}`,strokes:structuredClone(a.document.strokes)};
}
export function projectEdit(doc:DrawingDocument,patch:Partial<ProjectState>):Partial<DrawingDocument> {
  const old=projectState(doc),p={...old,...patch};
  p.saved=old.saved.map((done,i)=>i<doc.step&&done) as ProjectState['saved'];
  p.compared=patch.compared??false;
  return {project:p,strokes:p.boards[p.active],check:'unconfirmed'};
}
export function projectSessionReady(doc:DrawingDocument):boolean {
  if(!doc.lesson.projectPractice) return true;
  const p=projectState(doc),step=doc.step;
  if(!p.notes[step].trim() || p.saved.slice(0,step).some(done=>!done))return false;
  if(doc.tool==='app') {
    if(!p.source)return false;
    if(step>=1&&!p.boards[0].some(s=>!s.erase))return false;
    if(step>=2&&doc.lesson.id==='C01'&&!p.boards[1].some(s=>!s.erase))return false;
  }
  if(step===3&&(!p.compared||(doc.lesson.id==='C04'&&!p.name.trim())))return false;
  return true;
}
export function projectSavePatch(doc:DrawingDocument):Partial<DrawingDocument> {
  if(!projectSessionReady(doc))throw new Error('이번 회차의 그림과 메모를 확인해 주세요.');
  const p=structuredClone(projectState(doc));p.saved[doc.step]=true;
  return {project:p,strokes:p.boards[p.active]};
}
export function projectEligible(doc:DrawingDocument) {
  return !doc.lesson.projectPractice || (doc.step===3&&projectState(doc).saved.every(Boolean)&&projectSessionReady(doc));
}
