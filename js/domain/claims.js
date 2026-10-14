import { SCHEMA_VERSION } from "./types.js";
import { contentId } from "./hash.js";
import { isSafetySensitive } from "./vocabulary.js";
/** Sources that can never justify `verified` on their own. */
const NON_VERIFYING_SOURCES = new Set(['LEGACY_UNVERIFIED', 'MODEL_INFERENCE', 'UNKNOWN']);
export function makeClaim(input) {
    const status = input.verificationStatus ?? 'unverified';
    if (status === 'verified') {
        throw new Error('makeClaim: claims are created unverified/plausible; use verifyClaim() with a checked source');
    }
    const textForSafety = typeof input.claimValue === 'string' ? input.claimValue : JSON.stringify(input.claimValue ?? '') + ' ' + (input.methodOrExcerpt ?? '');
    const safetySensitive = input.safetySensitive ?? isSafetySensitive(textForSafety);
    const conflicting = input.conflicting ?? false;
    // Policy (rule 12, CORE §6/§11): heat/coal text and self-contradicting legacy data are audit-only.
    const usage = safetySensitive || conflicting ? 'excluded' : input.usage;
    const validityNotes = [...(input.validityNotes ?? [])];
    if (safetySensitive && input.usage !== 'excluded')
        validityNotes.push('Auto-excluded: mentions heat/coal/temperature (rule 12).');
    return {
        schemaVersion: SCHEMA_VERSION,
        claimId: contentId('cl', { t: input.claimType, e: input.entityType, id: input.entityId, p: input.property, s: input.sourceRef }),
        claimType: input.claimType,
        entityType: input.entityType,
        entityId: input.entityId,
        property: input.property,
        claimValue: input.claimValue,
        unit: input.unit ?? null,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        retrievedAt: input.retrievedAt ?? null,
        methodOrExcerpt: input.methodOrExcerpt ?? null,
        validityNotes,
        verificationStatus: status,
        reviewerOrProcess: input.reviewerOrProcess,
        safetySensitive,
        usage,
        conflicting,
        claimVersion: 1,
        supersedesClaimId: null,
    };
}
/**
 * Claim versioning: claims are never edited in place. A revision is a NEW claim
 * (claimVersion + 1) that names the claim it supersedes. The id of a revision is
 * content-addressed from the previous id, the new version number and the decision it
 * records, so applying the same review twice yields the same id (idempotent).
 */
export function reviseClaim(previous, changes) {
    const claimVersion = previous.claimVersion + 1;
    const merged = { ...previous, ...changes };
    if (merged.safetySensitive || merged.conflicting)
        merged.usage = 'excluded';
    const next = {
        ...merged,
        // Content-addressed from the predecessor, the version and what the revision decides,
        // so the same review applied twice gives the same id and different decisions differ.
        claimId: contentId('cl', { prev: previous.claimId, v: claimVersion, s: merged.verificationStatus, u: merged.usage, r: merged.reviewerOrProcess, src: merged.sourceRef }),
        claimVersion,
        supersedesClaimId: previous.claimId,
    };
    return next;
}
/** Claims that no other claim supersedes (the current view). Input order is preserved. */
export function currentClaims(claims) {
    const superseded = new Set(claims.map((c) => c.supersedesClaimId).filter((x) => x !== null));
    return claims.filter((c) => !superseded.has(c.claimId));
}
/**
 * Structural checks on a set of claims with revisions: a revision points at an
 * existing claim of the previous version about the same thing, and a claim is
 * superseded at most once (no forks). Returns human-readable problems.
 */
export function claimVersioningProblems(claims) {
    const p = [];
    const byId = new Map(claims.map((c) => [c.claimId, c]));
    const supersededBy = new Map();
    for (const c of claims) {
        if (c.supersedesClaimId === null) {
            if (c.claimVersion !== 1)
                p.push(`claim ${c.claimId}: version ${c.claimVersion} without a predecessor`);
            continue;
        }
        const prev = byId.get(c.supersedesClaimId);
        if (!prev) {
            p.push(`claim ${c.claimId}: supersedes missing claim ${c.supersedesClaimId}`);
            continue;
        }
        if (c.claimVersion !== prev.claimVersion + 1)
            p.push(`claim ${c.claimId}: version must be predecessor + 1`);
        if (c.entityId !== prev.entityId || c.property !== prev.property || c.claimType !== prev.claimType)
            p.push(`claim ${c.claimId}: a revision must be about the same entity/property/type`);
        const other = supersededBy.get(prev.claimId);
        if (other)
            p.push(`claim ${prev.claimId}: superseded twice (${other}, ${c.claimId})`);
        supersededBy.set(prev.claimId, c.claimId);
    }
    return p;
}
/**
 * Some claim types can only be verified by one kind of source: a product description
 * needs the manufacturer, an exact formula needs a published formula. A general
 * method paper can never verify a product-level statement.
 */
export function requiredSourceKind(claimType) {
    if (claimType.startsWith('manufacturer_description'))
        return 'MANUFACTURER_DESCRIPTION';
    if (claimType.startsWith('published_formula'))
        return 'PUBLISHED_FORMULA';
    return null;
}
export function verificationBlockers(req) {
    const out = [];
    if (!req.source)
        return ['no_source'];
    if (!req.source.url)
        out.push('source_has_no_url');
    if (req.source.auditStatus !== 'link_checked')
        out.push('source_not_link_checked');
    if (NON_VERIFYING_SOURCES.has(req.source.kind))
        out.push('source_type_cannot_verify');
    const required = requiredSourceKind(req.claim.claimType);
    if (required && req.source.kind !== required)
        out.push('source_kind_not_valid_for_claim_type');
    if (req.reviewer.kind === 'language_model')
        out.push('reviewer_is_language_model');
    if (req.claim.conflicting)
        out.push('claim_is_conflicting');
    return out;
}
/** Returns a NEW verified revision of the claim (it supersedes the input), or throws with the list of blockers. */
export function verifyClaim(req) {
    const blockers = verificationBlockers(req);
    if (blockers.length)
        throw new Error(`verifyClaim blocked: ${blockers.join(', ')}`);
    return reviseClaim(req.claim, {
        sourceType: req.source.kind,
        sourceRef: req.source.url,
        retrievedAt: req.retrievedAt,
        verificationStatus: 'verified',
        reviewerOrProcess: `${req.reviewer.kind}:${req.reviewer.id}`,
    });
}
/** An explicit human rejection is also a revision; the rejected claim stays on record. */
export function rejectClaim(claim, reviewer, reason) {
    return reviseClaim(claim, {
        verificationStatus: 'rejected',
        usage: 'excluded',
        reviewerOrProcess: `${reviewer.kind}:${reviewer.id}`,
        validityNotes: [...claim.validityNotes, `Rejected by reviewer: ${reason}`],
    });
}
