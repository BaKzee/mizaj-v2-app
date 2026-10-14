/**
 * «ماذا أشتري؟» — which product, restocked, makes the most WELL-SUPPORTED recipes possible again.
 *
 * Pure and deterministic. It only COUNTS recorded (A/B) and published exact (C) formulas that are
 * blocked in a one-batch stock check by exactly one product, and that one more pack of that
 * product would unblock. It is not a taste ranking and gives no probability.
 */
import { allocateMg, mgToGramString } from "../domain/grams.js";
export const SHOPPING_MAX_SESSIONS_SHOWN = 20;
const TIER_RANK = { A: 0, B: 1, C: 2, D: 3, E: 4, U: 5 };
const g = (mg) => `${mgToGramString(mg, 1)} غ`;
function bestPerRecipe(ctx) {
    const best = new Map();
    for (const r of ctx.references) {
        if (!(r.tier === 'A' || r.tier === 'B' || r.tier === 'C') || r.support < r.caution)
            continue;
        const key = r.recipeId ?? r.refId;
        const cur = best.get(key);
        const better = !cur || TIER_RANK[r.tier] < TIER_RANK[cur.tier] || (r.tier === cur.tier && (r.support > cur.support || (r.support === cur.support && (Number(r.isHead) > Number(cur.isHead) || (r.isHead === cur.isHead && r.refId < cur.refId)))));
        if (better)
            best.set(key, r);
    }
    return [...best.values()].sort((a, b) => (a.refId < b.refId ? -1 : 1));
}
/** Products (already in the library) worth restocking, by how many supported formulas one pack unblocks. */
export function restockOptions(ctx, opts) {
    if (!Number.isSafeInteger(opts.batchMg) || opts.batchMg <= 0)
        throw new RangeError('batchMg must be a positive integer');
    const refs = bestPerRecipe(ctx);
    const byProduct = new Map();
    for (const r of refs) {
        const need = new Map(allocateMg(r.ingredients, opts.batchMg).map((a) => [a.flavorId, a.mg]));
        const short = [...need].filter(([id, mg]) => (ctx.balancesMg.get(id) ?? 0) < mg).map(([id]) => id);
        if (short.length !== 1)
            continue; // already makeable, or short in more than one product: not unlocked by one purchase
        const q = short[0];
        if (!ctx.products.has(q))
            continue;
        const after = (ctx.balancesMg.get(q) ?? 0) + opts.packMgOf(q);
        if (after < need.get(q))
            continue;
        let sessions = SHOPPING_MAX_SESSIONS_SHOWN;
        for (const [id, mg] of need)
            sessions = Math.min(sessions, Math.floor(((id === q ? after : ctx.balancesMg.get(id) ?? 0)) / mg));
        if (sessions < 1)
            continue;
        const list = byProduct.get(q) ?? [];
        list.push({ refId: r.refId, recipeId: r.recipeId, name: r.name, kind: r.kind, tier: r.tier, attribution: r.attribution, support: r.support, url: r.url, sessions });
        byProduct.set(q, list);
    }
    const out = [];
    for (const [id, unlocks] of byProduct) {
        unlocks.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.support - a.support || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.refId < b.refId ? -1 : 1));
        const p = ctx.products.get(id);
        const withEvidence = unlocks.filter((u) => u.tier === 'A' || u.tier === 'B').length;
        const packMg = opts.packMgOf(id);
        out.push({
            flavorId: id, name: p.name, brand: p.brand, availableMg: ctx.balancesMg.get(id) ?? 0, packMg, unlocks, withEvidence,
            summaryAr: `عبوة ${g(packMg)} تعيد ${unlocks.length} وصفة مدعومة (${withEvidence} منها بسجلاتك)؛ المتاح الآن ${g(ctx.balancesMg.get(id) ?? 0)}`,
        });
    }
    out.sort((a, b) => b.withEvidence - a.withEvidence || b.unlocks.length - a.unlocks.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.flavorId < b.flavorId ? -1 : 1));
    return out.slice(0, opts.maxResults ?? 8);
}
/** How many supported formulas exist and how many the current stock already makes for one batch (counts only). */
export function supportedStockStats(ctx, batchMg) {
    const refs = bestPerRecipe(ctx);
    let makeableNow = 0;
    for (const r of refs)
        if (allocateMg(r.ingredients, batchMg).every((a) => (ctx.balancesMg.get(a.flavorId) ?? 0) >= a.mg))
            makeableNow++;
    return { supported: refs.length, makeableNow };
}
