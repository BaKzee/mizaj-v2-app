/** Library + product passport (05_UX "Product pages"): every fact with its source; unknown stays unknown. */
import { append, clear, h } from "../dom.js";
import { components, termAr } from "../../engine/generate.js";
import { PROVENANCE_AR } from "../../engine/assist.js";
import { countAr, grams, inventoryRows, PRODUCTS_AR, RECIPES_AR } from "../model.js";
import { descriptorRow, NOTE_CAPTION_AR } from "./questions.js";
import { list, needData, pageHead, section, safetyNote } from "./shared.js";
const AUDIT_AR = { verified: 'نص المصنّع راجعتَه', unverified: 'غير موثّق', disputed: 'هوية متنازع عليها', unknown: 'بلا بحث' };
const FIELD_AR = {
    official_source_url: 'رابط رسمي للمنتج', product_line: 'خط الإنتاج', preblend_status: 'هل هو خليط جاهز',
    measured_intensity: 'شدّة مقاسة', sourced_sensory_descriptors: 'كلمات وصف موثّقة',
};
export const libraryView = (app, root, params) => {
    if (!app.ctx || !app.bundle) {
        needData(root);
        return;
    }
    const ctx = app.ctx;
    const stock = new Map(inventoryRows(app.bundle, ctx).map((r) => [r.flavorId, r]));
    const q = h('input', { id: 'lib-q', type: 'search', class: 'input', placeholder: 'ابحث بالاسم أو الماركة', autocomplete: 'off', value: params.get('q') ?? '' });
    let filter = params.get('f') ?? 'all';
    const listEl = h('ul', { class: 'rows', 'aria-live': 'polite' });
    const filters = [['all', 'الكل'], ['verified', 'موثّق'], ['instock', 'عندي'], ['unsourced', 'بلا وصف منشور']];
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'تصفية' });
    const draw = () => {
        clear(chips);
        for (const [k, l] of filters)
            chips.append(h('button', { type: 'button', class: `chip${filter === k ? ' chip-on' : ''}`, 'aria-pressed': String(filter === k), on: { click: () => { filter = k; draw(); } } }, l));
        clear(listEl);
        const s = q.value.trim().toLowerCase();
        const items = [...ctx.products.values()].filter((p) => (!s || p.names.some((n) => n.toLowerCase().includes(s)) || p.brand.toLowerCase().includes(s))
            && (filter !== 'verified' || p.auditStatus === 'verified')
            && (filter !== 'instock' || (stock.get(p.id)?.availableMg ?? 0) > 0)
            && (filter !== 'unsourced' || !p.sourced))
            .sort((a, b) => (a.name < b.name ? -1 : 1));
        for (const p of items) {
            const st = stock.get(p.id);
            listEl.append(h('li', null, h('a', { class: 'row', href: `#/product/${encodeURIComponent(p.id)}` }, h('span', { class: 'row-main' }, h('bdi', null, p.name), h('span', { class: 'brand' }, ` · ${p.brand}`)), h('span', { class: 'row-sub' }, h('span', { class: `badge badge-audit-${p.auditStatus}` }, AUDIT_AR[p.auditStatus] ?? p.auditStatus), ' ', p.descriptors.filter((d) => d.group !== 'taste_attribute').slice(0, 3).map((d) => termAr(d.id)).join('، '), st ? h('span', { class: st.low ? 'warn-text' : 'muted' }, ` · ${grams(st.availableMg)}`) : null))));
        }
        if (!items.length)
            listEl.append(h('li', { class: 'muted' }, 'لا نتائج'));
    };
    q.addEventListener('input', draw);
    append(root, pageHead('المكتبة', `${countAr(ctx.products.size, PRODUCTS_AR)}${app.pack ? '' : ' · بلا حزمة معرفة: الأوصاف من الأسماء فقط'}`), h('label', { for: 'lib-q', class: 'sr-only' }, 'بحث'), q, chips, listEl);
    draw();
};
export const productView = (app, root, _params, path) => {
    if (!app.ctx || !app.bundle) {
        needData(root);
        return;
    }
    const ctx = app.ctx;
    const id = decodeURIComponent(path[1] ?? '');
    const p = ctx.products.get(id);
    if (!p) {
        append(root, pageHead('منتج غير موجود', undefined, { href: '#/library', label: 'المكتبة' }));
        return;
    }
    const pass = app.pack?.passports.find((x) => x.flavorId === id);
    const st = inventoryRows(app.bundle, ctx).find((r) => r.flavorId === id);
    const versions = new Map(app.bundle.recipeVersions.map((v) => [v.versionId, v]));
    const usedIn = app.bundle.recipes.filter((r) => versions.get(r.headVersionId)?.ingredients.some((i) => i.flavorId === id));
    const mine = components(p);
    const similar = [...ctx.products.values()].filter((q) => q.id !== p.id && [...mine].some((c) => components(q).has(c) && !['berry', 'tropical', 'citrus', 'floral', 'fruit'].includes(c)))
        .map((q) => ({ q, n: [...mine].filter((c) => components(q).has(c)).length })).sort((a, b) => b.n - a.n || (a.q.name < b.q.name ? -1 : 1)).slice(0, 6);
    const link = (ref) => (/^https?:\/\//.test(ref) ? h('a', { href: ref, target: '_blank', rel: 'noopener noreferrer', class: 'src-link' }, new URL(ref).hostname) : h('code', { class: 'ref' }, ref.length > 60 ? `${ref.slice(0, 60)}…` : ref));
    append(root, pageHead(p.name, [p.brand, ' · ', h('span', { class: `badge badge-audit-${p.auditStatus}` }, AUDIT_AR[p.auditStatus] ?? p.auditStatus)], { href: '#/library', label: 'المكتبة' }), section('ما نعرفه عن وصفه', p.descriptors.length
        ? [h('ul', { class: 'bullets' }, p.descriptors.map((d) => descriptorRow(app, id, d, termAr(d.id)))), h('p', { class: 'hint' }, NOTE_CAPTION_AR)]
        : h('p', { class: 'muted' }, 'غير معروف: لا نص منشور ولا يدل الاسم على مكوّن.'), p.multiNote ? h('p', { class: 'hint' }, 'نصّه يذكر أكثر من مكوّن — إشارة فقط؛ لا نعرف إن كان خليطاً جاهزاً.') : null), pass?.manufacturerTexts.length || pass?.secondaryTexts.length
        ? section('النصوص المصدرية', list([...(pass?.manufacturerTexts ?? []), ...(pass?.secondaryTexts ?? [])].map((t) => [
            h('q', { class: 'excerpt', lang: t.lang ?? undefined, dir: 'auto' }, t.text.length > 220 ? `${t.text.slice(0, 220)}…` : t.text), ' ',
            h('span', { class: 'muted small' }, `${t.publisher ?? ''} · ${t.status === 'verified' ? 'راجعتَه' : 'غير موثّق'}`), ' ', link(t.url)
        ])))
        : null, pass ? section('الشارات ومصادرها', list(pass.badges.map((bd) => {
        const urls = [...new Set(bd.refs.filter((r) => /^https?:\/\//.test(r)))];
        const internal = bd.refs.filter((r) => !/^https?:\/\//.test(r));
        return [bd.labelAr, ' ', ...urls.slice(0, 3).map((r) => [' ', link(r)]),
            internal.length ? h('details', { class: 'refs' }, h('summary', null, `سجلات داخلية (${internal.length})`), h('ul', { class: 'ref-list' }, internal.map((r) => h('li', null, h('code', { class: 'ref', dir: 'ltr' }, r))))) : null];
    }))) : null, p.sameAs.length || pass?.confirmedNames.length
        ? section('الهوية', p.sameAs.length ? h('p', null, 'قلتَ إنه المنتج نفسه مثل: ', p.sameAs.map((x, i) => [i ? '، ' : '', h('a', { href: `#/product/${encodeURIComponent(x)}` }, ctx.products.get(x)?.name ?? x)])) : null, pass?.confirmedNames.length ? h('p', null, 'أسماء مؤكّدة: ', pass.confirmedNames.map((n) => n.name).join('، ')) : null)
        : null, section('غير معروف', list([...(pass?.missingData ?? ['official_source_url', 'product_line', 'preblend_status', 'measured_intensity', 'sourced_sensory_descriptors']).map((f) => FIELD_AR[f]),
        'الشدّة لم تُقس؛ قيم «القوة/الحلاوة» القديمة غير موثّقة ولا تُستخدم.'])), st ? section('المخزون', h('p', null, `المتاح ${grams(st.availableMg)} من عبوة ${grams(st.packMg)} (${st.pctOfPack}%)`, st.low ? h('span', { class: 'warn-text' }, ' · منخفض') : null), h('a', { class: 'btn btn-quiet', href: `#/inventory?p=${encodeURIComponent(id)}` }, 'حركات المخزون')) : null, usedIn.length ? section(`في ${countAr(usedIn.length, RECIPES_AR)}`, h('ul', { class: 'rows' }, usedIn.slice(0, 12).map((r) => h('li', null, h('a', { class: 'row', href: `#/recipe/${encodeURIComponent(r.recipeId)}` }, h('bdi', null, r.name)))))) : null, similar.length ? section('منتجات تشترك معه في مكوّن', h('ul', { class: 'rows' }, similar.map(({ q }) => h('li', null, h('a', { class: 'row', href: `#/product/${encodeURIComponent(q.id)}` }, h('bdi', null, q.name), h('span', { class: 'brand' }, ` · ${q.brand}`)))))) : null, safetyNote());
};
