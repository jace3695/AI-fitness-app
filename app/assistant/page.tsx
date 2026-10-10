import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { connection } from 'next/server';
import { assistantCharacterEnabled } from '@/lib/yeoni/assistant-feature';
import { alignmentConfiguration } from '@/lib/yeoni/speech-alignment';
import AssistantClient from './AssistantClient';

export default async function AssistantPage() {
  // Service bindings exist only at runtime, not while prerendering the page.
  if (process.env.YEONI_REPLY_ALIGNMENT_ENABLED === '1') await connection();
  if (!assistantCharacterEnabled(process.env)) return <AssistantClient />;
  const [ko, ja] = await Promise.all([
    readFile(path.join(process.cwd(), 'docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3'), 'base64'),
    readFile(path.join(process.cwd(), 'docs/yeoni-voice-comparison/media/gemini-zephyr-ja-user.wav'), 'base64'),
  ]);
  return <AssistantClient characterAudio={{ ko, ja }} alignReplies={!!alignmentConfiguration(process.env)} />;
}
