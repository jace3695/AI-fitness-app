import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { prepareAssessmentWav, buildAssessmentEnvelope } from './assessment-audio';
import {AssessmentBrowserClient,type AssessmentHttp} from './assessment-browser';
import { ASSESSMENT_LIMITS, type AssessmentResult } from './assessment';
import { ASSESSMENT_TRIAL, validateAssessmentTrial } from './assessment-trial';
import {cleanupDelaySeconds,type RetentionDisclosure} from './assessment-retention';

/** Explicit preparation/readiness/dispatch steps; no automatic transmission. */
export default function AssessmentAvailability({ recording = null, text = '', owner='',request }: { recording?: Blob | null; text?: string;owner?:string;request?:AssessmentHttp }) {
  const reasonId = useId();
  const [prepared, setPrepared] = useState<{ source: Blob; text: string; owner:string;wav: Blob; id: string } | null>(null);
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const job = useRef<AbortController | null>(null);
  const attemptedId = useRef<string | null>(null);
  const preparedOwner = useRef<typeof prepared>(null);
  const client=useRef<AssessmentBrowserClient|null>(null);
  const [serviceReady,setServiceReady]=useState(false),[result,setResult]=useState<AssessmentResult|null>(null);
  const [retention,setRetention]=useState<RetentionDisclosure|null>(null);
  const [operation,setOperation]=useState<'local'|'checking'|'sending'>('local');
  const activeOperation = useRef<'local'|'checking'|'sending'>('local');
  const beginOperation = (next: 'local'|'checking'|'sending') => { activeOperation.current = next; setOperation(next); };
  const cancel = useCallback((preserveNotice = false) => { job.current?.abort(); job.current = null;client.current?.cancel();setServiceReady(false);setRetention(null);setResult(null); setBusy(false); setPrepared(null); preparedOwner.current = null; setConsent(false); attemptedId.current = null; if (!preserveNotice) setNotice(''); }, []);
  const interrupt = useCallback(() => {
    const pending = !!job.current, sending = activeOperation.current === 'sending';
    cancel(true);
    if (pending) setNotice(sending ? '결과 기다리기를 멈췄어요. 자동으로 다시 보내지 않아요. 이미 전달된 녹음의 처리 종료나 1회 시험 한도 복구를 보장하지 않아요.' : '준비를 멈췄어요. 녹음은 보내지 않았어요.');
  }, [cancel]);
  useEffect(()=>{const session=new AssessmentBrowserClient(owner,request);client.current=session;return()=>{session.dispose();if(client.current===session)client.current=null;}},[owner,request]);
  useEffect(() => {
    cancel();
    const hide = () => { if (document.visibilityState === 'hidden') interrupt(); };
    const reset = () => cancel();
    const storage = (event: StorageEvent) => { if (!event.key || ['language-cloud-sync-user', 'fitness-cloud-sync-user', 'fitness-cloud-sync-epoch'].includes(event.key)) cancel(); };
    window.addEventListener('pagehide', interrupt); window.addEventListener('yeoni-cloud-session-changed', reset); window.addEventListener('storage', storage); document.addEventListener('visibilitychange', hide);
    return () => { job.current?.abort(); job.current = null; window.removeEventListener('pagehide', interrupt); window.removeEventListener('yeoni-cloud-session-changed', reset); window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', hide); };
  }, [recording, text,owner,request,cancel,interrupt]);
  const current = prepared?.source === recording && prepared.text === text && prepared.owner===owner ? prepared : null;
  const attempted = !!current && attemptedId.current === current.id;
  const failedAttempt = attempted && !busy && !result;
  async function prepare() {
    if (!recording || job.current) return;
    cancel();
    if (text.length > ASSESSMENT_LIMITS.maxText || text.trim() !== ASSESSMENT_TRIAL.referenceText) {
      setNotice(`연결 시험 문장은 “${ASSESSMENT_TRIAL.referenceText}”만 사용할 수 있어요. 녹음은 보내지 않았어요. 기존 녹음은 다시 듣기에 그대로 남아요.`);
      return;
    }
    const controller = new AbortController(); job.current = controller; setBusy(true);beginOperation('local');
    let failureNotice = '녹음 형식을 확인하지 못했어요. 전송하지 않았어요.';
    try {
      const wav = await prepareAssessmentWav(recording, controller.signal, () => new AudioContext());
      failureNotice = `연결 시험은 ${ASSESSMENT_TRIAL.maxDurationMs / 1000}초 이내의 녹음만 사용할 수 있어요. 이 녹음을 시험용 WAV로 확인하지 못해 전송하지 않았어요. 기존 녹음은 다시 듣기에 그대로 남아요.`;
      await validateAssessmentTrial(wav, text, controller.signal);
      if (job.current !== controller || controller.signal.aborted) return;
      const ready = { source: recording, text,owner, wav, id: crypto.randomUUID() };
      preparedOwner.current = ready; setPrepared(ready); setNotice(`이 기기에서 시험 문장과 ${ASSESSMENT_TRIAL.maxDurationMs / 1000}초 이내 WAV 형식을 확인했어요. 전송하지 않았어요.`);
    } catch { if (job.current === controller) setNotice(failureNotice); }
    finally { if (job.current === controller) { job.current = null; setBusy(false); } }
  }
  async function review() {
    if (!current || preparedOwner.current !== current || !consent || result || attemptedId.current === current.id || job.current) return;
    const controller = new AbortController(); job.current = controller; setBusy(true); setNotice('');beginOperation('local');
    try { await buildAssessmentEnvelope(current.wav, text, current.id, consent, controller.signal,retention); if (job.current === controller && !controller.signal.aborted) setNotice('전송할 내용만 확인했어요. 녹음은 보내지 않았어요.'); }
    catch { if (job.current === controller) setNotice('확인을 마치지 못했어요. 녹음은 보내지 않았어요.'); }
    finally { if (job.current === controller) { job.current = null; setBusy(false); } }
  }
  async function checkService(){
    if(!current||preparedOwner.current!==current||!client.current||!owner||result||attemptedId.current===current.id||job.current)return;
    const controller=new AbortController();job.current=controller;setBusy(true);beginOperation('checking');setServiceReady(false);setRetention(null);setConsent(false);setResult(null);setNotice('');
    try{const ready=await client.current.check(controller.signal);if(job.current===controller&&!controller.signal.aborted){setServiceReady(ready);setRetention(ready?client.current.retentionPolicy():null);setNotice(ready?'전송 전에 이번 녹음과 문장의 안내·동의를 확인해 주세요.':'보관·정리 조건과 공유 한도 준비가 끝나지 않았어요. 녹음은 보내지 않았어요.');}}
    catch{if(job.current===controller)setNotice('연결 준비를 확인하지 못했어요. 녹음은 보내지 않았어요.');}
    finally{if(job.current===controller){job.current=null;setBusy(false);}}
  }
  async function send(){
    if(!current||preparedOwner.current!==current||!consent||!serviceReady||!retention||!client.current||result||attemptedId.current===current.id||job.current)return;
    // The client also rejects reused identities. Keep controls and uncertainty
    // aligned with that local ownership rule, without changing the server trial.
    attemptedId.current=current.id;
    const controller=new AbortController();job.current=controller;setBusy(true);beginOperation('sending');setResult(null);setNotice('');
    try{const score=await client.current.assess(current.wav,text,current.id,consent,controller.signal);if(job.current===controller&&!controller.signal.aborted){setResult(score);setConsent(false);setServiceReady(false);setNotice('발음 정확도와 말하기 흐름을 확인했어요. 일본어 억양 점수는 아니에요.');}}
    catch{if(job.current===controller){setConsent(false);setServiceReady(false);setNotice('평가 결과를 확인하지 못했어요. 자동으로 다시 보내지 않아요. 이미 전달된 녹음의 처리 종료를 뜻하지는 않아요.');}}
    finally{if(job.current===controller){job.current=null;setBusy(false);}}
  }
  return <details className="mt-3 rounded-xl border p-3">
    <summary className="cursor-pointer font-semibold" style={{ minHeight: 44 }}>{result?'발음 평가 결과':failedAttempt?'발음 평가 결과 확인 필요':serviceReady?'발음 점수 받기':'발음 점수는 준비 중이에요'}</summary>
    <div className="space-y-2 pt-2 text-sm">
      <p>녹음을 다시 듣고, 내 목소리 높낮이를 볼 수 있어요. 외부 채점은 연결 준비를 확인하고 아래 안내에 동의한 뒤 직접 요청해야 해요.</p>
      <p>준비하는 점수는 <strong>발음 정확도</strong>(소리가 얼마나 또렷한지)와 <strong>말하기 흐름</strong>(끊김이 얼마나 자연스러운지)이에요. {serviceReady?'서버에서 연결 준비를 확인했어요.':'채점 서비스와 공유 한도 준비를 확인해야 해요.'}</p>
      <p>일본어 억양은 점수를 매기지 않아요. 높낮이 그림도 일본어 억양의 정답이나 발음 점수가 아니에요.</p>
      <p>{serviceReady?'선택한 녹음과 이 연습 문장만 보내요. 다른 앱 기록은 보내지 않아요.':'연결 준비를 확인한 뒤, 어디로 보내는지 확인하고 동의한 녹음과 연습 문장만 보낼 수 있어요. 지금은 보낼 수 없어요.'}</p>
      {recording && <div className="space-y-2 rounded-lg bg-violet-50 p-3">
        <button type="button" className="btn" disabled={busy} onClick={() => void prepare()}>녹음 형식 확인 · 전송 안 함</button>
        {busy && <button type="button" className="btn" onClick={interrupt}>{operation==='sending'?'요청 취소':'준비 취소'}</button>}
        {current && <>
          <p>이 기기에서 WAV 형식으로 준비했어요.</p>
          <p>연결 후 전송 대상은 Microsoft Azure Speech(한국 중부)예요. 선택한 녹음 1개와 이 연습 문장만 보내고, 다른 앱 기록은 보내지 않아요.</p>
          <p>앱은 녹음·문장·점수를 영구 저장하지 않아요. 점수는 이 화면에서만 보고, 화면을 벗어나거나 녹음·문장·계정이 바뀌면 지워요. 취소해도 이미 보낸 녹음의 서버 처리가 끝났다는 뜻은 아니에요.</p>
          {retention ? <>
            <p>정상 종료를 확인하면 요청 정보를 바로 지워요. 끝났는지 확인하지 못한 요청은 최대 {retention.metadataRetentionSeconds}초 후 정리 대상이 되며, 시험 허용 시간이 먼저 끝나면 더 일찍 정리 대상이 돼요.</p>
            <p>정리 실행기가 정해진 주기·시간 안에 정상 작동할 때 정리 대상이 된 뒤 최대 {cleanupDelaySeconds(retention)}초 안에 지우는 것이 목표예요. 실행이 멈추거나 실패하면 삭제가 늦어질 수 있어요. 준비 확인은 앞으로의 자동 삭제를 보장하지 않아요.</p>
            <p>인증 계정이 실제로 삭제되면 연결된 요청 정보도 지우는 경로예요. 로그아웃이나 계정 숨기기와는 달라요. 로그·백업까지 즉시 지워진다는 뜻은 아니에요.</p>
          </> : <p>보관 기간과 정리 실행 조건은 아직 정해지지 않았어요. 실제 조건을 확인하기 전에는 녹음을 보낼 수 없어요.</p>}
          <p>요청 정보에는 계정 식별자·요청 번호·내용 지문·녹음 길이·시각이 들어가요. 녹음·문장·점수 자체는 이 한도 기록에 저장하지 않아요.</p>
          <p>개인 식별 필드가 없는 공용 ‘1회 사용함’ 표시는 요청 정보와 따로 남겨요. 요청 정보나 계정을 지워도 시험 횟수는 돌아오지 않아요. 완전한 익명이라는 뜻은 아니에요.</p>
          <label className="flex min-h-11 items-start gap-2"><input type="checkbox" checked={consent} disabled={busy||attempted||!!result} onChange={event => setConsent(event.target.checked)} />{serviceReady?'위 전송·보관 안내를 확인했고 이번 녹음과 문장을 Microsoft로 보내는 데 동의해요.':'이 녹음과 문장의 전송 안내를 확인했어요 · 지금은 전송하지 않아요'}</label>
          <button type="button" className="btn" disabled={!consent || busy || attempted || !!result} onClick={() => void review()}>전송할 내용 확인 · 전송 안 함</button>
          <button type="button" className="btn" disabled={busy||!owner||attempted||!!result} onClick={()=>void checkService()}>연결 준비 확인 · 음성 전송 안 함</button>
        </>}
        <p role={failedAttempt ? 'alert' : 'status'}>{busy ? operation==='sending'?'발음 평가를 요청하고 결과를 기다리고 있어요. 취소해도 이미 전달된 음성 처리가 멈췄다고 보장할 수는 없어요.':operation==='checking'?'연결 준비를 확인하고 있어요. 음성은 보내지 않아요.':'이 기기에서 준비 중이에요. 전송하지 않아요.' : notice}</p>
      </div>}
      <p>연결 시험은 지정된 계정에서 “{ASSESSMENT_TRIAL.referenceText}”를 {ASSESSMENT_TRIAL.maxDurationMs / 1000}초 이내로 녹음한 한 번만 준비해요. 실제 전송은 별도 승인과 연결 준비가 끝나야 가능해요.</p>
      <button type="button" className="btn" disabled={!serviceReady||!current||!consent||busy||attempted} onClick={()=>void send()} aria-describedby={reasonId}>{serviceReady?'발음 점수 받기':'발음 점수 받기 · 준비 중'}</button>
      <p id={reasonId}>{result?'이번 평가 결과예요. 자동으로 다시 보내지 않으며, 화면을 벗어나거나 녹음·문장·계정이 바뀌면 이 화면의 결과는 지워져요.':failedAttempt?'같은 요청을 다시 보내지 않아요. 새로 준비해도 이전 요청의 처리 종료나 1회 시험 한도 복구를 뜻하지 않아요.':!current?'먼저 시험 문장과 녹음 길이·형식을 이 기기에서 확인해 주세요.':!serviceReady?'음성을 보내지 않는 연결 준비 확인이 먼저 필요해요.':!consent?'연결 확인 후 이번 녹음과 문장의 전송·보관 안내에 다시 동의해 주세요.':'직접 발음 점수 받기를 눌러야 전송해요.'}</p>
      {result&&current&&<div role="status"><p>Microsoft에서 받은 평가 결과예요. 일본어 억양은 점수를 매기지 않아요.</p>{result.metrics.map(metric=><p key={metric.name}>{metric.name==='accuracy'?'발음 정확도':'말하기 흐름'}: {metric.value} / {metric.max}</p>)}</div>}
    </div>
  </details>;
}
