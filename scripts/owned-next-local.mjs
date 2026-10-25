import {spawn,execFile} from 'node:child_process';
import {createConnection} from 'node:net';
import {openSync,closeSync,writeFileSync,readFileSync,unlinkSync,appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const origin='http://127.0.0.1:4317';
const lock=resolve('scripts/browser-qa/.generated/owned-next.lock');
async function assertPortFree(){await new Promise((ok,no)=>{const socket=createConnection({host:'127.0.0.1',port:4317});socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();no(Error('QA port4317 already occupied; existing server untouched'));});socket.once('timeout',()=>{socket.destroy();no(Error('QA port4317 preflight uncertain; existing server untouched'));});socket.once('error',e=>{socket.destroy();if(e.code==='ECONNREFUSED')ok();else no(e);});});}
export async function startOwnedNext({env,log}){
 await assertPortFree();const token=randomUUID();let descriptor;
 try{descriptor=openSync(lock,'wx');writeFileSync(descriptor,JSON.stringify({token,runnerPid:process.pid}));closeSync(descriptor);}catch(e){throw Error('Exclusive Next QA lock unavailable; no server started: '+e.message);}
 const runtime={...env,YEONI_LOCAL_QA_OWNER:token,NODE_OPTIONS:'--require '+JSON.stringify(resolve('scripts/local-next-owner.cjs'))};
 const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','4317'],{env:runtime,stdio:['ignore','pipe','pipe'],windowsHide:true});
 const handle={server,token,origin,ready:false,log,cleanup:null};let output='';
 const record=b=>{appendFileSync(log,b);output+=b.toString();};server.stdout.on('data',record);server.stderr.on('data',record);
 try{
  await new Promise((ok,no)=>{const deadline=setTimeout(()=>finish(Error('Owned Next readiness timeout')),30000);const inspect=()=>{if(output.includes('Another next dev server'))return finish(Error('Another Next server owns repository; not reused'));if(output.includes('Ready in')&&output.includes(origin))finish();};const exit=code=>finish(Error('Owned Next exited before readiness: '+code));const error=e=>finish(e);function finish(e){clearTimeout(deadline);server.stdout.off('data',inspect);server.stderr.off('data',inspect);server.off('exit',exit);server.off('error',error);e?no(e):ok();}server.stdout.on('data',inspect);server.stderr.on('data',inspect);server.once('exit',exit);server.once('error',error);inspect();});
  if(server.exitCode!==null)throw Error('Owned Next exited before HTTP check');
  const response=await fetch(origin,{signal:AbortSignal.timeout(60000),redirect:'manual'});
  if(server.exitCode!==null)throw Error('Owned Next exited during HTTP check');
  if(response.headers.get('x-yeoni-local-qa-owner')!==token)throw Error('HTTP response does not belong to spawned Next tree; not reused');
  if(!response.ok)throw Error('Owned Next HTTP '+response.status);
  handle.ready=true;return handle;
 }catch(e){await stopOwnedNext(handle);throw e;}
}
export async function stopOwnedNext(handle){
 const {server,token}=handle;let stopped=server.exitCode!==null;
 if(!stopped){if(process.platform==='win32'){await new Promise((ok,no)=>execFile('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true},error=>error?no(error):ok()));}else server.kill('SIGTERM');
  stopped=await new Promise(ok=>{if(server.exitCode!==null)return ok(true);const timeout=setTimeout(()=>{server.off('exit',exit);ok(false)},5000);const exit=()=>{clearTimeout(timeout);ok(true)};server.once('exit',exit);});}
 let remaining=false,listenerChecked=false;try{const response=await fetch(origin,{signal:AbortSignal.timeout(1000)});remaining=response.headers.get('x-yeoni-local-qa-owner')===token;listenerChecked=true;}catch(e){if(e.cause?.code==='ECONNREFUSED')listenerChecked=true;else handle.cleanupError=e.message;}
 handle.cleanup={processExited:stopped,ownedListenerRemaining:remaining,listenerChecked};
 if(stopped&&!remaining&&listenerChecked){try{if(JSON.parse(readFileSync(lock,'utf8')).token===token)unlinkSync(lock);}catch(e){handle.cleanupError=e.message;}}
 if(!stopped||remaining||!listenerChecked)throw Error('Owned Next cleanup incomplete; exclusive lock retained; no other process touched');
 return handle.cleanup;
}
