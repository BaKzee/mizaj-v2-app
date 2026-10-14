import { TOTAL_BP } from "../domain/basisPoints.js";
import { recipeVersionId } from "../domain/recipeVersion.js";
import { validateIngredients } from "../domain/validator.js";
import { deriveBalances } from "../domain/inventory.js";
import { claimVersioningProblems } from "../domain/claims.js";
const NON_VERIFYING = new Set(['LEGACY_UNVERIFIED', 'MODEL_INFERENCE', 'UNKNOWN']);
function uniq(xs, key, label, out) {
    const s = new Set();
    for (const x of xs) {
        const k = key(x);
        if (s.has(k))
            out.push(`${label}: duplicate id ${k}`);
        s.add(k);
    }
    return s;
}
export function validateBundleInvariants(b) {
    const p = [];
    if (b.format !== 'mizaj-v2-bundle')
        p.push('format: not a v2 bundle');
    if (b.schemaVersion !== 2)
        p.push('schemaVersion must be 2');
    const flavorIds = uniq(b.flavors, (f) => f.id, 'flavors', p);
    uniq(b.claims, (c) => c.claimId, 'claims', p);
    uniq(b.sources, (s) => s.sourceId, 'sources', p);
    const recipeIds = uniq(b.recipes, (r) => r.recipeId, 'recipes', p);
    const versionIds = uniq(b.recipeVersions, (v) => v.versionId, 'recipeVersions', p);
    uniq(b.assessments, (a) => a.assessmentId, 'assessments', p);
    uniq(b.sessions, (s) => s.sessionId, 'sessions', p);
    uniq(b.inventoryEvents, (e) => e.eventId, 'inventoryEvents', p);
    const versionsById = new Map(b.recipeVersions.map((v) => [v.versionId, v]));
    for (const v of b.recipeVersions) {
        if (!recipeIds.has(v.recipeId))
            p.push(`version ${v.versionId}: unknown recipe ${v.recipeId}`);
        if (v.parentVersionId !== null && !versionIds.has(v.parentVersionId))
            p.push(`version ${v.versionId}: missing parent ${v.parentVersionId}`);
        if (recipeVersionId(v.recipeId, v.parentVersionId, v.ingredients) !== v.versionId)
            p.push(`version ${v.versionId}: id does not match content (mutated?)`);
        if (v.structuralStatus === 'valid') {
            const res = validateIngredients(v.ingredients, { knownFlavorIds: flavorIds });
            if (res.status !== 'pass')
                p.push(`version ${v.versionId}: marked valid but ${res.errors.map((e) => e.code).join(',')}`);
            const sum = v.ingredients.reduce((s, i) => s + i.basisPoints, 0);
            if (sum !== TOTAL_BP)
                p.push(`version ${v.versionId}: bp sum ${sum}`);
        }
    }
    for (const r of b.recipes) {
        if (!versionIds.has(r.headVersionId))
            p.push(`recipe ${r.recipeId}: head ${r.headVersionId} missing`);
        if (!r.versionIds.includes(r.headVersionId))
            p.push(`recipe ${r.recipeId}: head not in versionIds`);
        for (const vid of r.versionIds)
            if (versionsById.get(vid)?.recipeId !== r.recipeId)
                p.push(`recipe ${r.recipeId}: version ${vid} belongs elsewhere`);
    }
    for (const a of b.assessments) {
        if (a.recipeVersionId !== null && a.legacyAttributionStatus !== 'exact_version_verified')
            p.push(`assessment ${a.assessmentId}: recipeVersionId set without exact verification`);
        if (a.legacyAttributionStatus === 'exact_version_verified') {
            if (a.provenance === 'legacy_import')
                p.push(`assessment ${a.assessmentId}: legacy import cannot be exact_version_verified`);
            if (!a.recipeVersionId || !versionIds.has(a.recipeVersionId))
                p.push(`assessment ${a.assessmentId}: exact version missing`);
        }
        for (const c of a.candidateVersionIds)
            if (!versionIds.has(c))
                p.push(`assessment ${a.assessmentId}: candidate ${c} missing`);
        if (a.rating !== null && !(Number.isInteger(a.rating) && a.rating >= 1 && a.rating <= 5))
            p.push(`assessment ${a.assessmentId}: rating out of range`);
        if (a.legacyAutoAdvice && a.legacyAutoAdvice.usage !== 'excluded')
            p.push(`assessment ${a.assessmentId}: legacy advice must be excluded`);
    }
    for (const s of b.sessions)
        for (const c of s.candidateVersionIds)
            if (!versionIds.has(c))
                p.push(`session ${s.sessionId}: candidate ${c} missing`);
    for (const c of b.claims) {
        if (c.verificationStatus === 'verified' && (NON_VERIFYING.has(c.sourceType) || !/^https?:\/\//.test(c.sourceRef ?? ''))) {
            p.push(`claim ${c.claimId}: verified without an independent URL source`);
        }
        if (c.safetySensitive && c.usage !== 'excluded')
            p.push(`claim ${c.claimId}: safety-sensitive claim must be excluded`);
        if (c.conflicting && c.usage !== 'excluded')
            p.push(`claim ${c.claimId}: conflicting claim must be excluded`);
        if (c.sourceType === 'LEGACY_UNVERIFIED' && c.usage === 'structural')
            p.push(`claim ${c.claimId}: legacy claim cannot be structural (no hard veto)`);
        if (c.verificationStatus === 'verified' && /^language_model[:]/.test(c.reviewerOrProcess))
            p.push(`claim ${c.claimId}: a language model cannot verify`);
    }
    p.push(...claimVersioningProblems(b.claims));
    try {
        for (const bal of deriveBalances(b.inventoryEvents).values()) {
            if (!Number.isSafeInteger(bal.availableMg))
                p.push(`inventory ${bal.flavorId}: non-integer balance`);
        }
    }
    catch (e) {
        p.push(`inventory: ${e.message}`);
    }
    const s = b.settings;
    for (const k of ['bowlCapacityMg', 'defaultGramsTotalMg', 'defaultPackMg'])
        if (!Number.isSafeInteger(s[k]) || s[k] <= 0)
            p.push(`settings.${k} invalid`);
    return p;
}
