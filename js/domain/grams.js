import { TOTAL_BP } from "./basisPoints.js";
export const MG_PER_G = 1000;
/** Upper bound keeps every intermediate product inside Number.MAX_SAFE_INTEGER. */
export const MAX_TOTAL_MG = 10_000_000; // 10 kg
export function gramsToMgExact(grams) {
    if (!Number.isFinite(grams))
        throw new RangeError('gramsToMgExact: not finite');
    const mg = Math.round(grams * MG_PER_G);
    if (Math.abs(grams * MG_PER_G - mg) > 1e-6)
        throw new RangeError(`gramsToMgExact: ${grams} g is finer than 1 mg`);
    return mg;
}
export function mgToGramString(mg, decimals = 1) {
    if (!Number.isSafeInteger(mg))
        throw new RangeError('mgToGramString: mg must be a safe integer');
    if (decimals < 0 || decimals > 3)
        throw new RangeError('decimals 0..3');
    const sign = mg < 0 ? '-' : '';
    const abs = Math.abs(mg);
    const unit = 10 ** (3 - decimals);
    // round half up at the display precision, integer-only
    const q = Math.floor((abs + unit / 2) / unit);
    if (decimals === 0)
        return `${sign}${q}`;
    const s = String(q).padStart(decimals + 1, '0');
    return `${sign}${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}
/**
 * Split `totalMg` across ingredients proportionally to basis points.
 * Preconditions are enforced (the structural validator should run first):
 * integer bp > 0, sum = 10 000, totalMg a positive safe integer ≤ MAX_TOTAL_MG.
 */
export function allocateMg(ingredients, totalMg) {
    if (!Number.isSafeInteger(totalMg) || totalMg <= 0 || totalMg > MAX_TOTAL_MG) {
        throw new RangeError(`allocateMg: totalMg must be an integer in 1..${MAX_TOTAL_MG}`);
    }
    if (ingredients.length === 0)
        throw new RangeError('allocateMg: empty recipe');
    let bpSum = 0;
    for (const ing of ingredients) {
        if (!Number.isSafeInteger(ing.basisPoints) || ing.basisPoints <= 0)
            throw new RangeError(`allocateMg: invalid bp for ${ing.flavorId}`);
        bpSum += ing.basisPoints;
    }
    if (bpSum !== TOTAL_BP)
        throw new RangeError(`allocateMg: bp sum ${bpSum} ≠ ${TOTAL_BP}`);
    const parts = ingredients.map((ing, idx) => {
        const num = totalMg * ing.basisPoints; // ≤ 1e11, safe
        return { idx, flavorId: ing.flavorId, basisPoints: ing.basisPoints, mg: Math.floor(num / TOTAL_BP), rem: num % TOTAL_BP };
    });
    let assigned = parts.reduce((s, p) => s + p.mg, 0);
    const order = [...parts].sort((a, b) => b.rem - a.rem || b.basisPoints - a.basisPoints || a.idx - b.idx);
    let i = 0;
    while (assigned < totalMg) {
        order[i].mg += 1;
        assigned += 1;
        i += 1;
    }
    return parts.map(({ flavorId, basisPoints, mg }) => ({ flavorId, basisPoints, mg }));
}
