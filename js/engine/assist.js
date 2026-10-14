import { allocateMg } from "../domain/grams.js";
import { TOTAL_BP } from "../domain/basisPoints.js";
import { components, matches, termAr } from "./generate.js";
import { canonicalShares } from "./similarity.js";
import { noteFor, noteStatusAr } from "./notes.js";
export const PROVENANCE_AR = {
    maker_text_verified: 'نص المصنّع — راجعتَه أنت',
    sourced_text: 'نص منشور — غير موثّق بعد',
    product_name: 'من اسم المنتج فقط',
};
/** Generic group words are too broad to call two products "the same role". */
const GENERIC = new Set(['berry', 'tropical', 'citrus', 'floral', 'spice', 'fruit']);
export function explainIngredient(ctx, ings, flavorId, opts = {}) {
    const p = ctx.products.get(flavorId);
    if (!p)
        throw new RangeError(`unknown product ${flavorId}`);
    const me = ings.find((i) => i.flavorId === flavorId);
    const covers = (opts.targets ?? []).filter((t) => matches(p, t)).map(termAr);
    let inReference = null;
    for (const refId of opts.referenceIds ?? []) {
        const ref = ctx.references.find((r) => r.refId === refId);
        const hit = ref?.ingredients.find((i) => (ctx.products.get(i.flavorId)?.canonicalId ?? i.flavorId) === p.canonicalId);
        if (ref && hit) {
            inReference = { name: ref.name, basisPoints: hit.basisPoints };
            break;
        }
    }
    const mine = components(p);
    const sharedWith = ings.filter((i) => i.flavorId !== flavorId).map((i) => {
        const q = ctx.products.get(i.flavorId);
        return { name: q?.name ?? i.flavorId, terms: [...components(q)].filter((c) => mine.has(c) && !GENERIC.has(c)).map(termAr) };
    }).filter((x) => x.terms.length);
    const unknowns = ['لا يوجد قياس لشدّته؛ نسبته ليست معايرة حسياً.'];
    if (!p.sourced)
        unknowns.push('لا يوجد نص منشور يصفه؛ وصفه مستنتج من اسمه فقط.');
    else if (p.auditStatus !== 'verified')
        unknowns.push('النص الذي يصفه لم تراجعه بعد.');
    if (p.multiNote)
        unknowns.push('نصّه يذكر أكثر من مكوّن؛ لا نعرف إن كان خليطاً جاهزاً.');
    return {
        flavorId, name: p.name, brand: p.brand, basisPoints: me?.basisPoints ?? 0,
        descriptors: p.descriptors.filter((d) => d.group !== 'taste_attribute').map((d) => ({ id: d.id, ar: termAr(d.id), provenance: d.provenance, provenanceAr: PROVENANCE_AR[d.provenance], personalAr: noteStatusAr(d, opts.notes ? noteFor(opts.notes, flavorId, d.id) : null) })),
        covers, inReference, sharedWith,
        ownerLinked: p.sameAs.map((id) => ctx.products.get(id)?.name ?? id),
        unknowns,
    };
}
export const SUBSTITUTE_KIND_AR = {
    same_product: 'المنتج نفسه',
    documented_close: 'نصّ منشور يذكر المكوّنات نفسها',
    exploratory: 'تقريبي — استكشافي',
};
/**
 * 05_UX Substitutes, in this order: the same product (owner decision) → a product whose
 * sourced text names at least the same components → an approximate, exploratory option
 * sharing a specific component. The caller re-checks the whole formula (Recipe Doctor).
 */
export function substituteOptions(ctx, ings, flavorId, opts) {
    const p = ctx.products.get(flavorId);
    const k = ings.findIndex((i) => i.flavorId === flavorId);
    if (!p || k < 0)
        throw new RangeError(`${flavorId} is not in this formula`);
    const needMg = allocateMg(ings, opts.gramsTotalMg)[k].mg;
    const inUse = canonicalShares(ctx, ings.filter((_, j) => j !== k));
    const excluded = opts.excluded ?? new Set();
    const limit = opts.limitPerKind ?? 8;
    const mine = components(p);
    // Cooling modifies a flavor; it is not the flavor. An approximate substitute must share a flavor
    // component — unless the product IS only a cooling agent (then cooling is its identity).
    const specific = [...mine].filter((c) => !GENERIC.has(c) && (c !== 'cooling' || [...mine].every((x) => x === 'cooling')));
    const option = (q, kind, basisAr) => {
        const haveMg = ctx.balancesMg.get(q.id) ?? 0;
        return { flavorId: q.id, name: q.name, brand: q.brand, kind, basisAr, enoughStock: haveMg >= needMg, haveMg, needMg };
    };
    const pool = [...ctx.products.values()].filter((q) => q.id !== p.id && !excluded.has(q.id) && !inUse.has(q.canonicalId));
    const byStock = (a, b) => Number(b.enoughStock) - Number(a.enoughStock) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const same = pool.filter((q) => p.sameAs.includes(q.id)).map((q) => option(q, 'same_product', 'قلتَ إنهما المنتج نفسه (قرار مسجّل).')).sort(byStock);
    const taken = new Set(same.map((o) => o.flavorId));
    const close = p.sourced && mine.size
        ? pool.filter((q) => !taken.has(q.id) && q.sourced && [...mine].every((c) => components(q).has(c)))
            .map((q) => option(q, 'documented_close', `نصّه المنشور يذكر: ${[...mine].map(termAr).join('، ')}. استبدال غير مجرَّب.`)).sort(byStock).slice(0, limit)
        : [];
    for (const o of close)
        taken.add(o.flavorId);
    const approx = specific.length
        ? pool.filter((q) => !taken.has(q.id) && specific.some((c) => components(q).has(c)))
            .map((q) => ({ q, shared: specific.filter((c) => components(q).has(c)) }))
            .map(({ q, shared }) => ({ shared: shared.length, o: option(q, 'exploratory', `يشترك معه في: ${shared.map(termAr).join('، ')} فقط. بديل تقريبي غير مجرَّب.`) }))
            .sort((a, b) => b.shared - a.shared || byStock(a.o, b.o)).slice(0, limit).map((x) => x.o)
        : [];
    return [...same, ...close, ...approx];
}
/** Replace one ingredient keeping its share; the total stays 10 000 bp. */
export function substitute(ings, from, to) {
    if (!ings.some((i) => i.flavorId === from))
        throw new RangeError(`${from} is not in this formula`);
    if (ings.some((i) => i.flavorId === to))
        throw new RangeError(`${to} is already in this formula`);
    const out = ings.map((i) => (i.flavorId === from ? { flavorId: to, basisPoints: i.basisPoints } : { ...i }));
    if (out.reduce((s, i) => s + i.basisPoints, 0) !== TOTAL_BP && ings.reduce((s, i) => s + i.basisPoints, 0) === TOTAL_BP)
        throw new Error('substitution changed the total');
    return out;
}
