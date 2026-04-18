const CACHE_NAME = 'turnco-v3';

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TurnCo — No Connection</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
    background:#f9fafb;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{text-align:center;padding:2.5rem 2rem;max-width:320px}
  svg{display:block;margin:0 auto 1.5rem;color:#9ca3af}
  h2{font-size:1.2rem;font-weight:700;color:#111827;margin-bottom:.5rem}
  p{font-size:.875rem;color:#6b7280;line-height:1.5;margin-bottom:1.5rem}
  button{background:#2563eb;color:#fff;border:none;padding:.65rem 1.75rem;
    border-radius:.75rem;font-size:.875rem;font-weight:600;cursor:pointer}
  button:active{background:#1d4ed8}
</style>
</head>
<body>
<div class="card">
  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="1" y1="1" x2="23" y2="23"/>
    <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
    <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
    <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
    <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
    <circle cx="12" cy="20" r=".5" fill="currentColor"/>
  </svg>
  <h2>No Internet Connection</h2>
  <p>Check your connection and try again.</p>
  <button onclick="location.reload()">Try Again</button>
</div>
</body>
</html>`;
const STATIC_ASSETS = [
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

// Install: pre-cache only non-HTML static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: delete old caches and take control immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - Cross-origin requests (Supabase, etc.): always network, never cache
// - Same-origin /api/* routes: network only
// - HTML navigation (index.html, /): network-first so deploys are picked up immediately
// - Other static assets (icons, manifest): cache-first
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache cross-origin requests (Supabase API, etc.)
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(request));
    return;
  }

  // Never cache our own API routes
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Network-first for HTML — always get the latest deployed version
  // Falls back to cache only when offline
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached =>
          cached || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html' } })
        ))
    );
    return;
  }

  // Cache-first for other static assets (icons, manifest, etc.)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
