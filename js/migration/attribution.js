export const HOUR_MS = 3_600_000;
/** A day-precision timestamp can be off by up to a day plus timezone skew. */
export const DATE_ONLY_AMBIGUITY_MS = 36 * HOUR_MS;
/**
 * v1 writes day-only dates as local noon (index.html L4031, L4074), which lands
 * exactly on an hour boundary with 0 ms. A live Date.now() does so with
 * probability 1/3.6e6, so this is a reliable — but still inferred — signal.
 */
export function timestampPrecision(ts) {
    return Number.isSafeInteger(ts) && ts % HOUR_MS === 0 ? 'date_only_presumed' : 'ms';
}
export function isValidTs(ts) {
    return typeof ts === 'number' && Number.isSafeInteger(ts) && ts > 0;
}
export function attributeByTime(ts, timeline) {
    if (!timeline)
        return { status: 'unattributed', basis: 'orphan_recipe_key', candidates: [] };
    if (!isValidTs(ts)) {
        const all = [timeline.originalVersionId, ...(timeline.latestEdit ? [timeline.latestEdit.versionId] : [])];
        return { status: 'unattributed', basis: 'invalid_timestamp', candidates: all };
    }
    const edit = timeline.latestEdit;
    if (!edit)
        return { status: 'uncertain', basis: 'no_edit_on_record', candidates: [timeline.originalVersionId] };
    if (timestampPrecision(ts) === 'date_only_presumed' && Math.abs(ts - edit.ts) < DATE_ONLY_AMBIGUITY_MS) {
        const both = ts < edit.ts ? [timeline.originalVersionId, edit.versionId] : [edit.versionId, timeline.originalVersionId];
        return { status: 'unattributed', basis: 'date_only_near_edit', candidates: both };
    }
    if (ts < edit.ts)
        return { status: 'unattributed', basis: 'pre_latest_edit', candidates: [timeline.originalVersionId] };
    return { status: 'uncertain', basis: 'post_latest_edit_no_snapshot', candidates: [edit.versionId] };
}
