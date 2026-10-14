/** Shared pieces of the v2 screens. Every string reaches the DOM as text (dom.ts). */
import { h, icon } from "../dom.js";
import { DECISION_AR, grams, pct, SAFETY_AR, TIER_AR } from "../model.js";
export function pageHead(title, sub, back) {
    return h('div', { class: 'page-head' }, back ? h('a', { class: 'back-link', href: back.href }, icon('back'), back.label) : null, h('h1', { class: 'page-title', tabindex: '-1' }, title), sub ? h('p', { class: 'page-sub' }, sub) : null);
}
export function section(title, ...children) {
    return h('section', { class: 'section' }, h('h2', { class: 'section-title' }, title), ...children);
}
const DECISION_CLASS = {
    reference_supported: 'badge-ref', adapted_with_uncertainty: 'badge-adapted', exploratory: 'badge-hypo',
    invalid: 'badge-bad', insufficient_evidence: 'badge-muted', unknown: 'badge-muted', valid: 'badge-ok',
};
export function decisionBadge(d) {
    return h('span', { class: `badge ${DECISION_CLASS[d] ?? 'badge-muted'}` }, DECISION_AR[d]);
}
export function tierBadge(tier, attributionText) {
    return h('span', { class: 'evidence', title: TIER_AR[tier] }, h('span', { class: `tier tier-${tier}`, 'aria-label': TIER_AR[tier] }, tier), h('span', { class: 'evidence-text' }, attributionText));
}
export function formulaTable(rows, opts) {
    return h('table', { class: 'formula' }, h('caption', { class: 'sr-only' }, opts.caption), h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'المنتج'), h('th', { scope: 'col', class: 'num' }, 'النسبة'), rows.some((r) => r.mg !== undefined) ? h('th', { scope: 'col', class: 'num' }, 'الوزن') : null)), h('tbody', null, rows.map((r) => h('tr', null, h('td', null, opts.onWhy
        ? h('button', { type: 'button', class: 'link-btn', 'aria-label': `لماذا ${r.name}؟`, on: { click: () => opts.onWhy(r.flavorId) } }, h('bdi', null, r.name))
        : h('bdi', null, r.name), r.brand ? h('span', { class: 'brand' }, ' · ', h('bdi', null, r.brand)) : null), h('td', { class: 'num' }, pct(r.basisPoints)), r.mg !== undefined ? h('td', { class: 'num' }, grams(r.mg)) : null))));
}
export function list(items, cls = 'bullets') {
    const xs = items.filter((x) => x !== null && x !== undefined && x !== false && x !== '');
    return xs.length ? h('ul', { class: cls }, xs.map((x) => h('li', null, x))) : null;
}
export function safetyNote() {
    return h('p', { class: 'safety' }, icon('info'), SAFETY_AR);
}
export function emptyState(text, action) {
    return h('div', { class: 'empty' }, h('p', null, text), action ? h('a', { class: 'btn btn-primary', href: action.href }, action.label) : null);
}
export function needData(root) {
    root.append(pageHead('لا توجد بيانات بعد'), emptyState('استورد بيانات التطبيق القديم أو نسخة v2 احتياطية أولاً.', { href: '#/data', label: 'استيراد البيانات' }));
    return false;
}
export function fmtDate(iso) {
    if (!iso)
        return 'تاريخ غير معروف';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return iso;
    return d.toLocaleDateString('ar', { year: 'numeric', month: 'short', day: 'numeric' });
}
export function errorText(e) {
    const m = e instanceof Error ? e.message : String(e);
    return m.length > 300 ? `${m.slice(0, 300)}…` : m;
}
