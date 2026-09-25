import type {Attempt,DrawingDocument,OriginalState,OriginalSource,OriginalFrame} from './model.ts';
export const ORIGINAL_SOURCES:Record<string,string[]>={D71:[],D72:['D71'],D73:['D72'],D74:['D73'],D75:['D74'],D76:['D74'],D77:['D74'],D78:['D74','D77'],D79:['D74'],D80:['D74','D78','D79']};
export const PALETTES=[['#6f994d','#c27822'],['#608cc7','#c05c79'],['#8a789f','#b59439']];
export function originalState(a:Attempt):OriginalState {return a.document.original??{projectId:a.id,design:{motif:a.document.example.original?.motif??'sprout',body:'round',mark:'single',palette:0},sources:[],panels:{round:[],tall:[],wave:[],second:[]},active:a.document.lesson.id==='D79'?'wave':'round',expression:'happy',pose:'sit',reason:'',note:'',compared:false,copied:false,features:[]};}
export function originalCandidates(a:Attempt,records:Attempt[],lessonId:string){const s=originalState(a);return records.filter(x=>x.id!==a.id&&x.user_id===a.user_id&&x.revision>0&&x.document.tool==='app'&&x.document.lesson.id===lessonId&&x.document.original?.design.motif===s.design.motif&&originalFrames(x.document).every(f=>f.strokes.length>0)&&(!s.sources.length||x.document.original.projectId===s.projectId));}
export function originalFrames(d:DrawingDocument):OriginalFrame[]{const s=d.original;if(!s)return [];const basic=(strokes=d.strokes,expression:OriginalFrame['expression']='neutral',pose:OriginalFrame['pose']='stand',label='기본형')=>({strokes,expression,pose,label});
 if(d.lesson.id==='D78')return [...s.sources.flatMap(x=>x.frames).slice(0,2),basic(d.strokes,s.expression,'stand',s.expression==='happy'?'반가움':'놀람')];
 if(d.lesson.id==='D79')return [...(s.sources.find(x=>x.lessonId==='D74')?.frames??[]).slice(0,1),basic(s.panels.wave,'neutral','wave','인사'),basic(s.panels.second,'neutral',s.pose,s.pose==='sit'?'앉기':'걷기')];
 if(d.lesson.id==='D72')return [basic(s.panels[s.design.body])];
 if(d.lesson.id==='D77')return [basic(d.strokes,s.expression,'stand',s.expression==='happy'?'반가움':'놀람')];
 return [basic()];}
export function originalSnapshot(a:Attempt):OriginalSource {const s=originalState(a);return structuredClone({attemptId:a.id,revision:a.revision,lessonId:a.document.lesson.id,projectId:s.projectId,design:s.design,character:a.document.character,frames:originalFrames(a.document)});}
export function originalEligible(d:DrawingDocument){if(!d.lesson.originalPractice)return true;const s=d.original;if(!s||!s.compared||d.step!==d.lesson.steps.length-1||!d.character.role.trim()||!d.character.personality.trim())return false;
 if(d.lesson.id==='D72'&&!s.reason.trim())return false;
 if(d.lesson.id==='D80'&&(!d.character.name.trim()||!d.character.improvement.trim()||s.features.length!==2))return false;
 if(d.tool!=='app')return !!s.note.trim();
 if(ORIGINAL_SOURCES[d.lesson.id].some(id=>!s.sources.some(x=>x.lessonId===id)))return false;
 if(d.lesson.id==='D80'){const expressions=s.sources.find(x=>x.lessonId==='D78')!.frames,poses=s.sources.find(x=>x.lessonId==='D79')!.frames;return new Set(expressions.map(x=>x.expression)).size===3&&new Set(poses.map(x=>x.pose)).size===3&&[...expressions,...poses].every(x=>x.strokes.length>0);}
 if(d.lesson.id==='D72')return s.panels.round.length>0&&s.panels.tall.length>0;
 if(d.lesson.id==='D76')return s.copied&&PALETTES[s.design.palette].every(c=>d.strokes.some(x=>!x.erase&&x.color===c));
 const frames=originalFrames(d);if(!frames.length||frames.some(x=>!x.strokes.length))return false;
 if(d.lesson.id==='D78')return new Set(frames.map(x=>x.expression)).size===3;
 if(d.lesson.id==='D79')return new Set(frames.map(x=>x.pose)).size===3;
 return true;}
