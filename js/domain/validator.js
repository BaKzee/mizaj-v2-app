import { TOTAL_BP } from "./basisPoints.js";
import { allocateMg } from "./grams.js";
export const MAX_INGREDIENTS = 20;
export function validateIngredients(ingredients, opts) {
    const errors = [];
    if (ingredients.length === 0)
        return { status: 'fail', errors: [{ code: 'empty_recipe' }] };
    if (ingredients.length > MAX_INGREDIENTS)
        errors.push({ code: 'too_many_ingredients', detail: String(ingredients.length) });
    const seen = new Set();
    let sum = 0;
    let sumIsMeaningful = true;
    for (const ing of ingredients) {
        const id = ing.flavorId;
        if (typeof id !== 'string' || id.length === 0) {
            errors.push({ code: 'missing_flavor_id' });
        }
        else {
            if (seen.has(id))
                errors.push({ code: 'duplicate_flavor_id', flavorId: id });
            seen.add(id);
            if (!opts.knownFlavorIds.has(id))
                errors.push({ code: 'unknown_flavor_id', flavorId: id });
            if (opts.excludedFlavorIds?.has(id))
                errors.push({ code: 'excluded_flavor_id', flavorId: id });
        }
        const bp = ing.basisPoints;
        if (typeof bp !== 'number' || !Number.isSafeInteger(bp)) {
            errors.push({ code: 'non_integer_basis_points', flavorId: id, detail: String(bp) });
            sumIsMeaningful = false;
        }
        else {
            if (bp <= 0)
                errors.push({ code: 'nonpositive_basis_points', flavorId: id, detail: String(bp) });
            sum += bp;
        }
    }
    if (sumIsMeaningful && sum !== TOTAL_BP)
        errors.push({ code: 'sum_not_10000', detail: String(sum) });
    return { status: errors.length ? 'fail' : 'pass', errors };
}
/**
 * Stock feasibility for a requested batch. `balancesMg` is the derived ledger
 * balance per flavor; a missing entry means 0 mg available (never assumed full).
 */
export function checkStock(ingredients, totalMg, balancesMg) {
    const alloc = allocateMg(ingredients, totalMg);
    const shortages = [];
    for (const a of alloc) {
        const have = balancesMg.get(a.flavorId) ?? 0;
        if (have < a.mg)
            shortages.push({ flavorId: a.flavorId, needMg: a.mg, haveMg: have });
    }
    return { status: shortages.length ? 'fail' : 'pass', shortages };
}
/** Order-independent identity of an ingredient list (used for version ids and dedup). */
export function canonicalIngredients(ingredients) {
    return [...ingredients]
        .map((i) => ({ flavorId: i.flavorId, basisPoints: i.basisPoints }))
        .sort((a, b) => (a.flavorId < b.flavorId ? -1 : a.flavorId > b.flavorId ? 1 : a.basisPoints - b.basisPoints));
}
