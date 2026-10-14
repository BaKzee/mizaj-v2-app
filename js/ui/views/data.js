/** Data & settings: import (with preview), backups, rollback to the legacy app, theme, about. */
import { append, clear, downloadText, h, openSheet, readFileText, toast } from "../dom.js";
import { ENGINE_VERSION } from "../../domain/types.js";
import { PRECISION_CONFIG_V1 } from "../../engine/config.js";
import { errorText, fmtDate, list, pageHead, section } from "./shared.js";
import { countAr, ENTRIES_AR, PRODUCTS_AR, RECIPES_AR, SAFETY_AR } from "../model.js";
import { isSingleFile, legacyHref, readEmbedded } from "../env.js";
const COUNT_AR = { flavors: 'منتجات', recipes: 'وصفات', recipeVersions: 'نسخ وصفات', assessments: 'تقييمات', sessions: 'جلسات', inventoryEvents: 'حركات مخزون', claims: 'معلومات موثّقة/موروثة', sources: 'مصادر', journal: 'إدخالات v2', orphanEdits: 'تعديلات يتيمة' };
const SOURCE_AR = { legacy_device: 'التطبيق القديم على هذا الجهاز', legacy_files: 'ملفات التطبيق القديم', v2_backup: 'نسخة v2 احتياطية' };
function previewSheet(app, p) {
    openSheet('معاينة الاستيراد', (close) => {
        const err = h('p', { class: 'error-text', role: 'alert' });
        const blocking = p.problems.filter((x) => !x.startsWith('إدخال لم يُطبَّق'));
        return [
            h('p', null, `المصدر: ${SOURCE_AR[p.source]} · النتيجة: ${p.outcome === 'ready' ? 'جاهز' : p.outcome === 'needs_review' ? 'جاهز مع بنود للمراجعة' : 'فشل'}`),
            h('ul', { class: 'bullets' }, Object.entries(p.counts).filter(([k]) => COUNT_AR[k]).map(([k, v]) => h('li', null, `${COUNT_AR[k]}: ${v}`))),
            list(p.notes),
            app.hasData ? h('p', { class: 'hint' }, 'سيُستبدل ما استوردته سابقاً من التطبيق القديم. ما أضفته في v2 (نسخ، تجارب، حركات مخزون) يبقى كما هو.') : null,
            blocking.length ? h('div', { class: 'notice' }, h('p', { class: 'error-text' }, 'لن يُستورد شيء بسبب:'), list(blocking.slice(0, 8))) : null,
            p.problems.length > blocking.length ? h('p', { class: 'warn-text' }, `${p.problems.length - blocking.length} إدخال v2 لا ينطبق على هذه البيانات وسيبقى محفوظاً دون تطبيق.`) : null,
            err,
            h('div', { class: 'sheet-actions' }, h('button', { type: 'button', class: 'btn btn-primary', disabled: blocking.length > 0, on: { click: async () => {
                        try {
                            const m = await app.applyImport(p);
                            close();
                            toast(m.added || m.skipped ? `تم الاستيراد · من سجل v2: أُضيف ${countAr(m.added, ENTRIES_AR)}، وكان ${countAr(m.skipped, ENTRIES_AR)} موجوداً أصلاً` : 'تم الاستيراد.');
                            location.hash = '#/';
                        }
                        catch (x) {
                            err.textContent = errorText(x);
                        }
                    } } }, 'استورد'), h('button', { type: 'button', class: 'btn btn-quiet', on: { click: close } }, 'إلغاء')),
        ];
    });
}
export const dataView = (app, root) => {
    const status = h('div', { class: 'status-box', 'aria-live': 'polite' });
    const busy = (on, text = '') => { status.textContent = on ? text : ''; status.classList.toggle('busy', on); };
    const fail = (x) => { busy(false); toast(errorText(x), 'error'); };
    const fileButton = (id, label, accept, onFiles, multiple = false) => {
        const input = h('input', { id, type: 'file', accept, class: 'sr-only', multiple, on: { change: () => { const fs = [...(input.files ?? [])]; input.value = ''; if (fs.length)
                    onFiles(fs); } } });
        return h('span', null, input, h('label', { for: id, class: 'btn btn-quiet file-btn', tabindex: '0', role: 'button', on: { keydown: (e) => { const k = e.key; if (k === 'Enter' || k === ' ') {
                    e.preventDefault();
                    input.click();
                } } } }, label));
    };
    const embedded = readEmbedded();
    const legacyFiles = (() => {
        let html = embedded?.legacyHtml ?? null;
        let backup = null;
        const state = h('p', { class: 'muted small' }, html
            ? 'اختر ملف النسخة الاحتياطية الذي صدّرته من التطبيق القديم (.json). صفحة التطبيق القديم موجودة داخل هذا الملف.'
            : 'اختر الملفين: صفحة التطبيق القديم (index.html) وملف النسخة الاحتياطية (.json).');
        const tryRun = () => {
            state.textContent = `${html ? '✓ صفحة التطبيق القديم' : '— index.html'} · ${backup ? `✓ ${backup.name}` : '— ملف النسخة'}`;
            if (!html || !backup)
                return;
            try {
                busy(true, 'أرحّل البيانات على جهازك…');
                const p = app.previewFromLegacy(html, backup.text, backup.name);
                busy(false);
                previewSheet(app, p);
            }
            catch (x) {
                fail(x);
            }
        };
        return h('div', null, fileButton('pick-legacy', 'اختر الملفات', '.html,.htm,.json,text/html,application/json', async (files) => {
            try {
                for (const f of files) {
                    const t = await readFileText(f);
                    if (/^\s*</.test(t))
                        html = t;
                    else
                        backup = { text: t, name: f.name };
                }
                tryRun();
            }
            catch (x) {
                fail(x);
            }
        }, true), state);
    })();
    const importSection = section('استيراد', h('div', { class: 'import-opt' }, h('h3', { class: 'sub-title' }, 'من التطبيق القديم على هذا الجهاز'), h('p', { class: 'hint' }, isSingleFile()
        ? 'يقرأ أحدث بيانات التطبيق القديم دون أي كتابة فيها، إن كان يعمل في نفس المتصفح. إن لم يجدها، صدّر نسخة من التطبيق القديم واستوردها كملف.'
        : 'يقرأ بياناته دون أي كتابة فيها. يعمل عندما يكون v2 على نفس موقع التطبيق القديم.'), h('button', { type: 'button', class: 'btn btn-primary', id: 'import-device', on: { click: async () => {
                try {
                    busy(true, 'أقرأ التطبيق القديم وأرحّل البيانات على جهازك…');
                    const p = await app.previewFromLegacyDevice();
                    busy(false);
                    previewSheet(app, p);
                }
                catch (x) {
                    fail(x);
                }
            } } }, 'استيراد من الجهاز')), h('div', { class: 'import-opt' }, h('h3', { class: 'sub-title' }, embedded?.legacyHtml ? 'من ملف نسخة التطبيق القديم' : 'من ملفات التطبيق القديم'), legacyFiles), embedded?.backupText && app.hasData ? h('div', { class: 'import-opt' }, h('h3', { class: 'sub-title' }, 'البيانات المضمّنة في هذا الملف'), h('p', { class: 'hint' }, `جُهّزت في ${fmtDate(embedded.preparedAt)}. إعادة تحميلها تستبدل البيانات المستوردة من التطبيق القديم فقط؛ ما أضفته في v2 يبقى.`), h('button', { type: 'button', class: 'btn btn-quiet', id: 'reload-embedded', on: { click: () => { try {
                previewSheet(app, app.previewFromBackup(embedded.backupText));
            }
            catch (x) {
                fail(x);
            } } } }, 'أعد تحميل البيانات المضمّنة')) : null, h('div', { class: 'import-opt' }, h('h3', { class: 'sub-title' }, 'من نسخة v2 احتياطية'), h('p', { class: 'hint' }, 'ملف ‎.mizaj2.jsonl: يستعيد البيانات وما أضفته في v2 وحزمة المعرفة إن وُجدت. لا يُحذف شيء موجود.'), fileButton('pick-backup', 'اختر النسخة', '.jsonl,.mizaj2.jsonl,application/x-ndjson,text/plain', async ([f]) => {
        try {
            busy(true, 'أتحقق من الملف…');
            const p = app.previewFromBackup(await readFileText(f));
            busy(false);
            previewSheet(app, p);
        }
        catch (x) {
            fail(x);
        }
    })), app.hasData ? h('div', { class: 'import-opt' }, h('h3', { class: 'sub-title' }, 'حزمة المعرفة'), h('p', { class: 'hint' }, app.pack ? `مستوردة · ${app.pack.passports.length} جوازاً · ${app.pack.rules.lexicon}` : 'غير مستوردة: الأوصاف من أسماء المنتجات فقط. الملف knowledge-pack.json.'), fileButton('pick-pack', app.pack ? 'استبدل الحزمة' : 'اختر الحزمة', '.json,application/json', async ([f]) => {
        try {
            busy(true, 'أتحقق من الحزمة…');
            await app.importKnowledgePackText(await readFileText(f));
            busy(false);
            toast('استُوردت حزمة المعرفة.');
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        }
        catch (x) {
            fail(x);
        }
    })) : null);
    if (!app.hasData) {
        append(root, pageHead('مرحباً بك في مِزاج v2', 'ابدأ باستيراد بياناتك. التطبيق القديم يبقى كما هو ولا يُكتب فيه شيء.'), status, importSection, section('الرجوع', h('a', { class: 'btn btn-quiet', href: legacyHref() }, 'افتح التطبيق القديم')), h('p', { class: 'safety' }, SAFETY_AR));
        return;
    }
    const b = app.bundle;
    const log = b.migrationLog;
    const native = app.journal.length;
    const theme = app.prefs()['theme'] ?? 'auto';
    const themeSel = h('select', { id: 'theme', class: 'input', on: { change: () => { app.setPref('theme', themeSel.value); applyTheme(themeSel.value); } } }, ...[['auto', 'حسب الجهاز'], ['dark', 'داكن'], ['light', 'فاتح']].map(([v, l]) => h('option', { value: v, selected: v === theme }, l)));
    const flag = h('input', { type: 'checkbox', id: 'flag', class: 'switch', checked: app.v2IsDefault, on: { change: () => { const ok = app.setV2Default(flag.checked); toast(ok ? (flag.checked ? 'v2 هو الواجهة الافتراضية في صفحة البدء.' : 'التطبيق القديم هو الافتراضي.') : 'تعذّر الحفظ في هذا المتصفح.', ok ? 'ok' : 'warn'); } } });
    append(root, pageHead('البيانات والإعدادات'), status, section('حالة البيانات', h('ul', { class: 'bullets' }, h('li', null, `آخر استيراد من التطبيق القديم: ${fmtDate(log.ranAt)} · ${countAr(b.flavors.length, PRODUCTS_AR)} · ${countAr(b.recipes.filter((r) => r.origin !== 'v2_native').length, RECIPES_AR)}`), h('li', null, `ما أضفته في v2: ${countAr(native, ENTRIES_AR)} (نسخ، تجارب، حركات مخزون)`), h('li', null, app.pack ? `حزمة المعرفة: ${app.pack.passports.length} جوازاً` : 'حزمة المعرفة: غير مستوردة'), h('li', null, app.persistent ? 'التخزين: IndexedDB على هذا الجهاز (يعمل بلا اتصال)' : 'تحذير: التخزين الدائم غير متاح؛ البيانات ستضيع عند الإغلاق.'), app.comp?.skipped.length ? h('li', { class: 'warn-text' }, `${countAr(app.comp.skipped.length, ENTRIES_AR)} من v2 لا ينطبق على البيانات الحالية (محفوظ دون تطبيق).`) : null, h('li', { class: 'muted' }, `بناء المحرك ${app.lastBuildMs} ms على هذا الجهاز`))), section('نسخ احتياطي', h('p', { class: 'hint' }, 'النسخة الكاملة تحفظ البيانات المستوردة + ما أضفته في v2 + حزمة المعرفة في ملف واحد خاص. لا ترفعه علناً.'), h('button', { type: 'button', class: 'btn btn-primary', id: 'export-full', on: { click: () => {
                try {
                    downloadText(`mizaj-v2-backup-${new Date().toISOString().slice(0, 10)}.mizaj2.jsonl`, app.exportFullBackup());
                    toast('صُدّرت النسخة.');
                }
                catch (x) {
                    fail(x);
                }
            } } }, 'صدّر نسخة كاملة'), h('p', { class: 'hint' }, 'ملف للتطبيق القديم: بياناته الأصلية كما كانت، مطابقة بايتاً ببايت. ما أضفته في v2 لا يُنقل إليه.'), h('button', { type: 'button', class: 'btn btn-quiet', id: 'export-v1', on: { click: () => {
                try {
                    downloadText(`mizaj-backup-v1-${new Date().toISOString().slice(0, 10)}.json`, app.exportLegacyFile(), 'application/json');
                }
                catch (x) {
                    fail(x);
                }
            } } }, 'صدّر ملفاً للتطبيق القديم')), importSection, section('التطبيق القديم والرجوع', isSingleFile()
        ? h('p', { class: 'hint' }, 'التطبيق القديم ملف مستقل (index.html) تفتحه كما تفعل الآن؛ v2 لا يكتب في بياناته أبداً، فالتنقل بينهما لا يفقد شيئاً.')
        : h('div', { class: 'switch-row' }, flag, h('label', { for: 'flag' }, 'اجعل v2 الواجهة الافتراضية (MIZAJ_CORE_V2)'), h('p', { class: 'hint' }, 'يغيّر ما تفتحه صفحة البدء فقط. لا يكتب في أي قاعدة بيانات، فالتبديل لا يفقد شيئاً.')), h('a', { class: 'btn btn-quiet', href: legacyHref() }, 'افتح التطبيق القديم')), section('المظهر', h('label', { for: 'theme', class: 'field-label' }, 'السمة'), themeSel), section('عن v2', list([
        ['المحرك ', h('bdi', null, ENGINE_VERSION), ' · الإعداد ', h('bdi', null, PRECISION_CONFIG_V1.id), ': نفس الطلب ونفس البيانات يعطيان النتيجة نفسها.'],
        'فهم الطلب بقاموس ثابت على جهازك؛ لا يوجد ذكاء اصطناعي ولا اتصال بخادم.',
        'لا توجد نسب نجاح ولا توصيات حرارة أو فحم.',
    ]), h('p', { class: 'safety' }, SAFETY_AR, ' ', h('a', { href: 'https://extranet.who.int/fctcapps/fctcapps/fctc/kh/wts/waterpipe-overview-0', target: '_blank', rel: 'noopener noreferrer' }, 'منظمة الصحة العالمية'))));
};
export function applyTheme(t) {
    const el = document.documentElement;
    if (t === 'dark' || t === 'light')
        el.setAttribute('data-theme', t);
    else
        el.removeAttribute('data-theme');
}
export { clear };
