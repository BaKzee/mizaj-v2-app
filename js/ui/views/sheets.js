/** Bottom sheets shared by the results and recipe screens. */
import { append, clear, h, openSheet, toast } from "../dom.js";
import { doctor } from "../../engine/doctor.js";
import { explainIngredient, substitute, substituteOptions, SUBSTITUTE_KIND_AR } from "../../engine/assist.js";
import { reapportion, termAr } from "../../engine/generate.js";
import { allocateMg } from "../../domain/grams.js";
import { pctToBpExact, TOTAL_BP } from "../../domain/basisPoints.js";
import { DIAGNOSTIC_AR, DIAGNOSTIC_CODES, NAME_MAX, NOTE_MAX } from "../../storage/journal.js";
import { compareCandidates, grams, pct } from "../model.js";
import { recordObservation, refusalAr, saveAsNewRecipe, saveAsNewVersion } from "../actions.js";
import { decisionBadge, formulaTable, list, tierBadge } from "./shared.js";
import { attributionAr } from "../model.js";
/* ------------------------------ why this ingredient ------------------------------ */
export function whySheet(app, ings, flavorId, opts = {}) {
    const e = explainIngredient(app.ctx, ings, flavorId, { ...opts, notes: app.productNotes });
    openSheet(`لماذا ${e.name}؟`, () => [
        h('p', null, h('bdi', null, e.name), ' · ', h('bdi', null, e.brand), ' · ', pct(e.basisPoints)),
        e.covers.length ? h('p', null, 'يغطي من طلبك: ', e.covers.join('، ')) : h('p', { class: 'muted' }, 'لا يغطي كلمة من طلبك مباشرة؛ اختير لأنه جزء من الصيغة المرجعية.'),
        e.inReference ? h('p', null, 'في الوصفة المرجعية «', h('bdi', null, e.inReference.name), `» بنسبة ${pct(e.inReference.basisPoints)}.`) : null,
        h('h3', { class: 'sub-title' }, 'ما نعرفه عن وصفه'),
        e.descriptors.length
            ? h('ul', { class: 'bullets' }, e.descriptors.map((d) => h('li', null, d.ar, h('span', { class: `prov prov-${d.provenance}` }, d.provenanceAr), d.personalAr ? h('span', { class: 'muted small' }, ` · ${d.personalAr}`) : null)))
            : h('p', { class: 'muted' }, 'لا كلمات وصف معروفة.'),
        e.ownerLinked.length ? h('p', null, 'قلتَ إنه المنتج نفسه مثل: ', e.ownerLinked.join('، ')) : null,
        e.sharedWith.length ? h('div', null, h('h3', { class: 'sub-title' }, 'يشترك مع'), list(e.sharedWith.map((s) => [h('bdi', null, s.name), `: ${s.terms.join('، ')} — تكرار محتمل، ليس حكماً على الطعم.`]))) : null,
        h('h3', { class: 'sub-title' }, 'ما لا نعرفه'), list(e.unknowns),
    ]);
}
/* ------------------------------ Recipe Doctor panel ------------------------------ */
export function doctorPanel(rep) {
    return h('div', { class: 'doctor' }, h('p', null, decisionBadge(rep.decision), ' ', rep.structural === 'pass' ? 'البنية سليمة (100%، بلا تكرار).' : `البنية غير صالحة: ${rep.errors.join('، ')}`), rep.stock === 'fail' ? h('p', { class: 'warn-text' }, 'المخزون لا يكفي للكمية المطلوبة.') : null, h('p', null, tierBadge(rep.evidence.tier, rep.evidence.exactMatch ? `مطابقة لـ«${rep.evidence.exactMatch.name}»` : 'لا سجل مطابق')), h('p', { class: 'muted' }, rep.evidence.summaryAr), rep.similarSupported.length ? h('div', null, h('h3', { class: 'sub-title' }, 'صيغ مسجّلة مشابهة'), list(rep.similarSupported.slice(0, 3).map((s) => [h('bdi', null, s.name), ` (${s.tier}) · تشابه المكوّنات ${Math.round(s.jaccard * 100)}%`]))) : null, rep.warnings.length ? h('div', null, h('h3', { class: 'sub-title' }, 'تنبيهات (ليست منعاً)'), list(rep.warnings.map((w) => w.textAr))) : null, rep.legacyRuleNotes.length ? h('div', null, h('h3', { class: 'sub-title' }, 'قواعد التطبيق القديم'), list(rep.legacyRuleNotes.map((n) => n.textAr))) : null, rep.simplifications.length ? h('div', null, h('h3', { class: 'sub-title' }, 'تبسيط ممكن'), list(rep.simplifications.slice(0, 3).map((s) => `بدون ${s.removed}${s.lostDescriptors.length ? ` (قد يضيع: ${s.lostDescriptors.join('، ')})` : ''}`))) : null, rep.unknowns.length ? h('div', null, h('h3', { class: 'sub-title' }, 'ما لا نعرفه'), list(rep.unknowns)) : null);
}
export function doctorSheet(app, title, ings, gramsTotalMg) {
    const rep = doctor(ings, app.ctx, { gramsTotalMg, stockOnly: false });
    openSheet(`فحص: ${title}`, () => [formulaTable(rep.ingredients, { caption: 'الصيغة المفحوصة' }), doctorPanel(rep)]);
}
/* ------------------------------ save as a new recipe ------------------------------ */
export function saveSheet(app, c, gramsTotalMg) {
    openSheet('احفظ كوصفة جديدة', (close) => {
        const name = h('input', { id: 'save-name', type: 'text', class: 'input', maxlength: String(NAME_MAX), value: c.name, required: true, autocomplete: 'off' });
        const err = h('p', { class: 'error-text', role: 'alert' });
        return [
            h('label', { for: 'save-name', class: 'field-label' }, 'الاسم'), name,
            formulaTable(c.ingredients.map((i, k) => ({ flavorId: i.flavorId, name: app.ctx.products.get(i.flavorId)?.name ?? i.flavorId, basisPoints: i.basisPoints, mg: allocateMg(c.ingredients, gramsTotalMg)[k].mg })), { caption: 'الصيغة التي ستُحفظ' }),
            h('p', { class: 'hint' }, 'تُحفظ نسخة جديدة ثابتة لا تتغيّر، ولا ترث أي تقييم من المرجع. ', c.origin === 'hypothesis' ? 'موسومة «فرضية غير مجرّبة».' : 'موسومة «تعديل غير مجرّب».'),
            err,
            h('div', { class: 'sheet-actions' }, h('button', { type: 'button', class: 'btn btn-primary', on: { click: async () => {
                        try {
                            const e = await saveAsNewRecipe(app, { ...c, name: name.value });
                            close();
                            toast('حُفظت الوصفة.');
                            if (e.kind === 'recipe_created')
                                location.hash = `#/recipe/${encodeURIComponent(e.recipe.recipeId)}`;
                        }
                        catch (x) {
                            err.textContent = refusalAr(x);
                        }
                    } } }, 'احفظ'), h('button', { type: 'button', class: 'btn btn-quiet', on: { click: close } }, 'إلغاء')),
        ];
    });
}
/* ------------------------------ replace an ingredient ------------------------------ */
export function replaceSheet(app, c, gramsTotalMg, stockOnly) {
    const ctx = app.ctx;
    openSheet('استبدل مكوّناً', (close) => {
        const host = h('div');
        const pickIngredient = () => {
            clear(host);
            append(host, h('p', null, 'أي مكوّن تريد استبداله؟'), h('div', { class: 'pick-list' }, c.ingredients.map((i) => h('button', { type: 'button', class: 'pick', on: { click: () => pickOption(i.flavorId) } }, h('bdi', null, ctx.products.get(i.flavorId)?.name ?? i.flavorId), ` · ${pct(i.basisPoints)}`))));
        };
        const pickOption = (from) => {
            clear(host);
            const opts = substituteOptions(ctx, c.ingredients, from, { gramsTotalMg });
            const groups = ['same_product', 'documented_close', 'exploratory'];
            append(host, h('p', null, 'بدائل لـ«', h('bdi', null, ctx.products.get(from)?.name ?? from), '» بالترتيب: المنتج نفسه، ثم نصّ منشور مشابه، ثم تقريبي.'), opts.length ? groups.map((k) => {
                const xs = opts.filter((o) => o.kind === k);
                return xs.length ? h('div', null, h('h3', { class: 'sub-title' }, SUBSTITUTE_KIND_AR[k]), h('div', { class: 'pick-list' }, xs.map((o) => h('button', { type: 'button', class: `pick${o.enoughStock ? '' : ' pick-short'}`, on: { click: () => preview(from, o.flavorId) } }, h('span', { class: 'pick-main' }, h('bdi', null, o.name), h('span', { class: 'brand' }, ` · ${o.brand}`)), h('span', { class: 'pick-sub' }, o.basisAr, ' ', o.enoughStock ? `· متوفر ${grams(o.haveMg)}` : `· الرصيد ${grams(o.haveMg)} أقل من ${grams(o.needMg)}`))))) : null;
            }) : h('p', { class: 'muted' }, 'لا يوجد بديل موثّق أو تقريبي في مكتبتك لهذا المكوّن.'), h('button', { type: 'button', class: 'btn btn-quiet', on: { click: pickIngredient } }, 'مكوّن آخر'));
        };
        const preview = (from, to) => {
            clear(host);
            const next = substitute(c.ingredients, from, to);
            const rep = doctor(next, ctx, { gramsTotalMg, stockOnly });
            append(host, h('p', null, h('bdi', null, ctx.products.get(from)?.name ?? from), ' ← ', h('bdi', null, ctx.products.get(to)?.name ?? to), ` (${pct(c.ingredients.find((i) => i.flavorId === from).basisPoints)})`), formulaTable(rep.ingredients, { caption: 'الصيغة بعد الاستبدال' }), h('p', { class: 'hint' }, 'أُعيد فحص الصيغة كاملة. لا تُنسخ تقييمات الصيغة القديمة إلى الجديدة.'), doctorPanel(rep), h('div', { class: 'sheet-actions' }, h('button', { type: 'button', class: 'btn btn-primary', disabled: rep.decision === 'invalid', on: { click: () => { close(); saveSheet(app, { name: `${c.name} — استبدال`, ingredients: next, origin: 'derived', lineage: c.lineage, referenceIds: c.referenceIds, explanation: `استبدال ${from} بـ ${to}` }, gramsTotalMg); } } }, 'احفظ كوصفة جديدة'), h('button', { type: 'button', class: 'btn btn-quiet', on: { click: () => pickOption(from) } }, 'بديل آخر')));
        };
        pickIngredient();
        return host;
    });
}
/* ------------------------------ compare ------------------------------ */
export function compareSheet(app, a, b) {
    const rows = compareCandidates(a, b, app.ctx);
    openSheet('مقارنة', () => h('table', { class: 'compare' }, h('caption', { class: 'sr-only' }, 'مقارنة اقتراحين'), h('thead', null, h('tr', null, h('th', { scope: 'col' }, ''), h('th', { scope: 'col' }, h('bdi', null, a.name)), h('th', { scope: 'col' }, h('bdi', null, b.name)))), h('tbody', null, rows.map((r) => h('tr', { class: r.same ? 'same' : '' }, h('th', { scope: 'row' }, h('bdi', null, r.label)), h('td', null, r.a), h('td', null, r.b))))), { wide: true });
}
/* ------------------------------ log an experience (optional rating) ------------------------------ */
/** `init` pre-fills a session planned elsewhere (e.g. «أنهِ العلبة»): the exact milligrams, stock deduction switched on and an editable note. */
export function logSheet(app, recipeId, versionId, label, init) {
    const v = app.bundle.recipeVersions.find((x) => x.versionId === versionId);
    openSheet(`سجّل تجربة: ${label}`, (close) => {
        let rating = null;
        let diag = null;
        const ratingRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'تقييمك (اختياري)' });
        const diagBox = h('div');
        const note = h('textarea', { id: 'log-note', class: 'input', rows: '2', maxlength: String(NOTE_MAX), placeholder: 'ملاحظة (اختيارية)' });
        if (init)
            note.value = init.note;
        const deduct = h('input', { type: 'checkbox', id: 'log-deduct', class: 'switch' });
        const gramsIn = h('input', { id: 'log-grams', type: 'number', class: 'input input-num', inputmode: 'decimal', min: '1', max: '200', step: '0.1', value: String((init?.totalMg ?? app.bundle.settings.defaultGramsTotalMg) / 1000) });
        const lines = h('ul', { class: 'bullets small' });
        const err = h('p', { class: 'error-text', role: 'alert' });
        const showLines = () => {
            clear(lines);
            const mg = Math.round(Number(gramsIn.value) * 1000);
            if (!deduct.checked || !Number.isSafeInteger(mg) || mg <= 0)
                return;
            for (const a of allocateMg(v.ingredients, mg))
                lines.append(h('li', null, h('bdi', null, app.ctx.products.get(a.flavorId)?.name ?? a.flavorId), ` − ${grams(a.mg)}`));
        };
        const renderRating = () => {
            clear(ratingRow);
            const opts = [[null, 'بدون تقييم'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']];
            for (const [val, l] of opts)
                ratingRow.append(h('button', { type: 'button', class: `chip${rating === val ? ' chip-on' : ''}`, 'aria-pressed': String(rating === val), on: { click: () => { rating = val; renderRating(); } } }, l));
            clear(diagBox);
            if (rating !== null && rating <= 2) {
                diagBox.append(h('p', { class: 'field-label' }, 'ما المشكلة؟ (اختياري، اختيار واحد)'), h('div', { class: 'chips', role: 'group', 'aria-label': 'وصف سريع للمشكلة' }, DIAGNOSTIC_CODES.map((d) => h('button', { type: 'button', class: `chip${diag === d ? ' chip-on' : ''}`, 'aria-pressed': String(diag === d), on: { click: () => { diag = diag === d ? null : d; renderRating(); } } }, DIAGNOSTIC_AR[d]))));
            }
            else
                diag = null;
        };
        renderRating();
        if (init) {
            deduct.checked = true;
            showLines();
        }
        deduct.addEventListener('change', showLines);
        gramsIn.addEventListener('input', showLines);
        return [
            h('p', { class: 'hint' }, 'يُربط هذا السجل بهذه النسخة بالضبط ولا ينتقل لأي نسخة أخرى. التقييم اختياري.'),
            h('p', { class: 'field-label' }, 'تقييمك (اختياري)'), ratingRow, diagBox,
            h('label', { for: 'log-note', class: 'field-label' }, 'ملاحظة'), note,
            h('div', { class: 'switch-row' }, deduct, h('label', { for: 'log-deduct' }, 'اخصم الكمية من المخزون')),
            h('div', { class: 'field' }, h('label', { for: 'log-grams', class: 'field-label' }, 'الكمية (غ)'), gramsIn), lines,
            err,
            h('div', { class: 'sheet-actions' }, h('button', { type: 'button', class: 'btn btn-primary', on: { click: async () => {
                        try {
                            const mg = Math.round(Number(gramsIn.value) * 1000);
                            if (deduct.checked && (!Number.isSafeInteger(mg) || mg <= 0))
                                throw new Error('أدخل كمية صحيحة.');
                            await recordObservation(app, { recipeId, versionId, rating, diagnostic: diag, note: note.value, deductMg: deduct.checked ? mg : null });
                            close();
                            toast('سُجّلت التجربة على هذه النسخة.');
                            window.dispatchEvent(new HashChangeEvent('hashchange'));
                        }
                        catch (x) {
                            err.textContent = refusalAr(x);
                        }
                    } } }, 'سجّل'), h('button', { type: 'button', class: 'btn btn-quiet', on: { click: close } }, 'إلغاء')),
        ];
    });
}
/* ------------------------------ edit proportions → new version ------------------------------ */
export function editorSheet(app, recipeId, versionId, label) {
    const ctx = app.ctx;
    const v = app.bundle.recipeVersions.find((x) => x.versionId === versionId);
    let rows = v.ingredients.map((i) => ({ ...i }));
    openSheet(`عدّل ${label} كنسخة جديدة`, (close) => {
        const host = h('div');
        const report = h('div', { 'aria-live': 'polite' });
        const err = h('p', { class: 'error-text', role: 'alert' });
        const total = () => rows.reduce((s, i) => s + i.basisPoints, 0);
        const draw = () => {
            clear(host);
            const table = h('div', { class: 'editor' }, rows.map((r, k) => {
                const id = `ed-${k}`;
                const inp = h('input', { id, type: 'number', class: 'input input-num', inputmode: 'decimal', min: '0.01', max: '100', step: '0.5', value: String(r.basisPoints / 100) });
                inp.addEventListener('change', () => {
                    const res = pctToBpExact(inp.value.trim() === "" ? NaN : Number(inp.value));
                    if (res.ok && res.bp > 0)
                        rows[k] = { ...r, basisPoints: res.bp };
                    else
                        inp.value = String(r.basisPoints / 100);
                    draw();
                });
                return h('div', { class: 'editor-row' }, h('label', { for: id }, h('bdi', null, ctx.products.get(r.flavorId)?.name ?? r.flavorId)), inp, h('span', { 'aria-hidden': 'true' }, '%'), h('button', { type: 'button', class: 'icon-btn', 'aria-label': `احذف ${ctx.products.get(r.flavorId)?.name ?? r.flavorId}`, disabled: rows.length <= 1, on: { click: () => { rows = rows.filter((_, j) => j !== k); draw(); } } }, '✕'));
            }));
            const sum = total();
            const add = h('input', { type: 'search', class: 'input', placeholder: 'أضف منتجاً', 'aria-label': 'أضف منتجاً', autocomplete: 'off' });
            const hits = h('div', { class: 'pick-list' });
            add.addEventListener('input', () => {
                clear(hits);
                const q = add.value.trim().toLowerCase();
                if (!q)
                    return;
                for (const p of [...ctx.products.values()].filter((p) => !rows.some((r) => r.flavorId === p.id) && (p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q))).slice(0, 6)) {
                    hits.append(h('button', { type: 'button', class: 'pick', on: { click: () => { rows = [...rows, { flavorId: p.id, basisPoints: 500 }]; draw(); } } }, h('bdi', null, p.name), ` · ${p.brand}`));
                }
            });
            append(host, table, h('p', { class: sum === TOTAL_BP ? 'ok-text' : 'warn-text' }, `المجموع: ${pct(sum)}`, sum === TOTAL_BP ? ' ✓' : ' — يجب أن يكون 100%'), sum !== TOTAL_BP ? h('button', { type: 'button', class: 'btn btn-quiet', on: { click: () => { rows = reapportion(rows); draw(); } } }, 'وزّع بالتناسب إلى 100%') : null, add, hits);
            clear(report);
            if (sum === TOTAL_BP)
                report.append(doctorPanel(doctor(rows, ctx, { gramsTotalMg: app.bundle.settings.defaultGramsTotalMg })));
        };
        draw();
        return [
            h('p', { class: 'hint' }, 'التعديل يُنشئ نسخة جديدة؛ النسخة الحالية وسجلاتها تبقى كما هي.'),
            host, report, err,
            h('div', { class: 'sheet-actions' }, h('button', { type: 'button', class: 'btn btn-primary', on: { click: async () => {
                        try {
                            if (total() !== TOTAL_BP)
                                throw new Error('المجموع يجب أن يكون 100%.');
                            await saveAsNewVersion(app, { recipeId, parentVersionId: versionId, ingredients: rows, explanation: 'تعديل يدوي للنسب' });
                            close();
                            toast('حُفظت نسخة جديدة.');
                            window.dispatchEvent(new HashChangeEvent('hashchange'));
                        }
                        catch (x) {
                            err.textContent = refusalAr(x);
                        }
                    } } }, 'احفظ نسخة جديدة'), h('button', { type: 'button', class: 'btn btn-quiet', on: { click: close } }, 'إلغاء')),
        ];
    }, { wide: true });
}
export { attributionAr, termAr };
