import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import * as policy from '../lib/japanese-voice-check.ts';

function harness(options: { env?: Record<string,string>; signedIn?: boolean; failed?: boolean; badGrant?: boolean; config?: boolean } = {}) {
  let calls = 0, reserved = false;
  const payloads: unknown[] = [];
  const code = ts.transpileModule(readFileSync('app/api/tts/japanese-check/route.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { POST?: () => Promise<Response> } = {};
  const imports: Record<string, unknown> = {
    'next/server': { NextResponse: { json: (body: unknown, init: ResponseInit) => Response.json(body, init) } },
    '@/lib/japanese-voice-check': policy,
    '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({data:{user:options.signedIn === false ? null : {id:'fixture'}},error:null}) } }) },
    '@/lib/zephyr-free-server': {
      zephyrFreeConfiguration: () => options.config === false ? null : { key:'fixture',keyFingerprint:'fixture' },
      zephyrBudget: async (_client: unknown, args: Record<string,unknown>) => {
        assert.equal(args.requestId, policy.JAPANESE_CHECK.requestId); assert.equal(args.text,policy.JAPANESE_CHECK.text);
        if (reserved) return {allowed:false,code:'DUPLICATE_REQUEST'};
        reserved = true;
        return {allowed:true,code:'RESERVED',requestId:args.requestId,characters:Array.from(policy.JAPANESE_CHECK.text).length,
          sendBefore:new Date(Date.now()+(options.badGrant ? -1000 : 10000)).toISOString(),remainingCharacters:900};
      },
    },
  };
  vm.runInNewContext(`(function(exports,require){${code}\n})`,{ process:{env: options.env ?? {VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'agent/yeoni-cat-animation-poc'}},AbortSignal,Date,
    fetch:async (_url:string, init:RequestInit) => {calls++; payloads.push(JSON.parse(String(init.body))); if(options.failed) throw new Error('timeout'); return Response.json({audioContent:'SUQz'});},
  })(exports,(name:string)=> {assert.ok(name in imports);return imports[name];});
  return {post:()=>exports.POST!(),count:()=>calls,payloads};
}

test('production and other previews cannot generate',async()=>{
  for(const env of [{VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'agent/yeoni-cat-animation-poc'},{VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'main'}]){
    const h=harness({env}); assert.equal((await h.post()).status,404);assert.equal(h.count(),0);
  }
});
test('authentication and free configuration required',async()=>{
  const a=harness({signedIn:false});assert.equal((await a.post()).status,401);assert.equal(a.count(),0);
  const b=harness({config:false});assert.equal((await b.post()).status,503);assert.equal(b.count(),0);
});
test('fixed approved payload and simultaneous repeat rejection',async()=>{
  const h=harness();const replies=await Promise.all([h.post(),h.post()]);assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);assert.equal(h.count(),1);
  assert.deepEqual(h.payloads[0],JSON.parse(readFileSync('docs/yeoni-phase12/approved-tts-request.json','utf8')));
});
test('provider uncertainty cannot trigger a second attempt',async()=>{
  const h=harness({failed:true});assert.equal((await h.post()).status,502);assert.equal((await h.post()).status,409);assert.equal(h.count(),1);
});
test('expired reservation cannot call provider',async()=>{
  const h=harness({badGrant:true});assert.equal((await h.post()).status,503);assert.equal(h.count(),0);
});
