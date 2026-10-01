import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { japaneseTimelineFromLabels } from '../../lib/yeoni/japanese-alignment.ts';

// No network/TTS. Input labels must be aligned to this exact audio, never G2P-only labels.
const [audio, textFile, labelsFile, units, output, ...extra] = process.argv.slice(2);
if (!output || extra.length || !['seconds', 'hts-100ns'].includes(units)) {
  throw new Error('Usage: node --experimental-strip-types scripts/yeoni-japanese/prepare-timeline.mjs AUDIO TEXT_UTF8 LABELS seconds|hts-100ns NEW_OUTPUT.json');
}
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', audio], { encoding: 'utf8' }));
const durationMs = Number(probe.format?.duration) * 1000;
const manifest = await japaneseTimelineFromLabels(Uint8Array.from(readFileSync(audio)).buffer, readFileSync(textFile, 'utf8'), readFileSync(labelsFile, 'utf8'), units, durationMs);
writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(`Created ${output}; automatic alignment candidate, listening review still required.`);
