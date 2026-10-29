/** Unscheduled, injected DB-certificate candidate. No credentials, driver,
 * environment reads, timer or I/O at import/construction. Local uncertainty is
 * not DB rollback: a lost finalize response may leave a bounded certificate. */
export const SPEECH_RETENTION_BEGIN_SQL = 'select yeoni_speech_retention_candidate.maintenance_begin($1::text,$2::uuid,$3::bigint) as result';
export const SPEECH_RETENTION_FINALIZE_SQL = 'select yeoni_speech_retention_candidate.maintenance_finalize($1::text,$2::uuid,$3::uuid,$4::bigint,$5::boolean) as result';
export type SpeechRetentionScheduledConfig = Readonly<{
  policyHash: string; generation: string;
  intervalSeconds: number; startDelaySeconds: number; runTimeoutSeconds: number;
}>;
export type SpeechRetentionScheduledExecute = (
  statement: string, values: readonly (string|number|boolean)[], signal: AbortSignal,
) => Promise<unknown>;
export type SpeechRetentionScheduledClock = Readonly<{wallTimeMs: number; monotonicTimeMs: number}>;
export type SpeechRetentionScheduledDependencies = Readonly<{
  execute: SpeechRetentionScheduledExecute;
  clock(): SpeechRetentionScheduledClock;
  timers: Readonly<{setTimeout(callback: () => void, delayMs: number): unknown; clearTimeout(handle: unknown): void}>;
}>;
export type SpeechRetentionScheduledState = Readonly<{
  state: 'unconfigured'|'running'|'confirmed'|'degraded'|'failed'|'uncertain'|'busy'|'disposed';
  reason: 'not-configured'|'not-run'|'running'|'confirmed'|'invalid-due'|'early-tick'|'duplicate-tick'
    |'out-of-order-tick'|'missed-tick'|'irregular-tick'|'late-start'|'invalid-clock'|'clock-anomaly'
    |'busy'|'timer-failed'|'timeout'|'begin-unconfirmed'|'begin-rejected'|'invalid-begin'
    |'finalize-unconfirmed'|'finalize-rejected'|'invalid-finalize'|'recovery-required'|'expired'|'disposed';
  healthy: boolean; dueAtMs: number|null; completedAtMs: number|null; validUntilMs: number|null;
  /** Only this attempt's finalize outcome, NOT a global DB open/closed claim. */
  finalizeOutcome: 'not-attempted'|'denied'|'confirmed'|'unknown';
}>;

type Begin = {policyHash: string; generation: string; token: string|null; dueAtMs: number;
  deadlineAtMs: number|null; validUntilMs: number|null; deletedRows: number};
const hash = /^[a-f0-9]{64}$/, uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// Paired integer-wall/fractional-monotonic sample resolution, not an approved
// operational clock-skew allowance. SQL owns DB clock/deadline validation.
const CLOCK_RESOLUTION_MS = 2;
function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && keys.every(key => {
    const d = Object.getOwnPropertyDescriptor(value, key);
    return !!d && Object.hasOwn(d, 'value');
  });
}
function resultRow(rows: unknown): Record<string, unknown> {
  if (!Array.isArray(rows) || rows.length !== 1 || !exactRecord(rows[0], ['result'])) throw Error();
  const result: unknown = rows[0].result;
  if (!result || typeof result !== 'object') throw Error();
  return result as Record<string, unknown>;
}
function configure(value: SpeechRetentionScheduledConfig|null) {
  try {
    if (!exactRecord(value, ['policyHash','generation','intervalSeconds','startDelaySeconds','runTimeoutSeconds'])) return null;
    const {policyHash, generation, intervalSeconds: i, startDelaySeconds: j, runTimeoutSeconds: q} = value;
    if (typeof policyHash !== 'string' || !hash.test(policyHash) || typeof generation !== 'string' || !uuid.test(generation)
      || !Number.isSafeInteger(i) || i <= 0 || !Number.isSafeInteger(j) || j < 0 || !Number.isSafeInteger(q) || q <= 0) return null;
    const intervalMs = i*1000, startDelayMs = j*1000, timeoutMs = q*1000, boundMs = intervalMs+startDelayMs+timeoutMs;
    if (![intervalMs,startDelayMs,timeoutMs,boundMs].every(Number.isSafeInteger)) return null;
    return {policyHash,generation,intervalMs,startDelayMs,timeoutMs,boundMs};
  } catch { return null; }
}

/** Calls are explicit nominal ticks, not an installed scheduler. DB begin closes
 * certification and purges even when trial/provider flags are OFF. SQL is
 * authoritative for due/generation/attempt; this local layer cannot renew it
 * from purge success alone. Anomaly recovery requires a reviewed new runner/
 * schedule generation, not a local retry or catch-up masquerading as on-time. */
export function createSpeechRetentionScheduledRunner(
  config: SpeechRetentionScheduledConfig|null = null, deps?: SpeechRetentionScheduledDependencies,
) {
  const cfg = configure(config);
  const configured = !!cfg && !!deps && typeof deps.execute === 'function' && typeof deps.clock === 'function'
    && typeof deps.timers?.setTimeout === 'function' && typeof deps.timers.clearTimeout === 'function';
  let status: SpeechRetentionScheduledState = {state: configured ? 'degraded':'unconfigured', reason: configured ? 'not-run':'not-configured',
    healthy: false, dueAtMs: null, completedAtMs: null, validUntilMs: null, finalizeOutcome: 'not-attempted'};
  let disposed = false, revision = 0, lastDue: number|null = null, recoveryRequired = false;
  let lastClock: SpeechRetentionScheduledClock|null = null, healthyUntilMono: number|null = null;
  let active: {controller: AbortController; settle(value: SpeechRetentionScheduledState): void; timer: unknown; timerSet: boolean}|null = null;
  const copy = (): SpeechRetentionScheduledState => ({...status});
  function close(state: SpeechRetentionScheduledState['state'], reason: SpeechRetentionScheduledState['reason'], latch = true) {
    revision++; if (latch) recoveryRequired = true; healthyUntilMono = null;
    status = {...status,state,reason,healthy:false}; return copy();
  }
  function sample(): SpeechRetentionScheduledClock|null {
    try {
      const raw = deps!.clock(), value = {wallTimeMs:raw.wallTimeMs,monotonicTimeMs:raw.monotonicTimeMs};
      if (!Number.isSafeInteger(value.wallTimeMs) || value.wallTimeMs<0 || !Number.isFinite(value.monotonicTimeMs)
        || value.monotonicTimeMs<0 || value.monotonicTimeMs>Number.MAX_SAFE_INTEGER) throw Error();
      if (lastClock && (value.wallTimeMs<lastClock.wallTimeMs || value.monotonicTimeMs<lastClock.monotonicTimeMs
        || Math.abs(value.wallTimeMs-lastClock.wallTimeMs-(value.monotonicTimeMs-lastClock.monotonicTimeMs))>CLOCK_RESOLUTION_MS)) close('degraded','clock-anomaly');
      lastClock=value; return value;
    } catch { close('degraded','invalid-clock'); return null; }
  }
  function snapshot(): SpeechRetentionScheduledState {
    if (!configured || disposed) return copy();
    const now = sample();
    if (now && status.healthy && (status.validUntilMs===null || healthyUntilMono===null
      || now.wallTimeMs>=status.validUntilMs || now.monotonicTimeMs>=healthyUntilMono)) close('degraded','expired');
    return copy();
  }
  function clearTimer(job: NonNullable<typeof active>) {
    if (!job.timerSet) return;
    job.timerSet=false;
    try { deps!.timers.clearTimeout(job.timer); } catch { /* Never infer cancellation/rollback from timer cleanup. */ }
  }
  async function tick(dueAtMs: number): Promise<SpeechRetentionScheduledState> {
    if (!configured || disposed) return copy();
    const started=sample(); if (!started) return copy();
    const startWall=started.wallTimeMs, startMono=started.monotonicTimeMs;
    if (active) return close('busy','busy'); // Cannot unsend a finalize already dispatched.
    if (!Number.isSafeInteger(dueAtMs) || dueAtMs<0 || !Number.isSafeInteger(dueAtMs+cfg!.boundMs)) return close('degraded','invalid-due');
    let violation: SpeechRetentionScheduledState['reason']|null = recoveryRequired ? 'recovery-required':null;
    if (!violation && dueAtMs>started.wallTimeMs) violation='early-tick';
    if (!violation && lastDue!==null && dueAtMs<=lastDue) violation=dueAtMs===lastDue ? 'duplicate-tick':'out-of-order-tick';
    if (!violation && lastDue!==null && dueAtMs-lastDue!==cfg!.intervalMs) violation=dueAtMs-lastDue>cfg!.intervalMs ? 'missed-tick':'irregular-tick';
    if (!violation && started.wallTimeMs-dueAtMs>cfg!.startDelayMs) violation='late-start';
    if (violation) recoveryRequired=true;
    lastDue=dueAtMs;
    const localRevision=++revision, controller=new AbortController();
    healthyUntilMono=null;
    status={state:'running',reason:'running',healthy:false,dueAtMs,completedAtMs:null,validUntilMs:null,finalizeOutcome:'not-attempted'};
    let resolve!: (value: SpeechRetentionScheduledState)=>void, settled=false;
    const result=new Promise<SpeechRetentionScheduledState>(done=>{resolve=done;});
    const job={controller,timer:undefined as unknown,timerSet:false,settle(value:SpeechRetentionScheduledState){if(!settled){settled=true;resolve(value);}}};
    active=job;
    const timeout=()=>{if(active!==job || settled)return;job.settle(close('uncertain','timeout'));controller.abort();};
    try { job.timer=deps!.timers.setTimeout(timeout,cfg!.timeoutMs);job.timerSet=true; }
    catch { active=null;return close('failed','timer-failed'); }
    if(settled || controller.signal.aborted){clearTimer(job);active=null;return result;}
    function stillWaiting(){return !settled && !disposed && !controller.signal.aborted;}
    function withinBudget(now:SpeechRetentionScheduledClock,deadline?:number|null){
      if(now.monotonicTimeMs-startMono>=cfg!.timeoutMs || now.wallTimeMs-startWall>=cfg!.timeoutMs
        || (deadline!==undefined && deadline!==null && now.wallTimeMs>=deadline)) {timeout();return false;}
      return true;
    }
    // The underlying work remains occupied after timeout/dispose until its own
    // promise settles. There is no abort race hiding a live SQL transaction.
    void (async()=>{
      let phase:'begin'|'finalize'='begin';
      try {
        const rows=await deps!.execute(SPEECH_RETENTION_BEGIN_SQL,Object.freeze([cfg!.policyHash,cfg!.generation,dueAtMs]),controller.signal);
        if(!stillWaiting())return;
        const now=sample();if(!now){job.settle(copy());return;}if(!withinBudget(now))return;
        let begin:Begin;
        try {
          const v=resultRow(rows);
          if(!exactRecord(v,['policyHash','generation','token','dueAtMs','deadlineAtMs','validUntilMs','deletedRows'])
            || v.policyHash!==cfg!.policyHash || v.generation!==cfg!.generation || v.dueAtMs!==dueAtMs
            || typeof v.deletedRows!=='number' || !Number.isInteger(v.deletedRows) || v.deletedRows<0 || v.deletedRows>1)throw Error();
          if(v.token===null){if(v.deadlineAtMs!==null || v.validUntilMs!==null)throw Error();}
          else if(typeof v.token!=='string' || !uuid.test(v.token)
            || typeof v.deadlineAtMs!=='number' || !Number.isSafeInteger(v.deadlineAtMs) || v.deadlineAtMs<=dueAtMs || v.deadlineAtMs>dueAtMs+cfg!.startDelayMs+cfg!.timeoutMs
            || typeof v.validUntilMs!=='number' || !Number.isSafeInteger(v.validUntilMs) || v.validUntilMs<=dueAtMs || v.validUntilMs>dueAtMs+cfg!.boundMs)throw Error();
          begin=v as Begin;
        } catch {job.settle(close('failed','invalid-begin'));return;}
        if(begin.token===null){job.settle(close('degraded',violation??'begin-rejected'));return;}
        if(!withinBudget(now,begin.deadlineAtMs))return;
        if(now.wallTimeMs>=begin.validUntilMs!){job.settle(close('degraded','expired'));return;}
        // Even a malformed local schedule can perform deletion, but never certify.
        // A concurrent tick/clock incident invalidates this attempt's healthy bit.
        const healthy=!violation && !recoveryRequired && localRevision===revision;
        phase='finalize';status={...status,finalizeOutcome:'unknown'};
        const finalRows=await deps!.execute(SPEECH_RETENTION_FINALIZE_SQL,Object.freeze([cfg!.policyHash,cfg!.generation,begin.token,dueAtMs,healthy]),controller.signal);
        if(!stillWaiting())return;
        const finalNow=sample();if(!finalNow){job.settle(copy());return;}if(!withinBudget(finalNow,begin.deadlineAtMs))return;
        let confirmed:boolean;
        try {
          const v=resultRow(finalRows);
          if(!exactRecord(v,['confirmed','validUntilMs']) || typeof v.confirmed!=='boolean'
            || (v.confirmed ? !healthy || v.validUntilMs!==begin.validUntilMs : v.validUntilMs!==null))throw Error();
          confirmed=v.confirmed;
        } catch {job.settle(close('uncertain','invalid-finalize'));return;}
        status={...status,finalizeOutcome:confirmed?'confirmed':'denied',validUntilMs:confirmed?begin.validUntilMs:null};
        if(!confirmed){job.settle(close('degraded',violation??'finalize-rejected'));return;}
        if(localRevision!==revision || recoveryRequired){job.settle(copy());return;}
        if(finalNow.wallTimeMs>=begin.validUntilMs!){job.settle(close('degraded','expired'));return;}
        healthyUntilMono=finalNow.monotonicTimeMs+begin.validUntilMs!-finalNow.wallTimeMs;
        status={state:'confirmed',reason:'confirmed',healthy:true,dueAtMs,completedAtMs:finalNow.wallTimeMs,validUntilMs:begin.validUntilMs,finalizeOutcome:'confirmed'};
        job.settle(copy());
      } catch {if(stillWaiting())job.settle(close('uncertain',phase==='begin'?'begin-unconfirmed':'finalize-unconfirmed'));}
      finally {clearTimer(job);if(active===job)active=null;}
    })();
    return result;
  }
  function dispose(){if(disposed)return;disposed=true;const value=close('disposed','disposed');if(active){clearTimer(active);active.settle(value);active.controller.abort();}}
  return {tick,snapshot,dispose};
}
