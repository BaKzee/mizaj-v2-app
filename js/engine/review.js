import { validateIngredients, checkStock } from "../domain/validator.js";
import { LEXICON } from "../knowledge/descriptors.js";
import { canonicalShares, halfL1Bp, ingredientJaccard } from "./similarity.js";
export function hardCheck(ctx, ings, opts) {
    const errors = [];
    const known = new Set(ctx.products.keys());
    const v = validateIngredients(ings, { knownFlavorIds: known });
    for (const e of v.errors)
        errors.push(`${e.code}${e.flavorId ? `:${e.flavorId}` : ''}`);
    const canon = canonicalShares(ctx, ings);
    if (canon.size !== ings.length && v.status === 'pass')
        errors.push('same_product_twice (owner-linked entries)');
    for (const i of ings) {
        const c = ctx.products.get(i.flavorId)?.canonicalId ?? i.flavorId;
        if (opts.excluded.has(i.flavorId) || opts.excluded.has(c))
            errors.push(`excluded:${i.flavorId}`);
    }
    if (opts.maxProducts !== null && ings.length > opts.maxProducts)
        errors.push(`too_many_products:${ings.length}>${opts.maxProducts}`);
    let stock = 'not_requested';
    let shortages = [];
    if (v.status === 'pass') {
        const s = checkStock(ings, opts.gramsTotalMg, ctx.balancesMg);
        shortages = s.shortages;
        if (opts.stockOnly)
            stock = s.status;
    }
    return { structural: errors.length ? 'fail' : 'pass', errors, stock, shortages };
}
const nameOf = (ctx, id) => ctx.products.get(id)?.name ?? id;
const ar = (id) => LEXICON.find((e) => e.id === id)?.ar ?? id;
/** Explanatory heuristics — shown as reasons to look closer, not as verdicts. */
export function heuristicWarnings(ctx, ings, shortages = []) {
    const w = [];
    const ids = ings.map((i) => i.flavorId);
    const comp = (id) => (ctx.products.get(id)?.descriptors ?? []).filter((d) => d.group !== 'taste_attribute' && d.group !== 'cooling');
    for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) {
            const pa = ctx.products.get(ids[a]);
            const pb = ctx.products.get(ids[b]);
            if (!pa || !pb)
                continue;
            const shared = comp(pa.id).filter((d) => comp(pb.id).some((e) => e.id === d.id)).map((d) => d.id);
            // Generic group words ("berry", "tropical", "citrus", "floral") are too broad to call a repeat.
            const specific = shared.filter((x) => !['berry', 'tropical', 'citrus', 'floral', 'spice'].includes(x));
            if (specific.length && (pa.multiNote || pb.multiNote)) {
                const blend = pa.multiNote ? pa : pb;
                const other = blend === pa ? pb : pa;
                w.push({
                    code: 'potential_redundancy_preblend', flavorIds: [blend.id, other.id], basis: [],
                    textAr: `تكرار محتمل: «${blend.name}» يذكر نصُّه أكثر من مكوّن، منها (${specific.map(ar).join('، ')})، و«${other.name}» يحمل المكوّن نفسه. ليس فشلاً حتمياً؛ راجع النسبة.`,
                });
            }
            else if (specific.length) {
                w.push({
                    code: 'potential_redundancy_shared_identity', flavorIds: [pa.id, pb.id], basis: [],
                    textAr: `«${pa.name}» و«${pb.name}» يشتركان في الهوية نفسها (${specific.map(ar).join('، ')}). قد يكون أحدهما زائداً — ليس حكماً على الطعم.`,
                });
            }
            for (const r of ctx.relationships.between(pa.id, pb.id)) {
                if (r.usage === 'excluded')
                    continue;
                if (r.relationshipType === 'reported_clash') {
                    w.push({ code: 'legacy_reported_clash', flavorIds: [pa.id, pb.id], basis: [r.claimId], textAr: `التطبيق القديم وسم الزوج «${pa.name}» + «${pb.name}» كتعارض. ملاحظة غير موثّقة — للتنبيه فقط، لا منع.` });
                }
                else if (r.relationshipType === 'potential_redundancy') {
                    w.push({ code: 'legacy_potential_redundancy', flavorIds: [pa.id, pb.id], basis: [r.claimId], textAr: `التطبيق القديم وسم «${pa.name}» و«${pb.name}» كمتداخلين. ملاحظة غير موثّقة.` });
                }
            }
        }
    }
    for (const i of ings) {
        const p = ctx.products.get(i.flavorId);
        if (p && !p.sourced)
            w.push({ code: 'no_published_description', flavorIds: [p.id], basis: [], textAr: `لا يوجد نص منشور يصف «${p.name}»؛ وصفه مستنتج من اسمه فقط${p.descriptors.length ? '' : ' (ولا يدل الاسم على مكوّن)'}.` });
    }
    for (const s of shortages)
        w.push({ code: 'stock_shortage', flavorIds: [s.flavorId], basis: [], textAr: `مخزون «${nameOf(ctx, s.flavorId)}» لا يكفي: مطلوب ${(s.needMg / 1000).toFixed(1)} غ والمتاح ${(s.haveMg / 1000).toFixed(1)} غ.` });
    return dedupe(w);
}
/** Formulas the owner rated low (and never high) that look like this one. */
export function counterexamples(ctx, ings, exceptRefIds = new Set()) {
    const out = [];
    for (const r of ctx.references) {
        if (exceptRefIds.has(r.refId) || r.caution === 0 || r.support > 0)
            continue;
        const j = ingredientJaccard(ctx, ings, r.ingredients);
        const d = halfL1Bp(ctx, ings, r.ingredients);
        if (j >= ctx.config.caution.similarJaccard && d <= ctx.config.caution.similarHalfL1Bp) {
            out.push({
                code: 'similar_to_low_rated_record', flavorIds: [], basis: [r.refId],
                textAr: `يشبه «${r.name}» الذي سُجّل له تقييم منخفض (${r.observations.ratings.join('، ')}/5). تنبيه ضعيف من سجل واحد أو اثنين، وليس منعاً.`,
            });
        }
    }
    return out;
}
function dedupe(w) {
    const seen = new Set();
    return w.filter((x) => { const k = `${x.code}|${[...x.flavorIds].sort().join(',')}|${x.basis.join(',')}`; if (seen.has(k))
        return false; seen.add(k); return true; });
}
/** Simplification label for dropping a product that has no published description. */
export const UNDESCRIBED_AR = 'وصف غير معروف';
export function referenceById(ctx, id) {
    return ctx.references.find((r) => r.refId === id);
}
