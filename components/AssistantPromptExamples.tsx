'use client';
import {useEffect,useRef,useState} from 'react';
import {nextQuestionVisit,questionPage} from '../lib/assistant-question-pages';
export default function AssistantPromptExamples({ disabled, hasDraft, onSelect }: { disabled: boolean; hasDraft: boolean; onSelect: (text: string) => void }) {
 const [page,setPage]=useState(0);const initialDraft=useRef({hasDraft,visited:false});
 useEffect(()=>{if(initialDraft.current.visited)return;initialDraft.current.visited=true;if(!initialDraft.current.hasDraft)setPage(nextQuestionVisit());},[]);
 return <section aria-label="추천 질문" className="mt-3 rounded-xl border border-gray-100 p-3">
 <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-gray-700">추천 질문</h3><button type="button" disabled={disabled||hasDraft} onClick={()=>{if(!disabled&&!hasDraft)setPage(nextQuestionVisit())}} className="min-h-11 rounded-lg px-3 text-sm text-[#5146A6] disabled:opacity-50">다른 질문</button></div>
 <p className="mb-2 text-sm text-gray-600">고르면 입력칸만 채워져요. 확인한 뒤 보내 주세요.</p>
 {hasDraft&&<p className="mb-2 text-sm text-gray-600">작성 중인 말은 그대로 둘게요. 입력칸을 비우면 다른 질문을 고를 수 있어요.</p>}
 <div className="grid gap-2 sm:grid-cols-2">{questionPage(page).map(sample=><button key={sample} type="button" disabled={disabled||hasDraft} onClick={()=>{if(!disabled&&!hasDraft)onSelect(sample)}} className="min-h-11 max-w-full rounded-xl border border-[#D6D1F3] bg-[#F1EFFF] px-3 py-2 text-left text-sm font-semibold text-[#5146A6] disabled:opacity-50">{sample}</button>)}</div>
 </section>;
}
