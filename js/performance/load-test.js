import { BENCHMARK_STORES } from '../db/db.js';
import { benchmarkRepo } from '../db/repositories.js';

const SIZES = Object.freeze({
  small: { clients: 1000, cases: 1000, hearings: 3000, procedures: 5000, caseTasks: 1000 },
  medium: { clients: 10000, cases: 10000, hearings: 30000, procedures: 50000, caseTasks: 10000 },
  large: { clients: 100000, cases: 100000, hearings: 300000, procedures: 500000, caseTasks: 100000 }
});
const sizeInput = document.getElementById('size');
const runButton = document.getElementById('runTest');
const cancelButton = document.getElementById('cancelTest');
const clearButton = document.getElementById('clearTest');
const status = document.getElementById('status');
const progress = document.getElementById('progress');
const results = document.getElementById('results');
let running = false;
let cancelled = false;

const write = text => { results.textContent += `\n${text}`; };
const updateStatus = (text, state) => { status.textContent = text; status.dataset.state = state; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const elapsed = since => Math.round(performance.now() - since);
const storage = async () => {
  const estimate = await navigator.storage?.estimate?.();
  return estimate ? { originUsageMB: Math.round(estimate.usage / 1048576), originQuotaMB: Math.round(estimate.quota / 1048576) } : null;
};

async function clearBenchmark() {
  // Only the separate LawOfficeBenchmarkDB is opened here, never LawOfficeDB.
  for (const name of BENCHMARK_STORES) {
    // eslint-disable-next-line no-await-in-loop
    await benchmarkRepo(name).clear();
  }
  for (const name of BENCHMARK_STORES) {
    // eslint-disable-next-line no-await-in-loop
    if (await benchmarkRepo(name).count() !== 0) throw new Error(`لم يُمسح مخزن الاختبار ${name}.`);
  }
}

function syntheticRow(name, n, spec, firstIds) {
  // IndexedDB clear() does not reset autoIncrement. Use IDs actually assigned
  // to this run, not 1-based guesses, or repeated benchmarks create orphans.
  const caseId = (firstIds.cases ?? 1) + n % spec.cases;
  if (name === 'clients') return { fullName: `عميل تجريبي ${n}`, city: 'بنها', archived: 0 };
  if (name === 'cases') return { caseNumber: String(n + 1), caseYear: 2025, status: 'open', clientId: firstIds.clients + n % spec.clients, archived: 0 };
  if (name === 'hearings') return { caseId, date: '2025-06-15', status: 'scheduled' };
  if (name === 'procedures') return { caseId, date: '2025-06-15', description: `إجراء تجريبي ${n}` };
  return { caseId, title: `مهمة تجريبية ${n}`, date: '2025-06-15', status: 'open' };
}

async function runBenchmark(spec) {
  const total = Object.values(spec).reduce((sum, count) => sum + count, 0);
  let completed = 0;
  const seedStarted = performance.now();
  const writes = {};
  const firstIds = { clients: null, cases: null };
  for (const name of BENCHMARK_STORES) {
    const started = performance.now();
    const count = spec[name];
    for (let offset = 0; offset < count; offset += 500) {
      if (cancelled) throw new Error('أوقف المستخدم اختبار الحمل.');
      const rows = Array.from({ length: Math.min(500, count - offset) }, (_, index) => syntheticRow(name, offset + index, spec, firstIds));
      // eslint-disable-next-line no-await-in-loop
      await benchmarkRepo(name).addBatch(rows);
      completed += rows.length;
      progress.value = Math.round(completed / total * 100);
      if (offset % 2500 === 0 || offset + rows.length >= count) {
        updateStatus(`${name}: ${Math.min(offset + rows.length, count).toLocaleString('ar-EG')} / ${count.toLocaleString('ar-EG')} — ${progress.value}%`, 'running');
        // eslint-disable-next-line no-await-in-loop
        await tick();
      }
    }
    if (name === 'clients' || name === 'cases') {
      // eslint-disable-next-line no-await-in-loop
      firstIds[name] = (await benchmarkRepo(name).page({ limit: 1 })).rows[0]?.id;
      if (!Number.isSafeInteger(firstIds[name])) throw new Error(`مفتاح أول سجل في ${name} غير متاح.`);
    }
    writes[name] = elapsed(started);
    write(`${name}: ${count} records, ${writes[name]} ms`);
  }
  const seedMs = elapsed(seedStarted);
  const counts = {};
  for (const name of BENCHMARK_STORES) {
    // eslint-disable-next-line no-await-in-loop
    counts[name] = await benchmarkRepo(name).count();
    if (counts[name] !== spec[name]) throw new Error(`عدد سجلات ${name} غير مطابق: ${counts[name]} من ${spec[name]}.`);
  }
  const cases = benchmarkRepo('cases');
  let started = performance.now();
  const first = await cases.page({ limit: 50 });
  const page50Ms = elapsed(started);
  started = performance.now();
  let key = null;
  let deepRows = 0;
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    // eslint-disable-next-line no-await-in-loop
    const page = await cases.page({ limit: 50, afterKey: key });
    deepRows += page.rows.length;
    key = page.nextKey;
    if (!page.hasMore) break;
  }
  const deepPagesMs = elapsed(started);
  started = performance.now();
  const linkedHearings = await benchmarkRepo('hearings').countByIndex('caseId', firstIds.cases);
  const byIndexMs = elapsed(started);
  if (linkedHearings !== Math.ceil(spec.hearings / spec.cases)) {
    throw new Error('ربط جلسات الاختبار بالقضية الأولى غير سليم.');
  }
  return {
    rows: total, counts, firstIds, writesMs: writes, seedMs, page50Ms, page50Rows: first.rows.length,
    firstCaseId: first.rows[0]?.id, firstCaseClientId: first.rows[0]?.clientId,
    deepPagesMs, deepRows, byIndexMs, linkedHearings,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    storage: await storage()
  };
}

runButton.addEventListener('click', async () => {
  if (running) return;
  const size = sizeInput.value;
  const spec = SIZES[size];
  if (!spec) { updateStatus('حجم الاختبار غير معروف.', 'failed'); return; }
  if (size === 'large' && !window.confirm('Large سيكتب ١٬١٠٠٬٠٠٠ سجل مؤقتًا في حصة تخزين هذا الموقع. هل تستخدم ملف تعريف تجريبيًا خاليًا من بيانات المكتب؟')) return;
  running = true;
  cancelled = false;
  runButton.disabled = true;
  clearButton.disabled = true;
  cancelButton.disabled = false;
  progress.value = 0;
  results.textContent = `${size.toUpperCase()} — قياس فعلي في قاعدة بيانات اصطناعية منفصلة`;
  updateStatus('جاري تنظيف بيانات اختبار سابقة…', 'running');
  try {
    await clearBenchmark();
    write(`storage before: ${JSON.stringify(await storage())}`);
    const result = await runBenchmark(spec);
    write(`RESULT: ${JSON.stringify(result)}`);
    updateStatus(`اكتمل القياس: ${result.rows.toLocaleString('ar-EG')} سجل، كتابة ${result.seedMs} ms، صفحة ٥٠ ${result.page50Ms} ms.`, 'complete');
  } catch (error) {
    write(`ERROR: ${error?.message || error}`);
    updateStatus(cancelled ? 'أوقف الاختبار. تُمسح بيانات الاختبار الآن.' : `تعذر إكمال الاختبار: ${error?.message || error}`, cancelled ? 'cancelled' : 'failed');
  } finally {
    cancelButton.disabled = true;
    try {
      await clearBenchmark();
      write('CLEANUP: all synthetic test stores are empty. LawOfficeDB was not touched.');
    } catch (error) {
      write(`CLEANUP FAILED: ${error?.message || error}`);
      updateStatus('تعذر مسح بيانات الاختبار؛ حاول زر المسح مجددًا أو تحقق من مساحة التخزين.', 'failed');
    }
    running = false;
    runButton.disabled = false;
    clearButton.disabled = false;
  }
});

cancelButton.addEventListener('click', () => {
  cancelled = true;
  cancelButton.disabled = true;
  updateStatus('جارٍ إيقاف الاختبار بعد الدفعة الحالية…', 'running');
});

clearButton.addEventListener('click', async () => {
  if (running) return;
  clearButton.disabled = true;
  try {
    await clearBenchmark();
    progress.value = 0;
    write('CLEANUP: test stores cleared; office data untouched.');
    updateStatus('مُسحت بيانات الاختبار الاصطناعية فقط.', 'idle');
  } catch (error) {
    updateStatus(`تعذر مسح الاختبار: ${error?.message || error}`, 'failed');
  } finally { clearButton.disabled = false; }
});
