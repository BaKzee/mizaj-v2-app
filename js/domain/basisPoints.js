/**
 * Integer basis-point arithmetic (1% = 100 bp, a full recipe = 10 000 bp).
 *
 * Rules (MIGRATION §3, ENGINE §4.6):
 *  - stored proportions are positive integers summing to exactly 10 000;
 *  - conversion from legacy percentages is EXACT or it is reported — never silently rounded;
 *  - normalisation (for newly generated weights, P2) uses the largest-remainder
 *    method with a deterministic tie-break, so there is no rounding drift.
 */
export const TOTAL_BP = 10_000;
/** Convert a legacy percentage to bp only if it is exactly representable (≤ 2 decimals). */
export function pctToBpExact(pct) {
    if (typeof pct !== 'number' || !Number.isFinite(pct))
        return { ok: false, reason: 'not_a_finite_number', raw: pct };
    const scaled = pct * 100;
    const rounded = Math.round(scaled);
    if (Math.abs(scaled - rounded) > 1e-9)
        return { ok: false, reason: 'not_representable_in_bp', raw: pct };
    return { ok: true, bp: rounded };
}
export function bpToPctString(bp) {
    const sign = bp < 0 ? '-' : '';
    const abs = Math.abs(bp);
    const whole = Math.floor(abs / 100);
    const frac = abs % 100;
    return frac === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}
/**
 * Largest-remainder apportionment of TOTAL_BP across non-negative weights.
 * Deterministic: ties broken by larger weight, then by key (lexicographic).
 * Every input with weight > 0 receives at least 1 bp when TOTAL_BP permits;
 * zero weights receive 0 bp and are reported by the caller if relevant.
 */
export function apportionBp(items) {
    if (items.length === 0)
        throw new RangeError('apportionBp: no items');
    const seen = new Set();
    for (const it of items) {
        if (seen.has(it.key))
            throw new RangeError(`apportionBp: duplicate key ${it.key}`);
        seen.add(it.key);
        if (!Number.isFinite(it.weight) || it.weight < 0)
            throw new RangeError(`apportionBp: invalid weight for ${it.key}`);
    }
    const sum = items.reduce((s, it) => s + it.weight, 0);
    if (sum <= 0)
        throw new RangeError('apportionBp: weights sum to zero');
    const shares = items.map((it) => {
        const exact = (it.weight / sum) * TOTAL_BP;
        const floor = Math.floor(exact);
        return { key: it.key, weight: it.weight, floor, rem: exact - floor };
    });
    let assigned = shares.reduce((s, x) => s + x.floor, 0);
    const order = [...shares].sort((a, b) => b.rem - a.rem || b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    let i = 0;
    while (assigned < TOTAL_BP) {
        order[i % order.length].floor += 1;
        assigned += 1;
        i += 1;
    }
    const out = new Map();
    for (const s of shares)
        out.set(s.key, s.floor);
    return out;
}
