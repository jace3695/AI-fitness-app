import assert from "node:assert/strict";
import test from "node:test";
import { GoogleCalendarReadError, MAX_GOOGLE_CALENDAR_PAGES, readGoogleCalendarPages } from "./google-calendar-pages.ts";

const event = (id: string) => ({ id, start: { date: "2026-10-12" } });
const unexpectedPage = async (): Promise<Response> => { throw new Error("Unexpected synthetic page request"); };
const isReadError = (error: unknown) => error instanceof GoogleCalendarReadError && error.status === 502;

test("a valid empty final page confirms an empty result without extra requests", async () => {
  assert.deepEqual(await readGoogleCalendarPages(Response.json({ items: [] }), unexpectedPage), []);
});

test("omitted items in a recognized final Events collection confirms an empty result", async () => {
  assert.deepEqual(await readGoogleCalendarPages(Response.json({ kind: "calendar#events", etag: '"synthetic-etag"' }), unexpectedPage), []);
});

test("omitted items on an intermediate page still follows pagination", async () => {
  const tokens: string[] = [];
  const items = await readGoogleCalendarPages(Response.json({ kind: "calendar#events", etag: '"synthetic-etag"', nextPageToken: "later" }), async token => {
    tokens.push(token);
    return Response.json({ items: [event("later")] });
  });
  assert.deepEqual(tokens, ["later"]);
  assert.deepEqual(items, [event("later")]);
  await assert.rejects(readGoogleCalendarPages(Response.json({ kind: "calendar#events", etag: '"synthetic-etag"', nextPageToken: null }), unexpectedPage), isReadError);
});

test("an empty intermediate page follows the opaque token and returns later events", async () => {
  const tokens: string[] = [];
  const items = await readGoogleCalendarPages(Response.json({ items: [], nextPageToken: "opaque+token/one=" }), async token => {
    tokens.push(token);
    return Response.json({ items: [event("later")] });
  });
  assert.deepEqual(tokens, ["opaque+token/one="]);
  assert.deepEqual(items, [event("later")]);
});

test("all pages are accumulated in order and only the final result is returned", async () => {
  const tokens: string[] = [];
  const items = await readGoogleCalendarPages(Response.json({ items: [event("first")], nextPageToken: "second" }), async token => {
    tokens.push(token);
    return token === "second" ? Response.json({ items: [event("second")], nextPageToken: "third" }) : Response.json({ items: [event("third")] });
  });
  assert.deepEqual(tokens, ["second", "third"]);
  assert.deepEqual(items.map(item => item.id), ["first", "second", "third"]);
});

test("malformed HTTP-200 payloads and invalid JSON reject rather than confirm empty", async () => {
  for (const payload of [null, {}, { items: null }, { items: [null] }, { items: [{}] }, { items: [], error: {} }]) {
    await assert.rejects(readGoogleCalendarPages(Response.json(payload), unexpectedPage), isReadError);
  }
  await assert.rejects(readGoogleCalendarPages(new Response("not JSON"), unexpectedPage), isReadError);
});

test("malformed pagination tokens reject instead of silently stopping", async () => {
  for (const nextPageToken of [null, "", " ", 123, {}, []]) {
    await assert.rejects(readGoogleCalendarPages(Response.json({ items: [], nextPageToken }), unexpectedPage), isReadError);
  }
});

test("a repeated pagination token rejects without an infinite request chain", async () => {
  let calls = 0;
  await assert.rejects(readGoogleCalendarPages(Response.json({ items: [], nextPageToken: "same" }), async () => {
    calls++;
    return Response.json({ items: [], nextPageToken: "same" });
  }), isReadError);
  assert.equal(calls, 1);
});

test("a failed later page never returns a successful partial result", async () => {
  await assert.rejects(readGoogleCalendarPages(Response.json({ items: [event("first")], nextPageToken: "next" }), async () => new Response("unavailable", { status: 503 })), isReadError);
  await assert.rejects(readGoogleCalendarPages(new Response("forbidden", { status: 403 }), unexpectedPage), error => error instanceof GoogleCalendarReadError && error.status === 403);
  await assert.rejects(readGoogleCalendarPages(Response.json({ items: [], nextPageToken: "next" }), async () => { throw new Error("synthetic network failure"); }), /synthetic network failure/);
});

test("the page cap fails explicitly; a final page at the cap still succeeds", async () => {
  let calls = 0;
  await assert.rejects(readGoogleCalendarPages(Response.json({ items: [], nextPageToken: "1" }), async () => {
    calls++;
    return Response.json({ items: [], nextPageToken: String(calls + 1) });
  }), error => isReadError(error) && (error as Error).message.includes("전체 조회를 완료하지 못했습니다"));
  assert.equal(calls, MAX_GOOGLE_CALENDAR_PAGES - 1);
  calls = 0;
  assert.deepEqual(await readGoogleCalendarPages(Response.json({ items: [], nextPageToken: "1" }), async () => {
    calls++;
    return Response.json(calls === MAX_GOOGLE_CALENDAR_PAGES - 1 ? { items: [event("last")] } : { items: [], nextPageToken: String(calls + 1) });
  }), [event("last")]);
  assert.equal(calls, MAX_GOOGLE_CALENDAR_PAGES - 1);
});
