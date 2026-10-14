import { SCHEMA_VERSION } from "./types.js";
import { contentId } from "./hash.js";
import { deepFreeze } from "./recipeVersion.js";
export class LedgerError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'LedgerError';
        this.code = code;
    }
}
function emptyBalance(flavorId) {
    return {
        flavorId,
        availableMg: 0,
        consumedSinceOpeningMg: 0,
        legacyUsedTotalMg: null,
        purchasedSinceOpeningMg: 0,
        correctionsCount: 0,
        anomalies: [],
    };
}
function assertInt(v, name, allowNegative) {
    if (v === null || !Number.isSafeInteger(v))
        throw new LedgerError('bad_quantity', `${name} must be an integer number of mg`);
    if (!allowNegative && v < 0)
        throw new LedgerError('bad_quantity', `${name} must be ≥ 0`);
    return v;
}
/** Apply one event to a balance (pure). Throws LedgerError on invalid events. */
export function applyEvent(balance, ev, allowShortfall = false) {
    if (ev.flavorId !== balance.flavorId)
        throw new LedgerError('flavor_mismatch', 'event belongs to another flavor');
    const b = { ...balance, anomalies: [...balance.anomalies] };
    switch (ev.type) {
        case 'opening_snapshot': {
            b.availableMg = assertInt(ev.balanceMg, 'balanceMg', false);
            const used = ev.legacyRaw && typeof ev.legacyRaw['usedG'] === 'number' ? Math.round(ev.legacyRaw['usedG'] * 1000) : null;
            b.legacyUsedTotalMg = used;
            b.consumedSinceOpeningMg = 0;
            b.purchasedSinceOpeningMg = 0;
            return b;
        }
        case 'purchase': {
            const d = assertInt(ev.deltaMg, 'deltaMg', false);
            if (d === 0)
                throw new LedgerError('bad_quantity', 'purchase must add a positive amount');
            b.availableMg += d;
            b.purchasedSinceOpeningMg += d;
            return b;
        }
        case 'consume':
        case 'waste':
        case 'refund': {
            const d = assertInt(ev.deltaMg, 'deltaMg', true);
            if (d >= 0)
                throw new LedgerError('bad_quantity', `${ev.type} must have a negative deltaMg`);
            if (b.availableMg + d < 0) {
                if (!allowShortfall) {
                    throw new LedgerError('overdraw', `${ev.type} of ${-d} mg exceeds available ${b.availableMg} mg for ${ev.flavorId}`);
                }
                b.anomalies.push(`shortfall:${ev.eventId}:${-(b.availableMg + d)}mg`);
            }
            b.availableMg += d;
            if (ev.type === 'consume')
                b.consumedSinceOpeningMg += -d;
            if (ev.type === 'refund')
                b.purchasedSinceOpeningMg += d;
            return b;
        }
        case 'correction': {
            // Re-base only. Consumption history is NOT rewritten (v1 defect at index.html L4238).
            b.availableMg = assertInt(ev.balanceMg, 'balanceMg', false);
            b.correctionsCount += 1;
            return b;
        }
        default: {
            const never = ev.type;
            throw new LedgerError('unknown_event', `unknown event type ${String(never)}`);
        }
    }
}
export function sortEvents(events) {
    return [...events].sort((a, b) => a.seq - b.seq || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
}
/** Replay a ledger into per-flavor balances. Shortfalls already in the ledger are reported, not re-rejected. */
export function deriveBalances(events) {
    const out = new Map();
    const seqs = new Set();
    for (const ev of sortEvents(events)) {
        if (seqs.has(ev.seq))
            throw new LedgerError('duplicate_seq', `duplicate seq ${ev.seq}`);
        seqs.add(ev.seq);
        const cur = out.get(ev.flavorId) ?? emptyBalance(ev.flavorId);
        out.set(ev.flavorId, applyEvent(cur, ev, true));
    }
    return out;
}
/**
 * Append a validated event. Returns a NEW array (the input ledger is not mutated).
 * Overdraw is rejected unless `allowShortfall` is true.
 */
export function appendEvent(events, input, opts = {}) {
    const nextSeq = events.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
    const ev = deepFreeze({
        schemaVersion: SCHEMA_VERSION,
        eventId: contentId('ie', { seq: nextSeq, flavorId: input.flavorId, type: input.type, at: input.at, deltaMg: input.deltaMg ?? null, balanceMg: input.balanceMg ?? null }),
        flavorId: input.flavorId,
        seq: nextSeq,
        type: input.type,
        at: input.at,
        deltaMg: input.deltaMg ?? null,
        balanceMg: input.balanceMg ?? null,
        batchId: input.batchId ?? null,
        packMg: input.packMg ?? null,
        cost: input.cost ?? null,
        sessionId: input.sessionId ?? null,
        recipeVersionId: input.recipeVersionId ?? null,
        note: input.note ?? null,
        legacyRaw: null,
    });
    const current = deriveBalances(events).get(input.flavorId) ?? emptyBalance(input.flavorId);
    applyEvent(current, ev, opts.allowShortfall ?? false); // throws on invalid / overdraw
    return [...events, ev];
}
/** Purchase helper: a new physical package of a flavor, added (never "set to pack"). */
export function recordPurchase(events, p) {
    const batchId = contentId('batch', { flavorId: p.flavorId, at: p.at, netMg: p.netMg, n: events.length });
    return appendEvent(events, { flavorId: p.flavorId, type: 'purchase', at: p.at, deltaMg: p.netMg, packMg: p.netMg, batchId, cost: p.cost ?? null, note: p.note ?? null });
}
/** Weighted average cost per gram over purchases with a known cost (null when unknown). */
export function costPerGram(events, flavorId) {
    let mg = 0;
    let amount = 0;
    let currency;
    for (const e of events) {
        if (e.flavorId !== flavorId || e.type !== 'purchase' || !e.cost || e.deltaMg === null)
            continue;
        if (currency !== undefined && currency !== e.cost.currency)
            return null; // mixed currencies: refuse to average
        currency = e.cost.currency;
        mg += e.deltaMg;
        amount += e.cost.amount;
    }
    if (mg === 0 || currency === undefined)
        return null;
    return { amountPerGram: (amount / mg) * 1000, currency };
}
