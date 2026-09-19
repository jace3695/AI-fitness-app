import type {AssistantNextActionInput} from './assistantNextAction.ts';
import {buildAssistantNextAction} from './assistantNextAction.ts';
export function dailyBriefing(input:AssistantNextActionInput,mode:'morning'|'evening'){
 const available={tasks:true,budget:true,fitness:true,diet:true,language:true,growth:true,...input.available};
 const open=input.items.filter(item=>!['completed','cancelled'].includes(item.status));
 const due=open.filter(item=>item.due_at&&Number.isFinite(Date.parse(item.due_at))&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(item.due_at))<=input.todayKey);
 const cards=[
  {area:'tasks' as const,label:'할 일',text:`마감 확인 ${due.length}건 · 미완료 ${open.length}건`,href:'#assistant-list'},
  {area:'budget' as const,label:'가계부',text:input.budget.remaining===null?'월 예산 미설정':`${Math.abs(Math.round(input.budget.remaining)).toLocaleString('ko-KR')}원 ${input.budget.remaining<0?'초과':'남음'}`,href:'/budget'},
  {area:'fitness' as const,label:'운동',text:input.fitness.synced?input.fitness.completed?'오늘 완료 기록 있음':input.fitness.isRest?'계획상 회복일':'오늘 완료 미확인':'운동 기록 연결 필요',href:'/fitness'},
  {area:'diet' as const,label:'식단',text:input.diet.synced?input.diet.completed?'오늘 저장 기록 있음':'오늘 식단 저장 미확인':'식단 기록 연결 필요',href:'/diet'},
  {area:'language' as const,label:'일본어',text:input.language.synced?`오늘 ${input.language.completed}/${input.language.total}개 완료`:'학습 기록 연결 필요',href:input.language.nextHref},
  {area:'growth' as const,label:'자기계발',text:`오늘 예정 루틴 ${input.growth.completed}/${input.growth.total}개 완료`,href:'/growth'},
 ].map(card=>({...card,available:available[card.area],text:available[card.area]?card.text:'조회 실패 · 미기록으로 판단하지 않음'}));
 return {title:mode==='morning'?'아침에 확인할 일':'저녁 기록 돌아보기',cards,next:buildAssistantNextAction({...input,hour:mode==='morning'?8:21,available})};
}
