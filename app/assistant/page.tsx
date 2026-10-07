import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { characterReplyEnabled } from '@/lib/yeoni/reply-plan';
import AssistantClient from './AssistantClient';

export default async function AssistantPage() {
  if (!characterReplyEnabled(process.env)) return <AssistantClient />;
  const [ko, ja] = await Promise.all([
    readFile(path.join(process.cwd(), 'docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3'), 'base64'),
    readFile(path.join(process.cwd(), 'docs/yeoni-voice-comparison/media/gemini-zephyr-ja-user.wav'), 'base64'),
  ]);
  return <AssistantClient characterAudio={{ ko, ja }} />;
}
