'use client';
import {useRef,useState} from 'react';
import {getLocalDateKey} from '@/utils/dateKey';
import type {ManualBudgetDraft} from './manual-entry';
const empty=():ManualBudgetDraft=>({type:'expense',date:getLocalDateKey(),amount:'',place:'',category:'기타',memo:'',payment:'현금'});
// Owned by BudgetDashboard, so tab unmounts do not discard the draft.
export function useManualBudgetDraft(owner:string|null){
 const [state,setState]=useState(()=>({owner,draft:empty()}));
 const liveOwner=useRef(owner);liveOwner.current=owner;
 if(state.owner!==owner) setState({owner,draft:empty()});
 const draft=state.owner===owner?state.draft:empty();
 return {draft,dirty:Boolean(draft.amount||draft.place||draft.memo),
  change:(next:ManualBudgetDraft)=>{if(owner&&liveOwner.current===owner)setState({owner,draft:next});},
  clear:()=>{if(liveOwner.current===owner)setState({owner,draft:empty()});}};
}
