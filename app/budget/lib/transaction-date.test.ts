import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTransactionParseSystem, parseInputLocally } from './transaction-parser.ts';

test('Korean morning uses the visible local date in both AI and fallback parsing', t => {
  const priorTimezone = process.env.TZ;
  process.env.TZ = 'Asia/Seoul';
  t.after(() => { if (priorTimezone === undefined) delete process.env.TZ; else process.env.TZ = priorTimezone; });
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-08T23:30:00Z') });
  assert.match(buildTransactionParseSystem(), /오늘 날짜: 2026-09-09/);
  assert.equal(parseInputLocally('오늘 커피 1000원')[0].date, '2026-09-09');
  assert.equal(parseInputLocally('어제 커피 1000원')[0].date, '2026-09-08');
});

test('the first morning of a month does not become the previous month in a budget request', t => {
  const priorTimezone = process.env.TZ;
  process.env.TZ = 'Asia/Seoul';
  t.after(() => { if (priorTimezone === undefined) delete process.env.TZ; else process.env.TZ = priorTimezone; });
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-31T15:05:00Z') });
  assert.match(buildTransactionParseSystem(), /오늘 날짜: 2026-09-01/);
  assert.equal(parseInputLocally('커피 1000원')[0].date, '2026-09-01');
  assert.equal(parseInputLocally('그제 커피 1000원')[0].date, '2026-08-30');
});
