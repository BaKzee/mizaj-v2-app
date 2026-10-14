/** Recipes and version history (05_UX "Version history V1/V2/V3 with visual diff"). Evidence never crosses versions. */
import { append, clear, h, setStyle } from "../dom.js";
import { grams, pct, recipeRows, versionTimeline } from "../model.js";
import { allocateMg } from "../../domain/grams.js";
import { DIAGNOSTIC_AR } from "../../storage/journal.js";
import { fmtDate, list, needData, pageHead, safetyNote, section, tierBadge } from "./shared.js";
import { doctorSheet, editorSheet, logSheet } from "./sheets.js";
export const recipesView = (app, root, params) => {
    if (!app.ctx || !app.bundle) {
        needData(root);
        return;
    }
    const rows = recipeRows(app.bundle, app.ctx);
    let filter = params.get('f') ?? 'supported';
    const q = h('input', { id: 'rec-q', type: 'search', class: 'input', placeholder: 'ابحث في الوصفات', autocomplete: 'off' });
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'تصفية الوصفات' });
    const listEl = h('ul', { class: 'rows', 'aria-live': 'polite' });
    const filters = [['supported', 'مدعومة بتقييماتك'], ['mine', 'وصفاتي'], ['v2', 'من v2'], ['all', 'الكل']];
    const draw = () => {
        clear(chips);
        for (const [k, l] of filters)
            chips.append(h('button', { type: 'button', class: `chip${filter === k ? ' chip-on' : ''}`, 'aria-pressed': String(filter === k), on: { click: () => { filter = k; draw(); } } }, l));
        clear(listEl);
        const s = q.value.trim().toLowerCase();
        const xs = rows.filter((r) => (!s || r.name.toLowerCase().includes(s) || r.headIngredients.toLowerCase().includes(s))
            && (filter !== 'supported' || (r.support > 0 && r.support >= r.caution))
            && (filter !== 'mine' || r.mine) && (filter !== 'v2' || r.origin === 'v2_native'));
        for (const r of xs) {
            listEl.append(h('li', null, h('a', { class: 'row', href: `#/recipe/${encodeURIComponent(r.recipeId)}` }, h('span', { class: 'row-main' }, h('bdi', null, r.name)), h('span', { class: 'row-sub' }, tierBadge(r.tier, r.attribution), r.support ? ` · ${r.support} تقييم مرتفع` : '', r.caution ? ` · ${r.caution} منخفض` : '', r.versions > 1 ? ` · ${r.versions} نسخ` : ''), h('span', { class: 'row-sub muted' }, r.headIngredients))));
        }
        if (!xs.length)
            listEl.append(h('li', { class: 'muted' }, filter === 'v2' ? 'لم تحفظ وصفات في v2 بعد.' : 'لا نتائج'));
    };
    q.addEventListener('input', draw);
    append(root, pageHead('وصفاتي', 'كل وصفة بنسخها؛ التقييمات تتبع النسخة بالضبط.'), h('label', { for: 'rec-q', class: 'sr-only' }, 'بحث'), q, chips, listEl);
    draw();
};
export const recipeView = (app, root, _params, path) => {
    if (!app.ctx || !app.bundle) {
        needData(root);
        return;
    }
    const id = decodeURIComponent(path[1] ?? '');
    const r = app.bundle.recipes.find((x) => x.recipeId === id);
    if (!r) {
        append(root, pageHead('وصفة غير موجودة', undefined, { href: '#/recipes', label: 'وصفاتي' }));
        return;
    }
    const tl = versionTimeline(app.bundle, id, app.ctx);
    const gramsTotal = app.bundle.settings.defaultGramsTotalMg;
    const notes = app.bundle.assessments.filter((a) => a.recipeId === id && a.provenance === 'user_observation');
    const mgOf = (ings, fid) => allocateMg(ings, gramsTotal).find((a) => a.flavorId === fid)?.mg ?? 0;
    const node = (v) => h('article', { class: `version${v.isHead ? ' version-head' : ''}`, 'aria-labelledby': `v-${v.label}` }, h('div', { class: 'version-top' }, h('h2', { class: 'version-label', id: `v-${v.label}` }, v.label), v.isHead ? h('span', { class: 'badge badge-ok' }, 'الحالية') : null, h('span', { class: 'muted small' }, `${v.originAr} · ${fmtDate(v.createdAt)}`, v.parentLabel ? ` · من ${v.parentLabel}` : '')), h('ul', { class: 'bars' }, v.ingredients.map((i) => {
        const bar = h('span', { class: 'bar-fill', 'aria-hidden': 'true' });
        setStyle(bar, 'inline-size', `${i.basisPoints / 100}%`);
        return h('li', null, h('span', { class: 'bar-name' }, h('a', { href: `#/product/${encodeURIComponent(i.flavorId)}` }, h('bdi', null, i.name))), h('span', { class: 'bar-track' }, bar), h('span', { class: 'bar-pct' }, `${pct(i.basisPoints)} · ${grams(mgOf(v.ingredients, i.flavorId))}`));
    })), v.structural !== 'valid' ? h('p', { class: 'warn-text' }, 'هذه النسخة القديمة غير صالحة بنيوياً (محفوظة كما هي للتدقيق).') : null, v.diff.length ? h('div', { class: 'diff' }, h('h3', { class: 'sub-title' }, `ما تغيّر عن ${v.parentLabel}`), h('ul', { class: 'diff-list' }, v.diff.map((d) => h('li', { class: `diff-${d.kind}` }, h('bdi', null, d.name), ': ', d.text)))) : null, h('p', { class: 'small' }, tierBadge(v.evidence.tier, v.evidence.attribution)), h('p', { class: 'small muted' }, `سجلات هذه النسخة وحدها: ${v.evidence.verified} مؤكّدة · ${v.evidence.probable} مرجّحة · ${v.evidence.ambiguous} غير محسومة`, v.evidence.ratings.length ? ` · التقييمات: ${v.evidence.ratings.join('، ')}` : ''), h('div', { class: 'card-actions' }, h('button', { type: 'button', class: 'btn btn-quiet', on: { click: () => doctorSheet(app, `${r.name} ${v.label}`, v.ingredients, gramsTotal) } }, 'افحص'), v.structural === 'valid' ? h('button', { type: 'button', class: 'btn btn-quiet', on: { click: () => logSheet(app, r.recipeId, v.versionId, `${r.name} ${v.label}`) } }, 'سجّل تجربة') : null, v.structural === 'valid' ? h('button', { type: 'button', class: 'btn btn-quiet', on: { click: () => editorSheet(app, r.recipeId, v.versionId, v.label) } }, 'عدّل كنسخة جديدة') : null));
    const head = tl.find((v) => v.isHead);
    append(root, pageHead(r.name, `النسخة الحالية ${head.label} من ${tl.length} · الأوزان لكمية ${grams(gramsTotal)}`, { href: '#/recipes', label: 'وصفاتي' }), h('p', { class: 'muted small' }, r.origin === 'legacy_bundled' ? 'من كتاب التطبيق القديم.' : r.origin === 'user_created' ? 'وصفتك في التطبيق القديم.' : 'أنشأتَها في v2.'), h('div', { class: 'versions' }, [...tl].reverse().map(node)), notes.length ? section('ملاحظاتك في v2', list(notes.map((a) => {
        const v = tl.find((x) => x.versionId === a.recipeVersionId);
        return `${v?.label ?? '?'} · ${a.rating !== null ? `${a.rating}/5` : 'بلا تقييم'}${a.descriptors.length ? ` · ${a.descriptors.map((d) => DIAGNOSTIC_AR[d] ?? d).join('، ')}` : ''}${a.note ? ` — ${a.note}` : ''} · ${fmtDate(a.recordedAt)}`;
    }))) : null, safetyNote());
};
