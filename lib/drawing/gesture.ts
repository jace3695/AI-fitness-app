import type {DrawingDocument} from './model.ts';
export function gestureState(doc:DrawingDocument):NonNullable<DrawingDocument['gesture']>{
 return doc.gesture ?? {trace:[],surface:'free',choice:'',directionChecked:false,compared:false,note:''};
}
export function gestureEligible(doc:DrawingDocument){
 if(!doc.lesson.gesturePractice)return true;
 const g=gestureState(doc);
 return doc.step===doc.lesson.steps.length-1 && g.directionChecked && g.compared;
}
