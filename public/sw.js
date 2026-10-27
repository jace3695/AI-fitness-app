const CACHE_VERSION = "jace-ai-hub-v6";
const APP_CACHE = `${CACHE_VERSION}-app`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const APP_SHELL = ["/", "/offline", "/manifest.json", "/icon-192.png", "/icon-512.png"];
const isBoundaryDiagnostic = (url) => url.origin === self.location.origin &&
  (url.pathname === "/language/practice/access-check" || url.pathname.startsWith("/language/practice/access-check/"));

// Remove only obsolete diagnostic documents, never record storage or ordinary
// offline pages. Includes query/RSC variants that an older worker may have kept.
const purgeBoundaryDocuments = async () => {
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      if (isBoundaryDiagnostic(new URL(request.url))) await cache.delete(request);
    }
  }
};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    purgeBoundaryDocuments().then(() => caches.keys())
      .then((keys) => Promise.all(keys.filter((key) => key !== APP_CACHE && key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() };
  }
  event.waitUntil(self.registration.showNotification(payload.title || "AI 연이", {
    body: payload.body || "오늘의 브리핑을 확인해 보세요.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || "ai-fitness-workout",
    data: { url: payload.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) {
      existing.navigate(target);
      return existing.focus();
    }
    return clients.openWindow(target);
  }));
});

const isCacheableStaticRequest = (request, url) => (
  request.method === "GET" &&
  url.origin === self.location.origin &&
  (url.pathname.startsWith("/_next/static/") || ["style", "script", "image", "font"].includes(request.destination))
);

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (isBoundaryDiagnostic(url)) {
    // Never cache or replay a server-gated diagnostic, even when offline. Do not
    // fall back to the home page (which mounts personal-record synchronization).
    event.respondWith(fetch(request, { cache: "no-store", redirect: "error" }).catch(() =>
      new Response("Diagnostic unavailable offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(APP_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("/")) || caches.match("/offline")),
    );
    return;
  }

  if (isCacheableStaticRequest(request, url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (!response.ok || response.type !== "basic") return response;
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          return response;
        });
      }),
    );
  }
});
