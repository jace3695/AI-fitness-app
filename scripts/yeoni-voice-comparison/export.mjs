import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const plan = JSON.parse(readFileSync(resolve(root, 'docs/yeoni-voice-comparison/plan.json'), 'utf8'));
const clips = [...plan.baselines, ...(plan.candidate.clips || [])].map(clip => {
  const bytes = readFileSync(resolve(root, clip.path));
  if (createHash('sha256').update(bytes).digest('hex') !== clip.sha256) {
    throw new Error(`Audio hash mismatch: ${clip.id}`);
  }
  return { ...clip, provenance: clip.provenance || 'original-hash-verified', src: `data:${clip.mimeType || 'audio/mpeg'};base64,${bytes.toString('base64')}` };
});
const output = resolve(process.argv[2] || '../deliverables/Yeoni_Voice_Comparison.html');
const template = readFileSync(resolve(root, 'scripts/yeoni-voice-comparison/template.html'), 'utf8');
const data = JSON.stringify({ plan, clips }).replaceAll('<', '\\u003c');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, template.replace('/*__COMPARISON_DATA__*/', `const comparison = ${data};`));
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(readFileSync(output)), originalHashesVerified: true, candidateHashesVerified: true, embeddedClips: clips.length, providerCalls: 0 }));
