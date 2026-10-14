/**
 * Owner decisions (MIGRATION §4.8 "consent before correction").
 *
 * A decision is the owner's explicit answer to a review question, recorded
 * verbatim with date and channel. Decisions may CLOSE review items; they never
 * rewrite user data by themselves. Only `decision`-severity items can be closed —
 * a `blocking` integrity problem cannot be waved through by a decision.
 */
import { safeJsonParse, UnsafeInputError } from "./sanitize.js";
export const OWNER_DECISIONS_SCHEMA = 'mizaj-owner-decisions@1';
export const DECISION_VALUES = {
    inventory_reconciliation: ['accept_current_balance', 'record_correction'],
    knowledge_audit_priority: ['most_used_first', 'by_brand_list'],
    /** Answer to an identity question about ONE library product (P1 review queue). */
    product_identity: ['same_as_observed_name', 'same_product_as_library_entry', 'keep_library_identity', 'not_same_product'],
    recipe_corpus_scope: ['expand_and_suggest_products', 'library_products_only'],
    /** Default product limit of the Precision generator (DECISIONS C-22). */
    precision_default_max_products: ['keep_5', 'set_3'],
};
export function parseOwnerDecisions(text) {
    const o = safeJsonParse(text);
    if (o?.schema !== OWNER_DECISIONS_SCHEMA || !Array.isArray(o.decisions)) {
        throw new UnsafeInputError('bad_decisions', `expected ${OWNER_DECISIONS_SCHEMA}`);
    }
    const ids = new Set();
    for (const d of o.decisions) {
        if (typeof d?.decisionId !== 'string' || !d.decisionId)
            throw new UnsafeInputError('bad_decisions', 'decision without id');
        if (ids.has(d.decisionId))
            throw new UnsafeInputError('bad_decisions', `duplicate decision ${d.decisionId}`);
        ids.add(d.decisionId);
        if (d.decidedBy !== 'owner')
            throw new UnsafeInputError('bad_decisions', `${d.decisionId}: only the owner can decide`);
        if (!/^\d{4}-\d{2}-\d{2}/.test(String(d.decidedAt)))
            throw new UnsafeInputError('bad_decisions', `${d.decisionId}: decidedAt must be a date`);
        const allowed = DECISION_VALUES[d.topic];
        if (!allowed)
            throw new UnsafeInputError('bad_decisions', `${d.decisionId}: unknown topic ${String(d.topic)}`);
        if (!allowed.includes(d.value))
            throw new UnsafeInputError('bad_decisions', `${d.decisionId}: value ${d.value} not allowed for ${d.topic}`);
        if (!d.scope || !Array.isArray(d.scope.flavorIds))
            throw new UnsafeInputError('bad_decisions', `${d.decisionId}: scope.flavorIds missing`);
        if (typeof d.statement !== 'string' || !d.statement.trim())
            throw new UnsafeInputError('bad_decisions', `${d.decisionId}: the owner's statement must be recorded`);
        if (d.topic === 'product_identity') {
            if (d.scope.flavorIds.length !== 1)
                throw new UnsafeInputError('bad_decisions', `${d.decisionId}: an identity answer is about exactly one product`);
            if (!/^cl_[0-9a-f]{20}$/.test(String(d.details?.claimId)))
                throw new UnsafeInputError('bad_decisions', `${d.decisionId}: identity answer must name the identity claim it answers`);
            if (d.value === 'same_as_observed_name' && !d.details?.observedName?.trim())
                throw new UnsafeInputError('bad_decisions', `${d.decisionId}: observedName required`);
            if (d.value === 'same_product_as_library_entry' && !d.details?.sameAsFlavorId)
                throw new UnsafeInputError('bad_decisions', `${d.decisionId}: sameAsFlavorId required`);
            if (d.details?.sameAsFlavorId === d.scope.flavorIds[0])
                throw new UnsafeInputError('bad_decisions', `${d.decisionId}: a product cannot be the same as itself`);
        }
    }
    return o;
}
/** Leading `flavorId:` of a review detail, as written by the migration. */
function detailFlavorId(detail) {
    const m = /^([a-z0-9][a-z0-9-]*):/.exec(detail);
    return m ? m[1] : null;
}
/**
 * Close `decision`-severity review items covered by an owner decision. Returns new
 * objects (inputs untouched). Blocking items are never closed.
 */
export function applyOwnerDecisions(items, decisions) {
    if (!decisions)
        return items.map((i) => ({ ...i }));
    return items.map((item) => {
        if (item.severity !== 'decision')
            return { ...item };
        const fid = detailFlavorId(item.detail);
        const d = decisions.decisions.find((x) => x.scope.reviewCode === item.code && fid !== null && x.scope.flavorIds.includes(fid));
        if (!d)
            return { ...item };
        return { ...item, severity: 'info', resolvedBy: { decisionId: d.decisionId, value: d.value } };
    });
}
/** Latest identity answer per identity claim id. */
export function identityAnswers(decisions) {
    const m = new Map();
    const ds = (decisions?.decisions ?? []).filter((d) => d.topic === 'product_identity').sort((a, b) => (a.decidedAt < b.decidedAt ? -1 : a.decidedAt > b.decidedAt ? 1 : a.decisionId < b.decisionId ? -1 : 1));
    for (const d of ds)
        m.set(d.details.claimId, d);
    return m;
}
export function decisionFor(decisions, topic) {
    return decisions?.decisions.filter((d) => d.topic === topic).sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1))[0] ?? null;
}
