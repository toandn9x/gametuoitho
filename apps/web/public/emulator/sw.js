// Bootstrap changes must reach players; only versioned CheerpJ files are immutable.
const CACHE_PREFIX = 'freej2me-cache-';
const CURRENT_PREFIX = `${CACHE_PREFIX}v2-`;
const LOCAL_CACHE = `${CURRENT_PREFIX}bootstrap`;
const scope = new URL(self.registration.scope);

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && !name.startsWith(CURRENT_PREFIX))
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

function forbidsCaching(headers) {
  return /(?:^|,)\s*(?:no-store|no-cache|private)\b/i.test(headers.get('Cache-Control') || '');
}

function cacheable(response) {
  return response.status === 200 &&
    (response.type === 'basic' || response.type === 'cors') &&
    !response.redirected && !forbidsCaching(response.headers) &&
    !response.headers.has('Set-Cookie') && response.headers.get('Vary') !== '*';
}

async function readCache(name, request) {
  try {
    const cache = await caches.open(name);
    const response = await cache.match(request);
    return response && cacheable(response) ? response : undefined;
  } catch {
    return undefined;
  }
}

async function updateCache(name, request, response) {
  try {
    const cache = await caches.open(name);
    if (cacheable(response)) {
      await cache.put(request, response.clone());
    } else {
      // A new error/private response must not leave a formerly public fallback.
      await cache.delete(request);
    }
  } catch (error) {
    console.warn('[SW] Cache update failed:', error);
  }
}

async function networkFirst(request) {
  let response;
  try {
    response = await fetch(request, { cache: 'no-cache' });
  } catch (error) {
    const cached = await readCache(LOCAL_CACHE, request);
    if (cached) return cached;
    throw error;
  }
  // HTTP errors are responses, not an offline signal: never hide them with old JS.
  await updateCache(LOCAL_CACHE, request, response);
  return response;
}

async function runtimeFirst(request, version) {
  const name = `${CURRENT_PREFIX}runtime-${version}`;
  const cached = await readCache(name, request);
  if (cached) return cached;
  const response = await fetch(request);
  await updateCache(name, request, response);
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('Range') ||
      request.headers.has('Authorization') || request.headers.has('Cookie') ||
      ['no-store', 'no-cache', 'reload'].includes(request.cache) ||
      forbidsCaching(request.headers) || request.headers.get('Pragma') === 'no-cache' ||
      url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  const version = url.origin === 'https://cjrtnc.leaningtech.com' &&
    url.pathname.match(/^\/(\d+\.\d+(?:\.\d+)?)\//)?.[1];
  if (version) {
    event.respondWith(runtimeFirst(request, version));
  } else if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname) &&
      (url.pathname === scope.pathname || /\.(?:html?|m?js|css)$/i.test(url.pathname))) {
    event.respondWith(networkFirst(request));
  }
  // API calls, game JARs and files outside this registration are left to the browser.
});
