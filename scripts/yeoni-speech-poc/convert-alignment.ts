// Offline conversion only; run with Node 24. No provider request or audio upload.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyLipSyncPair, phoneViseme } from '../../lib/yeoni/lip-sync.ts';

const root = resolve(import.meta.dirname, '../../docs/yeoni-phase5');
const raw = JSON.parse(readFileSync(resolve(root, 'alignment/mfa-phrase.raw.json'), 'utf8'));
const metadata = JSON.parse(readFileSync(resolve(root, 'fixtures/zephyr-ko-39.metadata.json'), 'utf8'));
const audio = Uint8Array.from(readFileSync(resolve(root, 'fixtures/zephyr-ko-39.mp3'))).buffer;
const cues = raw.tiers.phones.entries.map(([start, end, phone]: [number, number, string]) => ({
  startMs: Math.round(start * 1000), endMs: Math.round(end * 1000), phone,
}));
const manifest = await verifyLipSyncPair(audio, { version: 1, language: 'ko-KR', voice: metadata.voice,
  spokenText: metadata.text, audioSha256: metadata.audioSha256, textSha256: metadata.textSha256,
  durationMs: Math.round(raw.end * 1000), alignment: 'automatic-phonemes', cues });
writeFileSync(resolve(root, 'fixtures/zephyr-ko-39.timeline.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ cues: cues.length, durationMs: manifest.durationMs,
  shapes: [...new Set(cues.map((cue: { phone: string }) => phoneViseme(cue.phone)))],
  review: 'Automatic candidate, not listening-reviewed.' }));
