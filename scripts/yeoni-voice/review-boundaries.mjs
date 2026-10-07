// Offline diagnostic export: existing artwork/mouth code and saved audio only.
// This is not a browser playback capture or a phonetic ground-truth annotator.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { build } from '../browser-qa/node_modules/esbuild/lib/main.js';

const root = resolve(new URL('../../', import.meta.url).pathname);
const out = resolve(root, 'docs/yeoni-phase5/boundary-review-20261007');
const temporary = mkdtempSync(resolve(tmpdir(), 'yeoni-boundary-'));
mkdirSync(out, { recursive: true });
const digest = path => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const audioPath = 'docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3';
const timelinePath = 'docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json';
const timeline = read(timelinePath);
if (digest(audioPath) !== timeline.audioSha256) throw Error('Audio/manifest mismatch');
const sources = [audioPath, timelinePath, 'lib/yeoni/mouth-motion.ts', 'lib/yeoni/mouth-morph.ts',
  'lib/yeoni/cat-art.ts', 'lib/yeoni/human-art.ts'];
const before = Object.fromEntries(sources.map(p => [p, digest(p)]));
const prior = read('docs/yeoni-lipsync-smoothing/evidence/verification.json');
await build({ stdin: { contents: `export {mouthAt} from './lib/yeoni/mouth-motion.ts';
export {visemeAt} from './lib/yeoni/lip-sync.ts';
export {createCatArtwork} from './lib/yeoni/cat-art.ts';
export {createHumanArtwork,HUMAN_IMAGE_NAMES} from './lib/yeoni/human-art.ts';`,
  resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm',
  outfile: resolve(temporary, 'artwork.mjs') });
const api = await import(pathToFileURL(resolve(temporary, 'artwork.mjs')).href);
const require = createRequire(import.meta.url);
const { createCanvas, loadImage, ImageData, GlobalFonts } = require('@napi-rs/canvas');
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'ReviewSans');
// Only the graphics module's canvas factory is adapted, with no browser/session access.
globalThis.document = { createElement: tag => { if (tag !== 'canvas') throw Error(tag); return createCanvas(1, 1); } };
globalThis.ImageData = ImageData;
const cat = api.createCatArtwork(await loadImage(resolve(root, 'public/yeoni/cat/preserved-motion-v3.png')));
const human = api.createHumanArtwork(new Map(await Promise.all(api.HUMAN_IMAGE_NAMES.map(async n =>
  [n, await loadImage(resolve(root, 'public/yeoni/human/rig-v4', n))]))));
const regions = [{ id: 'a', label: '조금 쉬는', startMs: 3370, endMs: 4410 },
  { id: 'b', label: '좋겠어요', startMs: 4310, endMs: 5376 }];
const comparisons = [];
for (const engine of ['chromium', 'webkit']) {
  const path = `docs/yeoni-lipsync-smoothing/evidence/${engine}/results.json`;
  const evidence = read(path);
  for (const region of regions) for (const skin of ['cat', 'human']) {
    const rows = evidence.samples.filter(r => r.skin === skin && r.time >= region.startMs && r.time < region.endMs);
    const mismatches = rows.filter(r => {
      const expected = api.mouthAt(timeline, r.time);
      return expected.from !== r.pose.from || expected.to !== r.pose.to || Math.abs(expected.mix - r.pose.mix) > 1e-10;
    });
    comparisons.push({ engine, version: evidence.version, region: region.id, skin, samples: rows.length,
      mismatches: mismatches.length, maximumRecordedClockAgeMs: Math.max(0, ...rows.map(r => r.audio - r.time)),
      evidencePath: path, evidenceSha256: digest(path), newBrowserRun: false });
  }
}
if (comparisons.some(r => !r.samples || r.mismatches)) throw Error('Retained render evidence diverges');
const traces = [];
for (let timeMs = 3300; timeMs <= timeline.durationMs; timeMs++) traces.push({ timeMs,
  viseme: api.visemeAt(timeline, timeMs), ...api.mouthAt(timeline, timeMs) });
writeFileSync(resolve(out, 'mouth-trace.json'), JSON.stringify(traces));
const geometry = { cat: [153, 187, 51, 36], human: [425, 512, 200, 112] };
const isolation = [];
for (const [skin, art] of [['cat', cat], ['human', human]]) {
  const base = art.frame('open', 'rest'), width = base.width, height = base.height;
  const pixels = new Uint8ClampedArray(base.getContext('2d').getImageData(0, 0, width, height).data);
  const [mx, my, mw, mh] = geometry[skin]; let changed = 0;
  for (const time of [3980, 4040, 4090, 4510, 4650, 4890, 5170]) {
    const current = art.frame('open', api.visemeAt(timeline, time), api.mouthAt(timeline, time)).getContext('2d').getImageData(0, 0, width, height).data;
    for (let y=0; y<height; y++) for(let x=0;x<width;x++) if(x<mx||x>=mx+mw||y<my||y>=my+mh) {
      const i=(y*width+x)*4; for(let c=0;c<4;c++) if(current[i+c]!==pixels[i+c]) changed++;
    }
  }
  isolation.push({skin, sampledPoses:7, changedChannelsOutsideMouth:changed});
}
if(isolation.some(r=>r.changedChannelsOutsideMouth)) throw Error('Offline mouth isolation failure');

const fps = 30, width = 1000, height = 620;
const canvas = createCanvas(width, height), context = canvas.getContext('2d');
const still = { from:'rest', to:'rest', mix:0 };
function frame(region, sourceTimeMs, mode, active=true) {
  const pose=active ? api.mouthAt(timeline, sourceTimeMs) : still;
  context.fillStyle='#f5f2fb'; context.fillRect(0,0,width,height);
  context.font='bold 26px ReviewSans'; context.fillStyle='#30234f';
  context.fillText(`Yeoni / segment ${region.id.toUpperCase()} / ${mode}`,30,42);
  context.font='16px ReviewSans'; context.fillStyle='#665b78';
  context.fillText('Saved Korean voice / mouth timing only / body held still',30,70);
  context.fillStyle='#fff'; context.fillRect(25,90,465,440); context.fillRect(510,90,465,440);
  context.drawImage(cat.frame('open',api.visemeAt(timeline,sourceTimeMs),pose),0,0,360,360,75,110,360,360);
  // Crop the existing artwork to the face/neck for a comparable diagnostic view.
  context.drawImage(human.frame('open',api.visemeAt(timeline,sourceTimeMs),pose),190,170,670,820,575,100,340,416);
  context.font='18px ReviewSans'; context.fillStyle='#30234f';
  context.fillText('CAT',225,515); context.fillText('HUMAN',704,515);
  context.font='16px ReviewSans';
  context.fillText(`Source ${(sourceTimeMs/1000).toFixed(3)} s     ${active?'audio + mouth':'pause'}`,30,562);
  context.fillStyle='#8f71c9'; context.fillRect(30,587,940*Math.max(0,Math.min(1,(sourceTimeMs-region.startMs)/(region.endMs-region.startMs))),5);
  return canvas.toBuffer('image/png');
}
const exports=[];
for (const region of regions) {
  const passes=[];
  for(const rate of [1,.5]) {
    const duration=(region.endMs-region.startMs)/1000/rate;
    const activeFrames=Math.ceil(duration*fps), pauseFrames=15;
    const total=(activeFrames+pauseFrames)/fps;
    const destination=resolve(temporary,`${region.id}-${rate}.mov`);
    const tempo=rate===1?'':`,atempo=${rate}`;
    const filter=`[1:a]atrim=start=${region.startMs/1000}:end=${region.endMs/1000},asetpts=PTS-STARTPTS${tempo},apad,atrim=duration=${total}[voice]`;
    const process=spawn('ffmpeg',['-v','error','-y','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-i','pipe:0',
      '-i',resolve(root,audioPath),'-filter_complex',filter,'-map','0:v','-map','[voice]',
      '-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-c:a','pcm_s16le','-t',String(total),destination]);
    let error='';process.stderr.on('data',d=>error+=d); const done=once(process,'close');
    for(let i=0;i<activeFrames+pauseFrames;i++) {
      const time=Math.min(region.endMs,region.startMs+i/fps*1000*rate);
      const bytes=frame(region,time,rate===1?'NORMAL 1x':'SLOW 0.5x',i<activeFrames);
      if(region.id==='a'&&rate===1&&i===20) writeFileSync(resolve(out,'preview.jpg'),canvas.toBuffer('image/jpeg'));
      if(!process.stdin.write(bytes)) await once(process.stdin,'drain');
    }
    process.stdin.end(); const [code]=await done;if(code)throw Error(error);
    passes.push(destination);
  }
  const destination=resolve(out,`segment-${region.id}.mp4`);
  // Decode/concatenate PCM intermediates; copying AAC packets would shift video
  // by encoder priming and make a boundary-review export misleading.
  execFileSync('ffmpeg',['-v','error','-y','-i',passes[0],'-i',passes[1],'-filter_complex',
    '[0:v]setpts=PTS-STARTPTS[v0];[0:a]asetpts=PTS-STARTPTS[a0];[1:v]setpts=PTS-STARTPTS[v1];[1:a]asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]',
    '-map','[v]','-map','[a]','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p',
    '-r',String(fps),'-c:a','aac','-b:a','160k','-movflags','+faststart',destination]);
  exports.push({...region,path:`docs/yeoni-phase5/boundary-review-20261007/segment-${region.id}.mp4`,
    modes:['normal 1x','diagnostic 0.5x (atempo; approximate pitch preservation)'],fps,
    nature:'offline reconstruction from current artwork/mouth code, not live-browser playback capture',
    audio:'Original MP3 decoded, selected range extracted and encoded to AAC; no gain/EQ/new speech synthesis. Original remains unchanged.'});
}
const after=Object.fromEntries(sources.map(p=>[p,digest(p)]));
if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Source changed');
const result={createdAt:'2026-10-07',status:'technical-cross-check-complete-listening-boundaries-still-pending',
  sourceHashes:before,sourceHashesUnchanged:true,
  artworkMatchesRetainedBrowserVerification:Object.fromEntries(['lib/yeoni/cat-art.ts','lib/yeoni/human-art.ts','lib/yeoni/mouth-morph.ts'].map(p=>[p,before[p]===prior.sourceSha256[p]])),
  retainedBrowserComparisons:comparisons,offlinePixelIsolation:isolation,exports,
  wholeClosure3940To4020Preserved:traces.filter(r=>r.timeMs>=3940&&r.timeMs<4020).every(r=>r.from==='closed'&&r.to==='closed'),
  tailFrom5200Closed:traces.filter(r=>r.timeMs>=5200).every(r=>r.from==='rest'&&r.to==='rest'),
  alignmentRemains:timeline.alignment,newTtsCalls:0,newBrowserRuns:0,
  limitations:['Waveform and renderer evidence do not identify every phoneme acoustically.','No direct listening by Codex; perceptual boundary review still required.','Offline exports hold body/blink still and omit browser/device output latency.']};
writeFileSync(resolve(out,'technical-review.json'),JSON.stringify(result,null,2)+'\n');
cat.dispose();human.dispose();
console.log(JSON.stringify({out,comparisons:comparisons.map(r=>({engine:r.engine,region:r.region,skin:r.skin,samples:r.samples,mismatches:r.mismatches})),isolation}));
