import { rejectClaim, requiredSourceKind, verificationBlockers, verifyClaim } from "../domain/claims.js";
import { contentId } from "../domain/hash.js";
import { safeJsonParse, UnsafeInputError } from "../domain/sanitize.js";
export const CLAIM_REVIEWS_SCHEMA = 'mizaj-claim-reviews@1';
export function reviewIdFor(r) {
    return contentId('rv', { c: r.claimId, a: r.action, k: r.reviewer.kind, i: r.reviewer.id, t: r.reviewedAt });
}
export function emptyReviews() {
    return { schema: CLAIM_REVIEWS_SCHEMA, reviews: [] };
}
export function parseClaimReviews(text) {
    const o = safeJsonParse(text);
    if (o?.schema !== CLAIM_REVIEWS_SCHEMA || !Array.isArray(o.reviews))
        throw new UnsafeInputError('bad_reviews', `expected ${CLAIM_REVIEWS_SCHEMA}`);
    const seen = new Set();
    for (const r of o.reviews) {
        if (!/^cl_[0-9a-f]{20}$/.test(String(r?.claimId)))
            throw new UnsafeInputError('bad_reviews', 'review without a valid claimId');
        if (r.action !== 'verify' && r.action !== 'reject')
            throw new UnsafeInputError('bad_reviews', `${r.claimId}: action must be verify|reject`);
        if (!r.reviewer || !['human', 'process', 'language_model'].includes(r.reviewer.kind) || !r.reviewer.id)
            throw new UnsafeInputError('bad_reviews', `${r.claimId}: reviewer missing`);
        if (!/^\d{4}-\d{2}-\d{2}/.test(String(r.reviewedAt)))
            throw new UnsafeInputError('bad_reviews', `${r.claimId}: reviewedAt must be a date`);
        if (r.reviewId !== reviewIdFor(r))
            throw new UnsafeInputError('bad_reviews', `${r.claimId}: reviewId does not match its content (edited record?)`);
        if (seen.has(r.reviewId))
            throw new UnsafeInputError('bad_reviews', `duplicate review ${r.reviewId}`);
        seen.add(r.reviewId);
    }
    return o;
}
/** Append new reviews; identical reviews (same id) are not duplicated. Never removes anything. */
export function appendReviews(existing, add) {
    const out = { schema: CLAIM_REVIEWS_SCHEMA, reviews: [...existing.reviews] };
    const ids = new Set(out.reviews.map((r) => r.reviewId));
    let added = 0;
    for (const r of add) {
        const full = { reviewId: reviewIdFor(r), ...r };
        if (ids.has(full.reviewId))
            continue;
        ids.add(full.reviewId);
        out.reviews.push(full);
        added++;
    }
    return { reviews: out, added };
}
/** Pick the source record a claim points to (by URL), preferring the kind its type requires. */
export function sourceForClaim(claim, sources) {
    if (!claim.sourceRef || !/^https:\/\//.test(claim.sourceRef))
        return null;
    const same = sources.filter((s) => s.url === claim.sourceRef);
    const req = requiredSourceKind(claim.claimType);
    return (req ? same.find((s) => s.kind === req && s.auditStatus === 'link_checked') : undefined)
        ?? same.find((s) => s.auditStatus === 'link_checked') ?? same[0] ?? null;
}
export function applyClaimReviews(claims, sources, reviews) {
    const out = [...claims];
    const byId = new Map(out.map((c) => [c.claimId, c]));
    const superseded = new Set(out.map((c) => c.supersedesClaimId).filter((x) => !!x));
    const res = { claims: out, applied: [], refused: [] };
    for (const r of reviews?.reviews ?? []) {
        const claim = byId.get(r.claimId);
        if (!claim) {
            res.refused.push({ reviewId: r.reviewId, action: r.action, claimId: r.claimId, reasons: ['unknown_claim'] });
            continue;
        }
        if (superseded.has(claim.claimId)) {
            res.refused.push({ reviewId: r.reviewId, action: r.action, claimId: r.claimId, reasons: ['claim_not_current'] });
            continue;
        }
        let next;
        if (r.action === 'verify') {
            if (claim.verificationStatus === 'verified') {
                res.refused.push({ reviewId: r.reviewId, action: r.action, claimId: r.claimId, reasons: ['already_verified'] });
                continue;
            }
            const req = { claim, source: sourceForClaim(claim, sources), reviewer: r.reviewer, retrievedAt: claim.retrievedAt ?? r.reviewedAt };
            const blockers = verificationBlockers(req);
            if (blockers.length) {
                res.refused.push({ reviewId: r.reviewId, action: r.action, claimId: r.claimId, reasons: blockers });
                continue;
            }
            next = verifyClaim(req);
            next = { ...next, validityNotes: [...next.validityNotes, `Owner review ${r.reviewId} on ${r.reviewedAt}${r.note ? `: ${r.note}` : ''}`] };
        }
        else {
            if (r.reviewer.kind !== 'human') {
                res.refused.push({ reviewId: r.reviewId, action: r.action, claimId: r.claimId, reasons: ['reviewer_must_be_human'] });
                continue;
            }
            next = rejectClaim(claim, { kind: 'human', id: r.reviewer.id }, r.note || 'rejected by owner');
        }
        out.push(next);
        byId.set(next.claimId, next);
        superseded.add(claim.claimId);
        res.applied.push({ reviewId: r.reviewId, action: r.action, fromClaimId: claim.claimId, toClaimId: next.claimId });
    }
    return res;
}
