// Synthetic adapter only. No user sessions, remote data or service credentials.
declare global { interface Window { qa: any } }
const qa=window.qa;
const user=()=>qa.owner?{id:qa.owner}:null;
export const isSupabaseConfigured=true,isPasswordRecoveryRedirect=false;
export const supabase={auth:{
 onAuthStateChange(fn:any){qa.listeners.add(fn);queueMicrotask(()=>fn('INITIAL_SESSION',{user:user()}));return{data:{subscription:{unsubscribe(){qa.listeners.delete(fn)}}}}},
 getUser:()=>qa.holdAuth?new Promise(resolve=>qa.auths.push(resolve)):Promise.resolve({data:{user:user()}}),getSession:async()=>({data:{session:{user:user(),access_token:'synthetic-only'}}}),
},from(table:string){const filters:any={};const query:any=new Proxy({},{get(_,key){
 if(key==='insert')return async(payload:any)=>{qa.writes.push({table,payload});if(qa.mode==='accepted')return{error:null,status:202};if(qa.mode==='pending')return new Promise(()=>{});if(qa.mode==='offline')throw Error('synthetic offline');if(qa.mode==='rejected')return{error:{code:'23514'},status:400};if(qa.rows.has(payload.id))return{error:{code:'23505'},status:409};qa.rows.set(payload.id,{...payload});if(qa.mode==='lost')throw Error('synthetic response lost');return{error:null,status:201}};
 if(key==='maybeSingle'&&filters.id)return async()=>{qa.lookups.push({id:filters.id,owner:filters.user_id});return{data:qa.lookupFailure?null:qa.rows.get(filters.id)??null,error:qa.lookupFailure?{message:'synthetic query failed'}:null}};
 if(key==='then')return(resolve:any)=>resolve({data:['budget_monthly_budgets','user_app_state','language_user_state'].includes(table)?null:[],error:null});
 return(...args:any[])=>{if(key==='eq')filters[args[0]]=args[1];return query};
 }});return query;}};
export async function authenticatedFetch(){throw Error('No remote API allowed')}
