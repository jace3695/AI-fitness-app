'use client';
import {useRef,useState,type ComponentProps} from 'react';
import ConfirmedConversationArchive from './ConfirmedConversationArchive';
type Props=Omit<ComponentProps<typeof ConfirmedConversationArchive>,'onBusyChange'|'active'>;
export default function ConversationArchiveEntry(props:Props){return <Entry key={props.ownerId} {...props}/>;}
function Entry(props:Props){
 const [open,setOpen]=useState(false),[mounted,setMounted]=useState(false),[busy,setBusy]=useState(false);const opener=useRef<HTMLButtonElement>(null);
 const close=()=>{if(busy)return;setOpen(false);opener.current?.focus();};
 return <section className="mt-3" aria-label="대화 보관함 입구">
 <button ref={opener} type="button" aria-expanded={open} disabled={busy} onClick={()=>{if(open)close();else{setMounted(true);setOpen(true)}}} className="min-h-11 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold disabled:opacity-50">{open?'보관함 닫기':'보관함'}</button>
 {mounted&&<div hidden={!open} role="region" aria-label="보관함 상세" className="rounded-xl border border-gray-100 p-2"><ConfirmedConversationArchive {...props} active={open} onBusyChange={setBusy}/><button type="button" disabled={busy} onClick={close} className="min-h-11 px-4 text-sm disabled:opacity-50">닫기</button>{busy&&<p role="status" className="text-sm">보관함 요청을 확인한 뒤 닫을 수 있어요.</p>}</div>}
 </section>;
}
