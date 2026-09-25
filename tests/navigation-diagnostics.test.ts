import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { BrowserContext } from '@playwright/test';
import { failureLabel, observeNavigation, routeLabel } from './e2e/navigation-diagnostics.ts';

test('navigation diagnostics never export tokens, arbitrary paths or exception text', () => {
  assert.equal(routeLabel('http://127.0.0.1:3000/growth/drawing?token=private#secret'), '/growth/drawing');
  assert.equal(routeLabel('http://127.0.0.1:3000/private-account'), 'other-app-route');
  assert.equal(routeLabel('https://private.example/account'), 'other-origin');
  assert.equal(routeLabel('secret'), 'unknown');
  assert.equal(failureLabel('page.goto: WebKit encountered an internal error secret'), 'webkit-internal');
  assert.equal(failureLabel('private response body'), 'other');
});

test('navigation diagnostics bound evidence and detach before intentional cleanup', () => {
  const page = new EventEmitter(); const browser = new EventEmitter();
  const context = Object.assign(new EventEmitter(), { pages: () => [page], browser: () => browser });
  const finish = observeNavigation(context as unknown as BrowserContext);
  const request = { isNavigationRequest: () => true, resourceType: () => 'document', url: () => 'http://127.0.0.1:3000/growth/drawing?secret=private', failure: () => ({ errorText: 'WebKit encountered an internal error private' }) };
  for (let i = 0; i < 90; i++) context.emit('request', request);
  context.emit('requestfailed', request); page.emit('crash');
  const report = finish();
  assert.equal(report.events.length, 80); assert.equal(report.dropped, 12);
  assert.equal(report.crashed, true); assert.equal(report.disconnected, false);
  assert.equal(JSON.stringify(report).includes('private'), false);
  browser.emit('disconnected'); page.emit('pageerror', new Error('private'));
  assert.equal(report.events.length, 80);
  assert.equal(browser.listenerCount('disconnected'), 0);
  assert.equal(context.listenerCount('request'), 0);
  assert.equal(page.listenerCount('pageerror'), 0);
});
