/* eslint-disable no-restricted-globals */
/**
 * Service worker.
 *
 * Caching strategy is deliberately split by asset class, because a single
 * cache-first policy (what this file used to do) means a deployed update never
 * reaches the user: the old `js/app.js` keeps being served from the cache while
 * the database has already been migrated by the new code.
 *
 *   navigations (HTML)  → network first, fall back to the cached shell
 *   js / css / manifest → stale-while-revalidate: cached copy is served for
 *                         speed, then revalidated in the background so the next
 *                         load is the new code
 *   everything else     → cache first
 *
 * CACHE_NAME carries the app version, so a release gets a fresh cache and the
 * old one is deleted on activate. `skipWaiting` + `clients.claim` make the new
 * worker take over immediately, and the page listens for `SW_UPDATED` to tell
 * the user to reload.
 */
const APP_VERSION = '3.0.2';
// CacheStorage is shared by every app on the same origin. Scope the prefix to
// this installation's path so updating one GitHub Pages project cannot delete
// another project's offline assets (including older law-office stages).
const SCOPE_KEY = new URL(self.registration.scope).pathname.replace(/[^A-Za-z0-9]/g, '-');
const CACHE_PREFIX = `law-office-${SCOPE_KEY}-shell-v`;
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}`;
const SHELL = './index.html';

const PRECACHE = [
  './',
  './index.html',
  './performance-load-test.html',
  './manifest.json',
  './css/base.css',
  './css/components.css',
  './css/layout.css',
  './css/responsive.css',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/administrative.js',
  './js/app.js',
  './js/archive.js',
  './js/audit-center.js',
  './js/audit.js',
  './js/backup/backup.js',
  './js/backup/crypto.js',
  './js/backup/integrity.js',
  './js/backup/restore.js',
  './js/backup/stores.js',
  './js/calculators/administrative-engine.js',
  './js/calculators/calculators.js',
  './js/calculators/family-engine.js',
  './js/calculators/labor-engine.js',
  './js/calculators/legal-engine.js',
  './js/calculators/rule-metadata.js',
  './js/cases/case-graph.js',
  './js/cases/cases.js',
  './js/communications.js',
  './js/config.js',
  './js/core/constants.js',
  './js/core/dates.js',
  './js/core/device.js',
  './js/core/errors.js',
  './js/core/ids.js',
  './js/core/money.js',
  './js/core/performance.js',
  './js/core/settings.js',
  './js/core/text.js',
  './js/core/utils.js',
  './js/core/validators.js',
  './js/courts.js',
  './js/criminal.js',
  './js/criminal/criminal-engine.js',
  './js/dashboard/attention.js',
  './js/dashboard/dashboard.js',
  './js/data-quality.js',
  './js/db/db.js',
  './js/db/migrations.js',
  './js/db/repositories.js',
  './js/db/schema.js',
  './js/execution/execution.js',
  './js/experts-settlements/experts-settlements.js',
  './js/family.js',
  './js/financial/financial.js',
  './js/judicial/judicial.js',
  './js/labor.js',
  './js/lookups/lookups.js',
  './js/navigation/router.js',
  './js/people/people.js',
  './js/performance-center.js',
  './js/performance/load-test.js',
  './js/reports/print.js',
  './js/reports/reports.js',
  './js/reports/statistics.js',
  './js/search/filters.js',
  './js/search/index-builder.js',
  './js/search/search.js',
  './js/search/sorting.js',
  './js/security.js',
  './js/sync/engine.js',
  './js/sync/sync.js',
  './js/team.js',
  './js/templates.js',
  './js/timeline/timeline.js',
  './js/ui/async-select.js',
  './js/ui/command-palette.js',
  './js/ui/components.js',
  './js/ui/daily-center.js',
  './js/ui/date-filter.js',
  './js/ui/favorites.js',
  './js/ui/filters.js',
  './js/ui/loading.js',
  './js/ui/modal.js',
  './js/ui/notification.js',
  './js/ui/shell.js',
  './js/ui/toast.js',
  './js/work/work.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // All modules must be available before offline installation is claimed;
      // partial cache installs would make the offline app fail at import time.
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  let upgraded = false;
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        // Never delete caches owned by unrelated apps on the same origin.
        const outdated = keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
        upgraded = outdated.length > 0;
        return Promise.all(outdated.map((key) => caches.delete(key)));
      })
      .then(() => self.clients.claim())
      .then(() => upgraded ? self.clients.matchAll({ type: 'window' }) : [])
      .then((clients) => clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED', version: APP_VERSION })))
  );
});

const isNavigation = (request) =>
  request.mode === 'navigate' || (request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html'));

const needsRevalidation = (url) => /\.(?:js|mjs|css|json|webmanifest)$/i.test(url.pathname);

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async response => {
      if (response?.ok && response.type === 'basic') {
        await cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  // A Service Worker may be terminated as soon as respondWith resolves. Keep
  // it alive until the refreshed asset is actually written to the cache.
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const response = await network;
  if (response) return response;
  return new Response('/* offline and not cached */', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

async function networkFirst(request, event) {
  try {
    const response = await fetch(request);
    if (response?.ok) {
      const cache = await caches.open(CACHE_NAME);
      event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    }
    return response;
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    const cached = (await cache.match(request)) || (await cache.match(SHELL));
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response?.ok) event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never cache third parties

  if (isNavigation(request)) {
    event.respondWith(networkFirst(request, event));
    return;
  }
  if (needsRevalidation(url)) {
    event.respondWith(staleWhileRevalidate(request, event));
    return;
  }
  event.respondWith(cacheFirst(request, event));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
