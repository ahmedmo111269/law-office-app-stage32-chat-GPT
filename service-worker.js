const CACHE='law-office-shell-v3';
const ASSETS=["./", "./index.html", "./manifest.json", "./css/base.css", "./css/components.css", "./css/layout.css", "./css/responsive.css", "./js/administrative.js", "./js/app.js", "./js/archive.js", "./js/audit-center.js", "./js/audit.js", "./js/backup/backup.js", "./js/backup/crypto.js", "./js/backup/integrity.js", "./js/backup/restore.js", "./js/calculators/administrative-engine.js", "./js/calculators/calculators.js", "./js/calculators/family-engine.js", "./js/calculators/labor-engine.js", "./js/calculators/legal-engine.js", "./js/cases/cases.js", "./js/communications.js", "./js/config.js", "./js/core/constants.js", "./js/core/dates.js", "./js/core/errors.js", "./js/core/ids.js", "./js/core/performance.js", "./js/core/utils.js", "./js/core/validators.js", "./js/courts.js", "./js/criminal/criminal-engine.js", "./js/criminal.js", "./js/dashboard/attention.js", "./js/dashboard/dashboard.js", "./js/data-quality.js", "./js/db/db.js", "./js/db/migrations.js", "./js/db/repositories.js", "./js/db/schema.js", "./js/execution/execution.js", "./js/experts-settlements/experts-settlements.js", "./js/family.js", "./js/financial/financial.js", "./js/judicial/judicial.js", "./js/labor.js", "./js/lookups/lookups.js", "./js/navigation/router.js", "./js/people/people.js", "./js/performance-center.js", "./js/reports/reports.js", "./js/reports/statistics.js", "./js/search/filters.js", "./js/search/search.js", "./js/search/sorting.js", "./js/security.js", "./js/sync/sync.js", "./js/team.js", "./js/templates.js", "./js/timeline/timeline.js", "./js/ui/command-palette.js", "./js/ui/components.js", "./js/ui/daily-center.js", "./js/ui/date-filter.js", "./js/ui/favorites.js", "./js/ui/filters.js", "./js/ui/loading.js", "./js/ui/modal.js", "./js/ui/notification.js", "./js/ui/shell.js", "./js/ui/toast.js", "./js/work/work.js"];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const req=e.request;
  e.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{
    if(res.ok && new URL(req.url).origin===location.origin){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));}
    return res;
  }).catch(()=>{
    if(req.mode==='navigate') return caches.match('./index.html');
    return Response.error();
  })));
});
