import { SCHEMA_VERSION } from "./types.js";
import { contentId } from "./hash.js";
import { canonicalIngredients, validateIngredients } from "./validator.js";
export function recipeVersionId(recipeId, parentVersionId, ingredients) {
    return contentId('rv', { recipeId, parentVersionId, ingredients: canonicalIngredients(ingredients) });
}
/** Deep-freeze so accidental mutation throws in strict mode (immutability in practice, not just by convention). */
export function deepFreeze(obj) {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
        Object.freeze(obj);
        for (const v of Object.values(obj))
            deepFreeze(v);
    }
    return obj;
}
export function createRecipeVersion(input) {
    const check = validateIngredients(input.ingredients, { knownFlavorIds: input.knownFlavorIds });
    const version = {
        schemaVersion: SCHEMA_VERSION,
        recipeId: input.recipeId,
        versionId: recipeVersionId(input.recipeId, input.parentVersionId, input.ingredients),
        parentVersionId: input.parentVersionId,
        createdAt: input.createdAt,
        createdAtPrecision: input.createdAt ? 'ms' : 'unknown',
        origin: input.origin,
        ingredients: input.ingredients.map((i) => ({ flavorId: i.flavorId, basisPoints: i.basisPoints })),
        referenceIds: [...(input.referenceIds ?? [])],
        explanation: input.explanation ?? null,
        structuralStatus: check.status === 'pass' ? 'valid' : 'invalid_legacy',
        structuralErrors: check.errors.map((e) => (e.flavorId ? `${e.code}:${e.flavorId}` : e.detail ? `${e.code}:${e.detail}` : e.code)),
        legacyEditRaw: input.legacyEditRaw ?? null,
    };
    return deepFreeze(version);
}
/** Ingredient-level diff between two versions (order-independent). */
export function diffVersions(from, to) {
    const a = new Map(from.map((i) => [i.flavorId, i.basisPoints]));
    const b = new Map(to.map((i) => [i.flavorId, i.basisPoints]));
    const out = [];
    for (const [id, bp] of [...a].sort(([x], [y]) => (x < y ? -1 : 1))) {
        if (!b.has(id))
            out.push({ kind: 'removed', flavorId: id, fromBp: bp });
        else if (b.get(id) !== bp)
            out.push({ kind: 'changed', flavorId: id, fromBp: bp, toBp: b.get(id) });
    }
    for (const [id, bp] of [...b].sort(([x], [y]) => (x < y ? -1 : 1))) {
        if (!a.has(id))
            out.push({ kind: 'added', flavorId: id, toBp: bp });
    }
    return out;
}
