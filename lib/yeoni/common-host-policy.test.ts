import assert from 'node:assert/strict';
import test from 'node:test';
import { commonCharacterEnabled, isQuietCharacterRoute, isCharacterReviewRoute } from './common-host-policy.ts';
import { parseYeoniPreferences } from '../../utils/yeoniPreferences.ts';

test('common host is a local/explicit Preview candidate, never production rollout', () => {
  assert.equal(commonCharacterEnabled({ NODE_ENV: 'development' }), true);
  assert.equal(commonCharacterEnabled({ NODE_ENV: 'development', YEONI_COMMON_CHARACTER_ENABLED: '0' }), false);
  assert.equal(commonCharacterEnabled({ VERCEL_ENV: 'preview' }), false);
  assert.equal(commonCharacterEnabled({ NODE_ENV: 'production', VERCEL_ENV: 'preview', YEONI_COMMON_CHARACTER_ENABLED: '1' }), true);
  assert.equal(commonCharacterEnabled({ VERCEL_ENV: 'production', YEONI_COMMON_CHARACTER_ENABLED: '1' }), false);
  assert.equal(commonCharacterEnabled({ NODE_ENV: 'production', YEONI_COMMON_CHARACTER_ENABLED: '1' }), false);
});
test('appearance whitelist strips arbitrary fields and keeps legacy device settings', () => {
  assert.deepEqual(parseYeoniPreferences('{"appearance":"human","visible":false,"motion":"off","owner":"private"}'),
    { appearance: 'human', visible: false, motion: 'off' });
  for (const appearance of ['cat', 'other', null, {}, 'https://example.com']) {
    assert.equal(parseYeoniPreferences(JSON.stringify({ appearance })).appearance, 'cat');
  }
  assert.deepEqual(parseYeoniPreferences(null, '{"showCompanion":false,"homeCompanionMotion":false}'),
    { appearance: 'cat', visible: false, motion: 'off' });
});
test('focus route and review boundaries do not accidentally match other app names', () => {
  for (const path of ['/fitness', '/fitness/session', '/growth/drawing', '/growth/typing/basics', '/growth/handwriting/free']) assert.equal(isQuietCharacterRoute(path), true);
  for (const path of ['/', '/diet', '/budget', '/language', '/assistant', '/fitness-other']) assert.equal(isQuietCharacterRoute(path), false);
  assert.equal(isCharacterReviewRoute('/assistant/character-check'), true);
  assert.equal(isCharacterReviewRoute('/assistant'), false);
});
