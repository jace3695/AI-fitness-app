// Local pitch visualization, not pronunciation or accent assessment.
export type PitchPoint = { seconds: number; hz: number | null };
export function framePitch(samples: Float32Array, rate: number): number | null {
  if (!Number.isFinite(rate) || rate < 4000 || samples.length < rate * .04) return null;
  let mean = 0; for (const x of samples) { if (!Number.isFinite(x)) return null; mean += x; } mean /= samples.length;
  const values = samples.map(x => x - mean);
  let energy = 0; for (const x of values) energy += x*x;
  if (Math.sqrt(energy / values.length) < .01) return null;
  // Search above the display range too: do not mistake a high tone for a lower octave.
  const min = Math.max(2, Math.floor(rate / 2000)), max = Math.min(Math.floor(rate / 60), values.length >> 1);
  const correlations: number[] = [];
  for (let lag = min - 1; lag <= max + 1; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i < values.length - lag; i++) { const a=values[i], b=values[i+lag]; xy+=a*b; xx+=a*a; yy+=b*b; }
    correlations[lag] = xx && yy ? xy / Math.sqrt(xx*yy) : 0;
  }
  for (let lag=min; lag<=max; lag++) {
    const left=correlations[lag-1], middle=correlations[lag], right=correlations[lag+1];
    if (middle >= .9 && middle > left && middle >= right) {
      const denominator = left - 2*middle + right;
      const refined = lag + (denominator ? .5*(left-right)/denominator : 0);
      const hz=rate/refined;
      return hz >= 60 && hz <= 600 ? hz : null;
    }
  }
  return null;
}
function check(signal: AbortSignal) { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); }
export async function extractPitch(samples: Float32Array, rate: number, signal: AbortSignal): Promise<PitchPoint[]> {
  check(signal);
  if (!Number.isFinite(rate) || rate < 8000 || rate > 192000 || !samples.length || samples.length/rate > 31) throw Error('Unsupported audio');
  // Average samples when reducing work; retain only temporary mono PCM.
  const stride=Math.max(1,Math.floor(rate/8000)), reducedRate=rate/stride;
  const reduced=new Float32Array(Math.floor(samples.length/stride));
  for(let i=0;i<reduced.length;i++) {
    if(i%4096===0) { await new Promise<void>(resolve=>setTimeout(resolve,0)); check(signal); }
    let sum=0; for(let k=0;k<stride;k++)sum+=samples[i*stride+k]; reduced[i]=sum/stride;
  }
  const frame=Math.ceil(reducedRate*.06), hop=Math.ceil(reducedRate*.06), points:PitchPoint[]=[];
  for(let offset=0;offset+frame<=reduced.length;offset+=hop) {
    check(signal);
    points.push({seconds:(offset+frame/2)/reducedRate,hz:framePitch(reduced.subarray(offset,offset+frame),reducedRate)});
    await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  check(signal); return points;
}
type Decoded = { duration: number; sampleRate: number; getChannelData: (channel: number) => Float32Array };
export type PitchDecoder = { decodeAudioData: (data: ArrayBuffer) => Promise<Decoded>; close: () => Promise<void> };
// Dependency injection keeps lifecycle tests free of microphones, browsers and network.
export async function readPitch(blob: Blob, signal: AbortSignal, create: () => PitchDecoder): Promise<PitchPoint[]> {
  check(signal);
  if (!blob.size || blob.size > 5*1024*1024) throw Error('Unsupported audio size');
  const decoder=create(); let rejectCancel: (reason: unknown)=>void = ()=>{};
  const cancelled=new Promise<never>((_,reject)=>{rejectCancel=reject;});
  const abort=()=>rejectCancel(new DOMException('Cancelled','AbortError'));
  signal.addEventListener('abort',abort,{once:true});
  try {
    check(signal);
    return await Promise.race([cancelled,(async()=>{
      const data=await blob.arrayBuffer(); check(signal);
      const decoded=await decoder.decodeAudioData(data); check(signal);
      if (!Number.isFinite(decoded.duration) || decoded.duration<=0 || decoded.duration>31) throw Error('Unsupported duration');
      return extractPitch(decoded.getChannelData(0),decoded.sampleRate,signal);
    })()]);
  } finally {
    signal.removeEventListener('abort',abort);
    // Request native resource release, but a stalled browser close must not block cancellation.
    try { void decoder.close().catch(()=>{}); } catch { /* A closed/unavailable context is already unusable. */ }
  }
}
