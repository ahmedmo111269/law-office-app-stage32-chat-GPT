import { APP_CONFIG } from '../config.js';
import { repo } from '../db/repositories.js';
import { escapeHtml } from '../core/utils.js';
import { getDeviceId, adoptLegacyDeviceId } from '../core/device.js';
import { restoreBackup } from '../backup/restore.js';
import { createBackup } from '../backup/backup.js';
import { getSetting, putSetting } from '../core/settings.js';
import {
  createMergeBundle,
  createSnapshotBundle,
  parseBundle,
  applyBundle,
  getSyncStatus,
  backfillUids,
  listConflicts,
  resolveConflict
} from './engine.js';

/**
 * Sync screen.
 *
 * Honest description of what this build provides:
 *  - **merge mode** — a real two-way merge: change log + tombstones + stable
 *    uids + deterministic conflict resolution. Both devices converge.
 *  - **snapshot mode** — a full encrypted replacement, used for the very first
 *    pairing or after one device restored a backup. It replaces, it does not merge.
 *
 * There is still no server: the bundle is a file you move between devices.
 */

function download(text, fileName) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function renderSyncPage(page) {
  // Adopt a device id created by the pre-3.0 build, if any.
  const legacy = await getSetting('sync.deviceId').catch(() => null);
  if (legacy?.value) adoptLegacyDeviceId(legacy.value);

  const status = await getSyncStatus();
  const conflicts = await listConflicts(50);

  page.innerHTML = `
    <section class="card">
      <div class="section-title"><div>
        <span class="eyebrow">المزامنة</span>
        <h2>مزامنة الهاتف والكمبيوتر</h2>
        <p class="muted">مزامنة محلية عبر ملف مشفّر AES-256-GCM. لا يوجد خادم ولا حساب خارجي.</p>
      </div></div>
      <div class="detail-grid">
        <div><span>معرّف هذا الجهاز</span><strong dir="ltr">${escapeHtml(status.deviceId)}</strong></div>
        <div><span>إصدار التطبيق</span><strong>${escapeHtml(APP_CONFIG.version)}</strong></div>
        <div><span>إصدار قاعدة البيانات</span><strong>${escapeHtml(String(APP_CONFIG.dbVersion))}</strong></div>
        <div><span>آخر دمج ناجح</span><strong>${escapeHtml(status.lastMergeAt || 'لا يوجد')}</strong></div>
        <div><span>سجل التغييرات المحلي</span><strong>${status.changeCount.toLocaleString('ar-EG')} تغييرًا</strong></div>
        <div><span>تعارضات غير محسومة</span><strong class="${status.conflicts ? 'danger' : ''}">${status.conflicts}</strong></div>
        <div><span>سجلات بلا معرّف عالمي</span><strong class="${status.missingUids ? 'danger' : ''}">${status.missingUids.toLocaleString('ar-EG')}</strong></div>
        <div><span>استبدال كامل للبيانات</span><strong>${escapeHtml(status.fullResyncAt || 'لا يوجد')}</strong></div>
      </div>
    </section>

    <section class="card">
      <h2>0 — تجهيز المعرفات العالمية (مرة واحدة لكل قاعدة بيانات)</h2>
      <p class="muted">الدمج الثنائي يحتاج معرّفًا عالميًا ثابتًا (uid) لكل سجل. السجلات التي أُنشئت قبل هذا الإصدار تحصل على المعرّف هنا. العملية آمنة ولا تغيّر أي بيانات.</p>
      <button id="uidBtn" class="primary-button" ${status.missingUids ? '' : 'disabled'}>🆔 تجهيز المعرفات العالمية</button>
      <div id="uidStatus" class="notice">${status.missingUids ? `${status.missingUids.toLocaleString('ar-EG')} سجل بحاجة إلى معرّف عالمي.` : 'كل السجلات تحمل معرّفًا عالميًا.'}</div>
    </section>

    <section class="card">
      <h2>1 — إرسال تغييرات هذا الجهاز (دمج)</h2>
      <p class="muted">يُصدر الحزمة التغييرات التي حدثت بعد آخر دمج مع الجهاز الآخر. إن لم يسبق الدمج، تُصدر كل التغييرات.</p>
      <div class="form-grid">
        <label>كلمة مرور الحزمة *<input id="exportPassword" class="input" type="password" autocomplete="new-password" placeholder="كلمة مرور قوية"></label>
        <label>الدمج بعد التغيير رقم<input id="exportFrom" class="input" type="number" min="0" value="0" placeholder="0 = كل التغييرات"></label>
      </div>
      <div class="row-actions"><button id="exportBtn" class="primary-button">🔐 إنشاء حزمة دمج</button>
      <button id="snapshotBtn" class="secondary-button">📦 إنشاء حزمة كاملة (snapshot)</button></div>
      <div id="exportStatus" class="notice hidden"></div>
    </section>

    <section class="card">
      <h2>2 — استقبال حزمة من الجهاز الآخر</h2>
      <input id="importFile" class="input" type="file" accept=".losync,application/json">
      <div class="form-grid" style="margin-top:12px">
        <label>كلمة مرور الحزمة *<input id="importPassword" class="input" type="password" autocomplete="current-password"></label>
      </div>
      <div class="row-actions" style="margin-top:12px">
        <button id="previewBtn" class="secondary-button">🔎 معاينة</button>
        <button id="applyBtn" class="primary-button" disabled>⬇️ تطبيق</button>
      </div>
      <div id="previewBox" class="notice" style="margin-top:12px">اختر الحزمة ثم اضغط «معاينة».</div>
      <div id="progressBox" class="muted" style="margin-top:8px"></div>
    </section>

    ${conflicts.length ? `<section class="card"><h2>3 — تعارضات تحتاج مراجعة</h2>
      <p class="muted">عند تعديل نفس السجل على الجهازين، يُحتفظ بالأحدث ويُحفظ الآخر هنا للمراجعة.</p>
      <div class="issues-list">${conflicts.map(c => `<div class="notice"><strong>${escapeHtml(c.store)} #${escapeHtml(c.recordId)}</strong> — ${escapeHtml(c.detectedAt)} ${c.resolved ? '<span class="badge">محسوم</span>' : ''}
        <div class="row-actions"><button class="secondary-button" data-conflict-local="${c.id}">احتفظ بنسختي</button><button class="secondary-button" data-conflict-remote="${c.id}">احتفظ بالنسخة الواردة</button></div></div>`).join('')}</div>
    </section>` : ''}

    <section class="card">
      <h2>كيف تعمل المزامنة بالضبط</h2>
      <ol class="simple-list">
        <li>كل سجل يحمل <code>uid</code> عالميًا و<code>rev</code> و<code>updatedAt</code> و<code>deviceId</code>.</li>
        <li>كل تعديل يُسجّل في سجل تغييرات مرتّب، والحذف يُسجّل كـ tombstone حتى ينتقل للجهاز الآخر.</li>
        <li>عند الدمج: الأحدث حسب <code>updatedAt</code> يفوز، والتساوي يُحسم بـ <code>rev</code> ثم <code>deviceId</code> لضمان نفس النتيجة على الجهازين.</li>
        <li>إن عُدّل نفس السجل على الجهازين، تُحفظ النسخة الخاسرة في «التعارضات» بدل إتلافها.</li>
        <li>تطبيق نفس الحزمة مرتين لا يغيّر شيئًا (idempotent)، لأن كل مقارنة تشترط «أحدث مما عندي».</li>
      </ol>
      <div class="notice"><strong>حدود معروفة:</strong> لا يوجد خادم، لذا المزامنة تتم بنقل ملف بين الجهازين. الدمج التلقائي في نفس اللحظة على جهازين دون نقل ملف يحتاج خدمة وسيطة — وهي ليست موجودة في هذا الإصدار المحلي.</div>
    </section>`;

  const progress = page.querySelector('#progressBox');
  let parsed = null;
  const invalidatePreview = () => {
    parsed = null;
    page.querySelector('#applyBtn').disabled = true;
    page.querySelector('#previewBox').textContent = 'تغيّر الملف أو كلمة المرور. عاين الحزمة مجددًا قبل التطبيق.';
  };
  page.querySelector('#importFile').addEventListener('change', invalidatePreview);
  page.querySelector('#importPassword').addEventListener('input', invalidatePreview);

  page.querySelector('#uidBtn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const box = page.querySelector('#uidStatus');
    try {
      const result = await backfillUids({
        chunkSize: 400,
        onProgress: (p) => { box.textContent = `جاري الفحص: ${p.store} — ${p.scanned.toLocaleString('ar-EG')} سجل`; }
      });
      box.textContent = `تم تجهيز ${result.upgraded.toLocaleString('ar-EG')} معرّفًا عالميًا من ${result.scanned.toLocaleString('ar-EG')} سجل.`;
      await renderSyncPage(page);
    } catch (error) {
      box.textContent = error.message || 'تعذر تجهيز المعرفات.';
      button.disabled = false;
    }
  });

  page.querySelector('#exportBtn').addEventListener('click', async () => {
    const password = page.querySelector('#exportPassword').value;
    const from = Number(page.querySelector('#exportFrom').value) || 0;
    const box = page.querySelector('#exportStatus');
    box.classList.remove('hidden');
    if (!password) { box.textContent = 'أدخل كلمة مرور الحزمة.'; return; }
    box.textContent = 'جاري إنشاء حزمة الدمج…';
    try {
      const result = await createMergeBundle({ password, peerCursor: from });
      download(result.text, result.fileName);
      box.textContent = `تم إنشاء ${result.fileName} — ${result.summary.changes.toLocaleString('ar-EG')} تغيير، ${result.summary.tombstones} محذوف.`;
      await putSetting('sync.lastExportAt', new Date().toISOString());
    } catch (error) {
      box.textContent = error.message || 'تعذر إنشاء الحزمة.';
    }
  });

  page.querySelector('#snapshotBtn').addEventListener('click', async () => {
    const password = page.querySelector('#exportPassword').value;
    const box = page.querySelector('#exportStatus');
    box.classList.remove('hidden');
    if (!password) { box.textContent = 'أدخل كلمة مرور الحزمة.'; return; }
    box.textContent = 'جاري إنشاء الحزمة الكاملة…';
    try {
      const result = await createSnapshotBundle({ password });
      download(result.text, result.fileName);
      box.textContent = `تم إنشاء ${result.fileName} (نسخة كاملة).`;
    } catch (error) {
      box.textContent = error.message || 'تعذر إنشاء الحزمة الكاملة.';
    }
  });

  page.querySelector('#previewBtn').addEventListener('click', async () => {
    const file = page.querySelector('#importFile').files[0];
    const password = page.querySelector('#importPassword').value;
    const box = page.querySelector('#previewBox');
    const applyBtn = page.querySelector('#applyBtn');
    try {
      parsed = await parseBundle(file, password);
      const s = parsed.summary;
      box.innerHTML = parsed.mode === 'snapshot'
        ? `<strong>حزمة كاملة (snapshot)</strong><br>السجلات: ${Number(s.totalRecords || 0).toLocaleString('ar-EG')}<br>${parsed.warnings.map(w => `⚠️ ${escapeHtml(w)}`).join('<br>')}`
        : `<strong>حزمة دمج</strong><br>الجهاز المصدر: ${escapeHtml(s.sourceDevice)}<br>التغييرات: ${s.changes.toLocaleString('ar-EG')} — المحذوفات: ${s.tombstones.toLocaleString('ar-EG')}<br>نطاق التغييرات: ${s.fromSeq} → ${s.toSeq}`;
      applyBtn.disabled = false;
      applyBtn.textContent = parsed.mode === 'snapshot' ? '⚠️ استبدال بيانات هذا الجهاز' : '⬇️ دمج التغييرات';
    } catch (error) {
      parsed = null;
      applyBtn.disabled = true;
      box.textContent = error.message || 'تعذر قراءة الحزمة.';
    }
  });

  page.querySelector('#applyBtn').addEventListener('click', async () => {
    if (!parsed) return;
    const danger = parsed.mode === 'snapshot';
    const message = danger
      ? 'ستُستبدل بيانات هذا الجهاز بالكامل بعد أخذ نسخة طوارئ تلقائية. هل تريد المتابعة؟'
      : 'سيتم دمج التغييرات الواردة مع بيانات هذا الجهاز. هل تريد المتابعة؟';
    if (!window.confirm(message)) return;

    const applyBtn = page.querySelector('#applyBtn');
    applyBtn.disabled = true;
    try {
      progress.textContent = 'جاري أخذ نسخة طوارئ…';
      await createBackup({ requireHealthy: false });
      const result = await applyBundle(parsed, {
        confirm: true,
        restoreSnapshot: async (payload, options) => restoreBackup({ payload }, options),
        onProgress: (p) => {
          progress.textContent = p.phase === 'index'
            ? `بناء فهرس البحث: ${p.store} (${p.index}/${p.total})`
            : `استعادة ${p.index}/${p.total}: ${p.store}`;
        }
      });
      if (result.mode === 'snapshot') {
        progress.textContent = 'تم استبدال البيانات بالكامل. أعد تحميل الصفحة.';
      } else {
        progress.textContent = `اكتمل الدمج: ${result.applied} تطبيق، ${result.skipped} بدون تغيير، ${result.deleted} حذف، ${result.conflicts} تعارض محفوظ.`;
      }
      await renderSyncPage(page);
    } catch (error) {
      progress.textContent = error.message || 'فشلت المزامنة.';
      applyBtn.disabled = false;
    }
  });

  page.querySelectorAll('[data-conflict-local]').forEach((button) => {
    button.addEventListener('click', async () => {
      await resolveConflict(Number(button.dataset.conflictLocal), { keep: 'local' });
      await renderSyncPage(page);
    });
  });
  page.querySelectorAll('[data-conflict-remote]').forEach((button) => {
    button.addEventListener('click', async () => {
      await resolveConflict(Number(button.dataset.conflictRemote), { keep: 'remote' });
      await renderSyncPage(page);
    });
  });

  return () => {};
}

export { getDeviceId };
