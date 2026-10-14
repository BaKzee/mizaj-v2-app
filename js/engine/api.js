/**
 * Precision Engine contract (ENGINE §3, §10). Shapes only; the pipeline is in
 * `generate.ts`, the Recipe Doctor in `doctor.ts`, the intent parser in `intent.ts`.
 * Nothing here is a probability: `rankingIndexNotProbability` orders candidates
 * internally and is never shown as a chance of liking (ENGINE §5).
 */
import { MAX_TOTAL_MG } from "../domain/grams.js";
export { ENGINE_VERSION } from "../domain/types.js";
export const GENERATION_MODES = ['REFERENCE', 'PRECISION', 'SIGNATURE', 'DISCOVERY'];
export function defaultRequest(overrides = {}) {
    return {
        mode: 'PRECISION', targetDescriptors: [], negativeDescriptors: [], sweetness: null, cooling: null, stockOnly: false,
        preferredFlavorIds: [], excludedFlavorIds: [], maxProducts: 5, gramsTotalMg: 20_000, sourceQualityMin: 'recorded', seed: 0,
        ...overrides,
    };
}
export function validateRequest(r, knownFlavorIds) {
    const e = [];
    if (!GENERATION_MODES.includes(r.mode))
        e.push('mode');
    if (!Number.isInteger(r.maxProducts) || r.maxProducts < 1 || r.maxProducts > 8)
        e.push('maxProducts must be 1..8');
    if (!Number.isSafeInteger(r.gramsTotalMg) || r.gramsTotalMg <= 0 || r.gramsTotalMg > MAX_TOTAL_MG)
        e.push('gramsTotalMg');
    if (!Number.isSafeInteger(r.seed))
        e.push('seed');
    if (!['any', 'recorded', 'published', 'verified'].includes(r.sourceQualityMin))
        e.push('sourceQualityMin');
    for (const k of ['targetDescriptors', 'negativeDescriptors', 'preferredFlavorIds', 'excludedFlavorIds']) {
        if (!Array.isArray(r[k]) || r[k].some((x) => typeof x !== 'string' || !x))
            e.push(k);
    }
    const overlap = r.preferredFlavorIds.filter((x) => r.excludedFlavorIds.includes(x));
    if (overlap.length)
        e.push(`flavors both preferred and excluded: ${overlap.join(',')}`);
    const both = r.targetDescriptors.filter((x) => r.negativeDescriptors.includes(x));
    if (both.length)
        e.push(`descriptors both wanted and unwanted: ${both.join(',')}`);
    if (knownFlavorIds) {
        const unknown = [...r.preferredFlavorIds, ...r.excludedFlavorIds].filter((x) => !knownFlavorIds.has(x));
        if (unknown.length)
            e.push(`unknown flavor ids: ${unknown.join(',')}`);
    }
    return e;
}
