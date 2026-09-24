import type {Attempt,DrawingDocument,IdentitySource,IdentityState} from './model.ts';
export function identityState(doc:DrawingDocument):IdentityState {
 return doc.identity ?? {features:[],choice:doc.example.identity?.options[0].id??'main',compared:false,note:'',collection:[]};
}
export function identityLines(doc:DrawingDocument) {
 const s=identityState(doc),source=s.collection.find(x=>x.attemptId===s.editing);
 return source?.lines??doc.example.identity?.options.find(o=>o.id===s.choice)?.lines??doc.example.lines;
}
export function identityCandidates(current:Attempt,records:Attempt[],kind:'baseline'|'collection') {
 const allowed=kind==='baseline'?['D61']:current.document.lesson.id==='D65'?['D62','D63','D64']:['D66','D67','D68','D69'];
 return records.filter(a=>a.id!==current.id&&a.user_id===current.user_id&&a.revision>0&&a.document.tool==='app'&&a.document.strokes.length>0&&a.document.example.identity?.family===current.document.example.identity?.family&&allowed.includes(a.document.lesson.id));
}
export function identitySnapshot(source:Attempt):IdentitySource {
 return {attemptId:source.id,revision:source.revision,lessonId:source.document.lesson.id,family:source.document.example.identity!.family,label:`${source.document.lesson.id} · ${source.document.example.name}`,lines:structuredClone(identityLines(source.document)),strokes:structuredClone(source.document.strokes)};
}
export function identityReferences(s:IdentityState){return [...new Set([...(s.baseline?[s.baseline.attemptId]:[]),...s.collection.map(x=>x.attemptId)])];}
export function identityEligible(doc:DrawingDocument) {
 if(!doc.lesson.identityPractice)return true;
 const s=identityState(doc);
 if(doc.step!==doc.lesson.steps.length-1||s.features.length!==2||!s.compared)return false;
 if(doc.lesson.id==='D69'&&!s.note.trim())return false;
 if(['D65','D70'].includes(doc.lesson.id)) {
  if(!s.note.trim())return false;
  if(doc.tool!=='app')return true; // Paper/external comparisons are explicitly self-reported.
  if(!s.editing||!s.collection.some(x=>x.attemptId===s.editing))return false;
  if(doc.lesson.id==='D65')return new Set(s.collection.map(x=>x.lessonId)).size>=3;
  return !!s.baseline && new Set(s.collection.map(x=>x.lessonId)).size>=2;
 }
 return true;
}
