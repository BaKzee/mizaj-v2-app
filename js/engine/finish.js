import { allocateMg, mgToGramString } from "../domain/grams.js";
import { TOTAL_BP } from "../domain/basisPoints.js";
/** Smallest scaled session offered, as a share of the owner's batch (basis points). */
export const FINISH_MIN_FRACTION_BP = 6000;
/** "Finishes the pack" = at most this much is left over (0.1 g). */
export const FINISH_TOLERANCE_MG = 100;
/** A pack needing more sessions than this is not "nearly finished": no plan is offered. */
export const FINISH_MAX_SESSIONS = 8;
/** How many extra session counts are tried beyond the minimum when scaling. */
const EXTRA_SESSION_COUNTS = 3;
const g = (mg) => `${mgToGramString(mg, 1)} غ`;
const TIER_RANK = { A: 0, B: 1, C: 2, D: 3, E: 4, U: 5 };
function productMgFor(ings, idx, totalMg) {
    return allocateMg(ings, totalMg)[idx].mg;
}
/** Largest total ≤ maxTotal whose product share is ≤ wantMg (integer search, a few steps at most). */
function totalFor(ings, idx, bp, wantMg, maxTotalMg) {
    let t = Math.min(maxTotalMg, Math.floor((wantMg * TOTAL_BP) / bp) + 1);
    while (t > 1 && productMgFor(ings, idx, t) > wantMg)
        t -= 1;
    return t;
}
function sessionOf(ctx, ings, totalMg) {
    return {
        totalMg,
        lines: allocateMg(ings, totalMg).map((a) => ({ flavorId: a.flavorId, name: ctx.products.get(a.flavorId)?.name ?? a.flavorId, mg: a.mg })),
    };
}
function summary(plan) {
    const n = plan.sessions.length;
    const totals = [...new Set(plan.sessions.map((s) => s.totalMg))];
    const sess = n === 1 ? 'جلسة واحدة' : n === 2 ? 'جلستان' : `${n} جلسات`;
    const size = totals.length === 1 ? ` (${g(totals[0])} لكل جلسة)` : ` (${totals.map(g).join('، ')})`;
    const tail = plan.finishes ? '؛ تنتهي العلبة (يتبقى أقل من 0.1 غ)' : `؛ يتبقى ${g(plan.leftoverMg)} من العلبة`;
    const block = plan.blocked ? `. ينقص من «${plan.blocked.name}»: عندك ${g(plan.blocked.haveMg)} والمطلوب ${g(plan.blocked.needMg)}` : '';
    return `${sess}${size}${tail}${block}`;
}
export function finishPack(ctx, flavorId, opts) {
    const product = ctx.products.get(flavorId);
    if (!product)
        throw new RangeError(`unknown product ${flavorId}`);
    if (!Number.isSafeInteger(opts.batchMg) || opts.batchMg <= 0)
        throw new RangeError('batchMg must be a positive integer');
    const available = ctx.balancesMg.get(flavorId) ?? 0;
    const out = { flavorId, name: product.name, availableMg: available, plans: [], messages: [] };
    if (available <= 0) {
        out.messages.push('لا رصيد مسجّل لهذا المنتج.');
        return out;
    }
    // eligible references that contain THIS entry; one per recipe (best-evidenced version)
    const eligible = ctx.references.filter((r) => (r.tier === 'A' || r.tier === 'B' || r.tier === 'C') && r.support >= r.caution && r.ingredients.some((i) => i.flavorId === flavorId));
    const best = new Map();
    for (const r of eligible) {
        const key = r.recipeId ?? r.refId;
        const cur = best.get(key);
        const better = !cur || TIER_RANK[r.tier] < TIER_RANK[cur.tier] || (r.tier === cur.tier && (r.support > cur.support || (r.support === cur.support && (Number(r.isHead) > Number(cur.isHead) || (r.isHead === cur.isHead && r.refId < cur.refId)))));
        if (better)
            best.set(key, r);
    }
    const minTotal = Math.ceil((opts.batchMg * FINISH_MIN_FRACTION_BP) / TOTAL_BP);
    const plans = [];
    let tooFull = 0;
    for (const ref of best.values()) {
        const ings = ref.ingredients;
        const idx = ings.findIndex((i) => i.flavorId === flavorId);
        const bp = ings[idx].basisPoints;
        const fullMg = productMgFor(ings, idx, opts.batchMg);
        if (fullMg <= 0)
            continue;
        let sessions = null;
        // 1) scale k equal-ish sessions so the pack ends exactly (each within [minTotal, batch])
        const kMin = Math.max(1, Math.ceil(available / fullMg));
        if (kMin > FINISH_MAX_SESSIONS) {
            tooFull++;
            continue;
        }
        for (let k = kMin; k <= kMin + EXTRA_SESSION_COUNTS && !sessions; k++) {
            const perMg = available / k;
            const total = (perMg * TOTAL_BP) / bp;
            if (total > opts.batchMg + 1e-9 || total < minTotal - 1e-9)
                continue;
            const parts = [];
            for (let j = 0; j < k; j++) {
                const want = Math.floor(available / k) + (j < available % k ? 1 : 0);
                const t = totalFor(ings, idx, bp, want, opts.batchMg);
                if (t < minTotal) {
                    parts.length = 0;
                    break;
                }
                parts.push(sessionOf(ctx, ings, t));
            }
            if (parts.length === k)
                sessions = parts;
        }
        // 2) otherwise as many whole batches as the pack allows (and say what is left)
        if (!sessions) {
            const n = Math.floor(available / fullMg);
            if (n >= 1)
                sessions = Array.from({ length: n }, () => sessionOf(ctx, ings, opts.batchMg));
        }
        if (!sessions)
            continue;
        const productUsedMg = sessions.reduce((s, x) => s + x.lines.find((l) => l.flavorId === flavorId).mg, 0);
        if (productUsedMg > available)
            continue; // never overdraw (cannot happen by construction)
        const leftoverMg = available - productUsedMg;
        // other ingredients against the same ledger, for ALL sessions together
        let blocked = null;
        const need = new Map();
        for (const s of sessions)
            for (const l of s.lines)
                need.set(l.flavorId, (need.get(l.flavorId) ?? 0) + l.mg);
        for (const [id, needMg] of [...need].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
            const have = ctx.balancesMg.get(id) ?? 0;
            if (have < needMg) {
                blocked = { flavorId: id, name: ctx.products.get(id)?.name ?? id, haveMg: have, needMg };
                break;
            }
        }
        const partial = { sessions, leftoverMg, finishes: leftoverMg <= FINISH_TOLERANCE_MG, blocked };
        plans.push({
            refId: ref.refId, recipeId: ref.recipeId, versionId: ref.versionId, name: ref.name, kind: ref.kind, tier: ref.tier, attribution: ref.attribution,
            support: ref.support, caution: ref.caution, url: ref.url, productBp: bp, productUsedMg, ...partial, summaryAr: summary(partial),
        });
    }
    const rank = (p) => (p.blocked ? 2 : 0) + (p.finishes ? 0 : 1);
    plans.sort((a, b) => rank(a) - rank(b) || TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.support - a.support || a.caution - b.caution
        || a.sessions.length - b.sessions.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.refId < b.refId ? -1 : 1));
    out.plans = plans.slice(0, opts.maxResults ?? 5);
    if (!plans.length) {
        out.messages.push(!eligible.length
            ? 'لا توجد وصفة مسجّلة بدليل (A أو B) أو منشورة (C) تحتوي هذا المنتج بالذات.'
            : tooFull === best.size
                ? `المتبقي (${g(available)}) كبير: ينهيه أكثر من ${FINISH_MAX_SESSIONS} جلسات. هذه الميزة للعلب القريبة من النهاية.`
                : `المتبقي (${g(available)}) أقل من أصغر دفعة نعرضها؛ لا خطة تنهي العلبة.`);
    }
    const sibling = product.sameAs.map((id) => ctx.products.get(id)).filter((p) => p && (ctx.balancesMg.get(p.id) ?? 0) > 0);
    if (sibling.length)
        out.messages.push(`لديك المنتج نفسه باسم ${sibling.map((p) => `${p.name} (${g(ctx.balancesMg.get(p.id) ?? 0)})`).join('، ')} (قرارك). رصيده منفصل ولم يُحتسب هنا.`);
    return out;
}
