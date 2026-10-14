/** Candidate cards (05_UX "Candidate card (mandatory)"). No stars, no success rates. */
import { append, h, icon, announce } from "../dom.js";
import { generate, termAr } from "../../engine/generate.js";
import { attributionAr, countAr, NOT_PROBABILITY_AR, requestSummaryAr, SUGGESTIONS_AR, wizardToRequest } from "../model.js";
import { decisionBadge, emptyState, formulaTable, list, needData, pageHead, safetyNote, tierBadge } from "./shared.js";
import { compareSheet, logSheet, replaceSheet, saveSheet, whySheet } from "./sheets.js";
const SLOT_AR = {
    reference_like: 'الأقرب لمرجع', alternative_architecture: 'بنية بديلة', more_original: 'أكثر جِدّة',
};
export const resultsView = (app, root) => {
    if (!app.ctx || !app.bundle) {
        needData(root);
        return;
    }
    const last = app.last;
    if (!last) {
        append(root, pageHead('الاقتراحات'), emptyState('لم تطلب اقتراحات بعد.', { href: '#/create?new=1', label: 'ولّد مكس' }));
        return;
    }
    const { response: res, parsed } = last;
    const r = parsed.request;
    const selected = new Set();
    const rerun = (patch) => {
        const ws = { ...last.wizard, ...patch };
        const p = wizardToRequest(ws, app.ctx);
        app.last = { wizard: ws, parsed: p, response: generate(p.request, app.ctx), at: app.now() };
        window.dispatchEvent(new HashChangeEvent('hashchange'));
    };
    append(root, pageHead('الاقتراحات', requestSummaryAr(r, app.ctx), { href: '#/create', label: 'عدّل الطلب' }), parsed.understood.length || parsed.ignored.length
        ? h('div', { class: 'interp' }, parsed.understood.length ? h('p', null, 'فهمتُ: ', parsed.understood.map((u, i) => [i ? '، ' : '', h('bdi', null, `«${u.text}»`), ` → ${u.meaning}`])) : null, parsed.ignored.length ? h('p', { class: 'warn-text' }, 'لم أفهم: ', parsed.ignored.join('، '), ' — لم أخمّن معناها.') : null)
        : null, h('p', { class: 'muted small' }, NOT_PROBABILITY_AR));
    // Typed text with not one understood word, and nothing chosen in the wizard: never answer with
    // general suggestions as if the request had been understood.
    const w = last.wizard;
    if (parsed.ignored.length && !parsed.understood.length && !w.goals.length && w.cooling === null && !w.sweetWanted && !w.excludedIds.length) {
        append(root, h('div', { class: 'notice', role: 'status' }, h('h2', { class: 'section-title' }, 'لم أفهم طلبك'), h('p', null, 'لم أجد في النص كلمة أعرفها، فلم أقترح شيئاً. جرّب كلمات مثل «مانجو» أو «بارد» أو «بدون نعناع»، أو استخدم الخطوات الثلاث.'), h('div', { class: 'sheet-actions' }, h('a', { class: 'btn btn-primary', href: '#/create?new=1' }, 'الخطوات الثلاث'), h('a', { class: 'btn btn-quiet', href: '#/' }, 'رجوع'))));
        announce('لم أفهم الطلب');
        return;
    }
    if (res.status !== 'ok') {
        append(root, h('div', { class: 'notice', role: 'status' }, h('h2', { class: 'section-title' }, res.status === 'insufficient_evidence' ? 'لا توجد أدلة كافية' : 'الطلب غير صالح'), list(res.messages), h('div', { class: 'sheet-actions' }, r.mode !== 'DISCOVERY' && res.status === 'insufficient_evidence' ? h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => rerun({ mode: 'DISCOVERY', novel: true }) } }, 'اسمح بفرضية غير مجرّبة') : null, r.stockOnly ? h('button', { type: 'button', class: 'btn btn-quiet', on: { click: () => rerun({ stockOnly: false }) } }, 'ابحث خارج مخزوني') : null, h('a', { class: 'btn btn-quiet', href: '#/create' }, 'عدّل الطلب'))));
        announce(res.status === 'insufficient_evidence' ? 'لا توجد أدلة كافية لهذا الطلب' : 'الطلب غير صالح');
        append(root, safetyNote());
        return;
    }
    const compareBtn = h('button', { type: 'button', class: 'btn btn-quiet', disabled: true, on: { click: () => {
                const [a, b] = [...selected];
                compareSheet(app, res.candidates[a], res.candidates[b]);
            } } }, icon('compare'), 'قارن المحدّدين');
    const card = (c, idx) => {
        const lineage = [c.recipeVersionId, c.parentVersionId];
        const existing = app.bundle.recipeVersions.find((v) => v.versionId === c.recipeVersionId);
        const stockLine = c.validation.stock === 'pass' ? h('p', { class: 'ok-text' }, icon('check'), 'متوفر في مخزونك بالكميات المحسوبة.')
            : c.warnings.some((w) => w.code === 'stock_shortage') ? h('p', { class: 'warn-text' }, icon('warn'), 'بعض المكوّنات لا يكفي رصيدها (التفاصيل في التنبيهات).')
                : h('p', { class: 'muted' }, 'لم يُطلب فحص المخزون.');
        const sel = h('input', { type: 'checkbox', id: `cmp-${idx}`, class: 'check', on: { change: (e) => {
                    if (e.target.checked)
                        selected.add(idx);
                    else
                        selected.delete(idx);
                    if (selected.size > 2) {
                        selected.delete(idx);
                        e.target.checked = false;
                    }
                    compareBtn.disabled = selected.size !== 2;
                } } });
        return h('article', { class: `card card-${c.decision}`, 'aria-labelledby': `cand-${idx}` }, h('div', { class: 'card-top' }, decisionBadge(c.decision), h('span', { class: 'slot' }, SLOT_AR[c.slot])), h('h2', { class: 'card-title', id: `cand-${idx}` }, h('bdi', null, c.name)), h('p', { class: 'card-evidence' }, tierBadge(c.evidence.tier, attributionAr(c.evidence.attribution))), h('p', { class: 'muted' }, c.evidence.summaryAr), formulaTable(c.ingredients, { caption: `مكوّنات ${c.name}`, onWhy: (id) => whySheet(app, c.ingredients, id, { targets: res.interpreted.targets, referenceIds: c.referenceIds }) }), h('p', { class: 'hint' }, 'اضغط اسم المكوّن لمعرفة سبب اختياره.'), stockLine, c.diff && c.diff.length ? h('div', null, h('h3', { class: 'sub-title' }, 'التغيير عن المرجع'), list(c.diff.map((d) => [h('bdi', null, app.ctx.products.get(d.flavorId)?.name ?? d.flavorId), d.kind === 'removed' ? ' حُذف' : d.kind === 'added' ? ' أُضيف' : ` ${d.fromBp / 100}% ← ${d.toBp / 100}%`]))) : null, h('h3', { class: 'sub-title' }, 'لماذا اختيرت'), list(c.rationale), c.targetMatch.missing.length ? h('p', { class: 'warn-text' }, 'لا يغطي: ', c.targetMatch.missing.map(termAr).join('، ')) : null, c.warnings.length ? h('div', null, h('h3', { class: 'sub-title' }, 'تنبيهات (ليست منعاً)'), list(c.warnings.map((w) => w.textAr))) : null, h('h3', { class: 'sub-title' }, 'ما الذي لا نعرفه'), list(c.unknowns), c.simplerVariant ? h('p', { class: 'muted' }, 'أبسط: بدون ', h('bdi', null, app.ctx.products.get(c.simplerVariant.removed)?.name ?? c.simplerVariant.removed), c.simplerVariant.lostDescriptors.length ? ` (قد يضيع: ${c.simplerVariant.lostDescriptors.join('، ')})` : '') : null, h('p', { class: 'muted small' }, c.robustness === 'stable' ? 'ترتيبه لا يتغيّر عند تحريك معايير الترتيب ±25%.' : 'ترتيبه يتغيّر عند تحريك معايير الترتيب؛ قارن بالبدائل.'), c.references.some((x) => x.url) ? h('p', { class: 'small' }, 'المصدر: ', c.references.filter((x) => x.url).map((x) => h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, x.name))) : null, h('div', { class: 'card-actions' }, h('span', { class: 'check-wrap' }, sel, h('label', { for: `cmp-${idx}` }, 'للمقارنة')), h('button', { type: 'button', class: 'btn btn-quiet', on: { click: () => replaceSheet(app, { name: c.name, ingredients: c.ingredients.map((i) => ({ flavorId: i.flavorId, basisPoints: i.basisPoints })), lineage, referenceIds: c.referenceIds }, r.gramsTotalMg, r.stockOnly) } }, icon('swap'), 'استبدل'), existing
            ? [h('a', { class: 'btn btn-quiet', href: `#/recipe/${encodeURIComponent(existing.recipeId)}` }, 'افتح الوصفة'),
                h('button', { type: 'button', class: 'btn btn-quiet', on: { click: () => logSheet(app, existing.recipeId, existing.versionId, c.name) } }, 'سجّل تجربة')]
            : h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => saveSheet(app, { name: c.decision === 'exploratory' ? `فرضية: ${res.interpreted.targets.map(termAr).join(' و') || c.name}` : `${c.name} — معدّلة`, ingredients: c.ingredients.map((i) => ({ flavorId: i.flavorId, basisPoints: i.basisPoints })), origin: c.decision === 'exploratory' ? 'hypothesis' : 'derived', lineage, referenceIds: c.referenceIds, explanation: c.rationale.join(' ') }, r.gramsTotalMg) } }, icon('save'), 'احفظ نسخة جديدة')));
    };
    append(root, h('div', { class: 'cards' }, res.candidates.map(card)));
    if (res.candidates.length >= 2)
        append(root, h('div', { class: 'compare-bar' }, compareBtn, h('span', { class: 'hint' }, 'اختر اقتراحين للمقارنة.')));
    announce(countAr(res.candidates.length, SUGGESTIONS_AR));
    append(root, safetyNote());
};
