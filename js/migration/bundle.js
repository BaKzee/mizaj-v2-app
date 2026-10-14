import { SCHEMA_VERSION } from "../domain/types.js";
import { sha256Hex } from "../domain/hash.js";
import { safeJsonParse, UnsafeInputError } from "../domain/sanitize.js";
const FORMAT = 'mizaj-v2-bundle';
const SINGLETONS = ['source', 'settings', 'legacyLayout', 'catalogExtras', 'migrationLog'];
const COLLECTIONS = ['sources', 'flavors', 'claims', 'recipes', 'recipeVersions', 'assessments', 'sessions', 'inventoryEvents'];
export function serializeBundle(b) {
    const lines = [];
    for (const s of SINGLETONS)
        lines.push(JSON.stringify({ t: s, v: b[s] }));
    for (const c of COLLECTIONS)
        for (const rec of b[c])
            lines.push(JSON.stringify({ t: c, v: rec }));
    const payload = lines.join('\n');
    const counts = Object.fromEntries(COLLECTIONS.map((c) => [c, b[c].length]));
    const header = {
        format: FORMAT, schemaVersion: SCHEMA_VERSION, engineVersion: b.engineVersion, createdAt: b.createdAt,
        payloadSha256: sha256Hex(payload), counts,
    };
    return `${JSON.stringify(header)}\n${payload}\n`;
}
export function parseBundle(text, maxBytes = 100 * 1024 * 1024) {
    if (typeof text !== 'string')
        throw new UnsafeInputError('not_text', 'bundle is not text');
    if (new TextEncoder().encode(text).length > maxBytes)
        throw new UnsafeInputError('too_large', 'bundle too large');
    const body = text.endsWith('\n') ? text.slice(0, -1) : text;
    const nl = body.indexOf('\n');
    if (nl < 0)
        throw new UnsafeInputError('bad_bundle', 'missing payload');
    const header = safeJsonParse(body.slice(0, nl));
    if (header.format !== FORMAT)
        throw new UnsafeInputError('bad_bundle', 'not a MIZAJ v2 bundle');
    if (header.schemaVersion !== SCHEMA_VERSION)
        throw new UnsafeInputError('unsupported_schema', `bundle schema ${String(header.schemaVersion)}`);
    const payload = body.slice(nl + 1);
    if (sha256Hex(payload) !== header.payloadSha256)
        throw new UnsafeInputError('integrity', 'payload checksum mismatch (file corrupted or edited)');
    const out = { format: FORMAT, schemaVersion: SCHEMA_VERSION, engineVersion: header.engineVersion, createdAt: header.createdAt };
    for (const c of COLLECTIONS)
        out[c] = [];
    const seenSingletons = new Set();
    for (const [i, line] of payload.split('\n').entries()) {
        const rec = safeJsonParse(line);
        const t = rec?.t;
        if (typeof t !== 'string')
            throw new UnsafeInputError('bad_bundle', `line ${i + 2}: record without type`);
        if (SINGLETONS.includes(t)) {
            if (seenSingletons.has(t))
                throw new UnsafeInputError('bad_bundle', `duplicate section ${t}`);
            seenSingletons.add(t);
            out[t] = rec.v;
        }
        else if (COLLECTIONS.includes(t)) {
            out[t].push(rec.v);
        }
        else {
            throw new UnsafeInputError('bad_bundle', `line ${i + 2}: unknown record type ${t}`);
        }
    }
    for (const s of SINGLETONS)
        if (!seenSingletons.has(s))
            throw new UnsafeInputError('bad_bundle', `missing section ${s}`);
    for (const c of COLLECTIONS) {
        if (out[c].length !== header.counts?.[c])
            throw new UnsafeInputError('integrity', `count mismatch for ${c}`);
    }
    return upgradeP0Fields(out);
}
/**
 * Read-time upgrade of bundles written by 2.0.0-p0 (same schemaVersion 2): P1 only
 * ADDED fields, so missing ones get their neutral defaults. The checksum was verified
 * on the original text above; nothing is written back. Present values are never changed.
 */
export function upgradeP0Fields(b) {
    for (const c of b.claims) {
        const r = c;
        if (!('claimVersion' in r))
            r['claimVersion'] = 1;
        if (!('supersedesClaimId' in r))
            r['supersedesClaimId'] = null;
    }
    for (const s of b.sources) {
        const r = s;
        if (!('publisherRole' in r))
            r['publisherRole'] = null;
    }
    const log = b.migrationLog;
    if (log && !('resolvedReviewItems' in log))
        log['resolvedReviewItems'] = [];
    return b;
}
