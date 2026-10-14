export function evidenceForVersion(versionId, assessments) {
    const out = { versionId, verified: [], probable: [], ambiguous: [] };
    for (const a of assessments) {
        if (a.legacyAttributionStatus === 'exact_version_verified' && a.recipeVersionId === versionId) {
            out.verified.push(a.assessmentId);
        }
        else if (a.legacyAttributionStatus === 'uncertain' && a.candidateVersionIds.length === 1 && a.candidateVersionIds[0] === versionId) {
            out.probable.push(a.assessmentId);
        }
        else if (a.candidateVersionIds.includes(versionId)) {
            out.ambiguous.push(a.assessmentId);
        }
    }
    return out;
}
/** Ratings that may be shown as "recorded for this exact formula (probable)". */
export function probableRatings(versionId, assessments) {
    const ids = new Set(evidenceForVersion(versionId, assessments).probable);
    return assessments.filter((a) => ids.has(a.assessmentId) && a.rating !== null).map((a) => a.rating);
}
