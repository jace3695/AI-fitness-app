'use client';
import {useState} from 'react';
import {manualBudgetItem,type ManualBudgetDraft} from '../lib/manual-entry';
import {PAYMENT_CHOICES} from '../lib/history-edit';
export default function ManualEntry({owner,hidden,disabled,categories,onReview,draft,onDraftChange}:{draft:ManualBudgetDraft;onDraftChange:(draft:ManualBudgetDraft)=>void;owner:string;hidden:boolean;disabled:boolean;categories:readonly string[];onReview:(item:ReturnType<typeof manualBudgetItem>,owner:string)=>void}){
 const [notice,setNotice]=useState('');
 const change=(key:keyof ManualBudgetDraft,value:string)=>{onDraftChange({...draft,[key]:value});setNotice('');};
 const choices=draft.type==='income'?['월급','용돈','부업','보너스','이자','기타수입']:categories;
 const style={display:'block',width:'100%',minHeight:44,marginTop:4,padding:8,boxSizing:'border-box' as const,background:'#101018',color:'#fff',border:'1px solid #606070',borderRadius:8,fontSize:16};
 return <form hidden={hidden} aria-label="가계부 직접 입력" onSubmit={e=>{e.preventDefault();if(disabled||!owner)return;try{onReview(manualBudgetItem(draft,categories),owner);}catch(e){setNotice(e instanceof Error?e.message:'입력 내용을 확인해 주세요.');}}} style={{border:'1px solid #606070',borderRadius:14,padding:14,marginBottom:16,color:'#fff'}}>
 <h3>직접 적기</h3><p>이 단계에서는 서버나 AI에 보내지 않아요. 다음 화면에서 확인한 뒤 저장해요.</p>
 <fieldset disabled={disabled||!owner} style={{border:0,padding:0,margin:0,display:'grid',gap:12}}>
 <label>지출 또는 수입<select style={style} value={draft.type} onChange={e=>{const type=e.target.value as ManualBudgetDraft['type'];onDraftChange({...draft,type,category:type==='income'?'기타수입':'기타'});setNotice('');}}><option value="expense">쓴 돈 · 지출</option><option value="income">받은 돈 · 수입</option></select></label>
 <label>날짜<input style={style} type="date" required value={draft.date} onChange={e=>change('date',e.target.value)}/></label>
 <label>금액 · 원<input style={style} type="text" inputMode="numeric" required value={draft.amount} onChange={e=>change('amount',e.target.value)} placeholder="예: 9000"/></label>
 <label>{draft.type==='income'?'수입 이름':'사용처'}<input style={style} required maxLength={200} value={draft.place} onChange={e=>change('place',e.target.value)} placeholder={draft.type==='income'?'예: 월급':'예: 점심'}/></label>
 <label>분류<select style={style} value={draft.category} onChange={e=>change('category',e.target.value)}>{choices.map(x=><option key={x}>{x}</option>)}</select></label>
 {draft.type==='expense'&&<label>결제수단<select style={style} value={draft.payment} onChange={e=>change('payment',e.target.value)}>{PAYMENT_CHOICES.map(x=><option key={x}>{x}</option>)}</select></label>}
 <label>메모 · 선택<input style={style} maxLength={1000} value={draft.memo} onChange={e=>change('memo',e.target.value)}/></label>
 <button type="submit" style={{...style,background:'#E8A87C',color:'#111',fontWeight:700}}>입력한 내용 확인</button>
 </fieldset><p role="status">{notice}</p></form>;
}
