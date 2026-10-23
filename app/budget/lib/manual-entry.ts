import {parseWholeAmount} from './history-edit.ts';
export type ManualBudgetDraft={type:'expense'|'income';date:string;amount:string;place:string;category:string;memo:string;payment:string};
export function validBudgetDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
export function manualBudgetItem(draft:ManualBudgetDraft,expenseCategories:readonly string[]){
 const amount=parseWholeAmount(draft.amount);
 if(!validBudgetDate(draft.date)||!['expense','income'].includes(draft.type)||amount===null||amount<=0||!draft.place.trim()||draft.place.trim().length>200||draft.memo.length>1000)throw Error('날짜·금액·이름을 확인해 주세요. 금액은 1원 이상의 정수로 적어요.');
 const categories=draft.type==='income'?['월급','용돈','부업','보너스','이자','기타수입']:expenseCategories;
 if(!categories.includes(draft.category))throw Error('분류를 골라 주세요.');
 return {type:draft.type,date:draft.date,amount,place:draft.place.trim(),category:draft.category,memo:draft.memo.trim(),payment:draft.type==='expense'?draft.payment:'',transaction_type:draft.type==='expense'?'일반 지출':''};
}
