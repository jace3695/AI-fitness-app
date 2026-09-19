import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RouteDrain } from './e2e/route-drain.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('route teardown waits for every pending response, not just the first completion', async () => {
  const routes = new RouteDrain(), first = deferred(), last = deferred();
  const a = routes.run(() => first.promise), b = routes.run(() => last.promise);
  let detached = false;
  const teardown = routes.wait().then(() => { detached = true; });
  first.resolve(); await a;
  assert.equal(detached, false);
  last.resolve(); await b; await teardown;
  assert.equal(detached, true);
});

test('a response that arrives while draining also finishes before interceptor removal', async () => {
  const routes = new RouteDrain(), first = deferred(), later = deferred();
  const a = routes.run(() => first.promise);
  let detached = false;
  const teardown = routes.wait().then(() => { detached = true; });
  const b = routes.run(() => later.promise);
  first.resolve(); await a;
  assert.equal(detached, false);
  later.resolve(); await b; await teardown;
  assert.equal(detached, true);
});

test('a routing failure remains an error while pending cleanup is still released', async () => {
  const routes = new RouteDrain(), gate = deferred();
  const failed = routes.run(async () => { await gate.promise; throw new Error('response delivery failed'); });
  const rejection = assert.rejects(failed, /response delivery failed/);
  const teardown = routes.wait();
  gate.resolve(); await rejection; await teardown;
  assert.equal(await routes.run(async () => 42), 42);
});
