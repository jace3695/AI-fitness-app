import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantCharacterEnabled } from './assistant-feature.ts';
import { characterReplyEnabled } from './reply-plan.ts';

test('app rollout stays off in production until explicitly enabled', () => {
  for (const value of [undefined, '', '0', 'true', 'yes']) {
    assert.equal(assistantCharacterEnabled({ VERCEL_ENV: 'production', YEONI_ASSISTANT_CHARACTER_ENABLED: value }), false);
  }
  assert.equal(assistantCharacterEnabled({ VERCEL_ENV: 'production', YEONI_ASSISTANT_CHARACTER_ENABLED: '1' }), true);
});

test('Preview keeps the approved branch scope and supports an explicit off switch', () => {
  const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'agent/yeoni-cat-animation-poc' };
  assert.equal(assistantCharacterEnabled(env), true);
  assert.equal(assistantCharacterEnabled({ ...env, YEONI_ASSISTANT_CHARACTER_ENABLED: '0' }), false);
  assert.equal(assistantCharacterEnabled({ ...env, VERCEL_GIT_COMMIT_REF: 'other', YEONI_ASSISTANT_CHARACTER_ENABLED: '1' }), false);
  for (const VERCEL_ENV of [undefined, 'development', 'test']) {
    assert.equal(assistantCharacterEnabled({ VERCEL_ENV, YEONI_ASSISTANT_CHARACTER_ENABLED: '1' }), false);
  }
});

test('production rollout never opens the separate review pages', () => {
  const env = { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', YEONI_ASSISTANT_CHARACTER_ENABLED: '1' };
  assert.equal(assistantCharacterEnabled(env), true);
  assert.equal(characterReplyEnabled(env), false);
});
