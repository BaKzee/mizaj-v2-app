/** Ingredient basis points keyed by canonical product (linked entries count as one product). */
export function canonicalShares(ctx, ings) {
    const m = new Map();
    for (const i of ings) {
        const c = ctx.products.get(i.flavorId)?.canonicalId ?? i.flavorId;
        m.set(c, (m.get(c) ?? 0) + i.basisPoints);
    }
    return m;
}
export function jaccard(a, b) {
    if (a.size === 0 && b.size === 0)
        return 1;
    let inter = 0;
    for (const x of a)
        if (b.has(x))
            inter++;
    return inter / (a.size + b.size - inter);
}
export function ingredientJaccard(ctx, a, b) {
    return jaccard(new Set(canonicalShares(ctx, a).keys()), new Set(canonicalShares(ctx, b).keys()));
}
/** ½·Σ|a−b| in basis points: 0 = same proportions, 10 000 = nothing shared. */
export function halfL1Bp(ctx, a, b) {
    const x = canonicalShares(ctx, a);
    const y = canonicalShares(ctx, b);
    let s = 0;
    for (const k of new Set([...x.keys(), ...y.keys()]))
        s += Math.abs((x.get(k) ?? 0) - (y.get(k) ?? 0));
    return s / 2;
}
/** Flavor-component descriptors of a formula (taste attributes excluded). */
export function descriptorSet(ctx, ings) {
    const s = new Set();
    for (const i of ings)
        for (const d of ctx.products.get(i.flavorId)?.descriptors ?? [])
            if (d.group !== 'taste_attribute')
                s.add(d.id);
    return s;
}
export function descriptorDistance(ctx, a, b) {
    return 1 - jaccard(descriptorSet(ctx, a), descriptorSet(ctx, b));
}
/** "Genuinely distinct" per config: different products, or clearly different identities. */
export function isDistinct(ctx, a, b) {
    return ingredientJaccard(ctx, a, b) <= ctx.config.diversity.maxIngredientJaccard
        || (descriptorDistance(ctx, a, b) >= ctx.config.diversity.minDescriptorDistance && ingredientJaccard(ctx, a, b) < 1);
}
