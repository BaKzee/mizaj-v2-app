var _a;
import { SCHEMA_VERSION } from "../domain/types.js";
import { validateBundleInvariants } from "./invariants.js";
import { entryShapeProblems, JournalError, mergeJournal, sortEntries } from "./journal.js";
export const V2_DB_NAME = 'mizaj-v2';
export const LEGACY_DB_NAME = 'mizaj';
export const LEGACY_STORE = 'kv';
export const LEGACY_KEY = 'mizaj:state';
export const COLLECTION_KEYS = {
    flavors: 'id',
    claims: 'claimId',
    sources: 'sourceId',
    recipes: 'recipeId',
    recipeVersions: 'versionId',
    assessments: 'assessmentId',
    sessions: 'sessionId',
    inventoryEvents: 'eventId',
};
export const COLLECTIONS = Object.keys(COLLECTION_KEYS);
/** Singletons the UI may write. Everything else is written only by importBundle. */
export const WRITABLE_SINGLETONS = ['knowledgePack', 'uiPrefs'];
export const BUNDLE_SINGLETONS = ['settings', 'legacyLayout', 'catalogExtras', 'migrationLog', 'source'];
export function bundleShape(b) {
    const order = Object.fromEntries(COLLECTIONS.map((c) => [c, b[c].map((r) => String(r[COLLECTION_KEYS[c]]))]));
    return { engineVersion: b.engineVersion, createdAt: b.createdAt, order };
}
/** Rebuild a bundle from stored records; records missing from `order` (should not happen) are appended sorted by key. */
export function assembleBundle(shape, records, singletons) {
    const out = { format: 'mizaj-v2-bundle', schemaVersion: SCHEMA_VERSION, engineVersion: shape.engineVersion, createdAt: shape.createdAt };
    for (const c of COLLECTIONS) {
        const m = records[c];
        const listed = shape.order[c].filter((id) => m.has(id));
        const extra = [...m.keys()].filter((id) => !shape.order[c].includes(id)).sort();
        out[c] = [...listed, ...extra].map((id) => m.get(id));
    }
    for (const s of BUNDLE_SINGLETONS)
        out[s] = singletons.get(s);
    return out;
}
export function assertWritableSingleton(name) {
    if (!WRITABLE_SINGLETONS.includes(name))
        throw new StoreError('singleton_read_only', `${name} is written only by an import`);
}
export function assertEntry(entry) {
    const p = entryShapeProblems(entry);
    if (p.length)
        throw new JournalError('malformed_entry', p.join(', '));
}
export class StoreError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'StoreError';
        this.code = code;
    }
}
/** Validate before any write; throws StoreError('invalid_bundle') with the first problems. */
export function preflight(bundle) {
    const problems = validateBundleInvariants(bundle);
    if (problems.length)
        throw new StoreError('invalid_bundle', problems.slice(0, 10).join('; '));
}
/**
 * In-memory store with the same transactional semantics as the IndexedDB store.
 * Used by Node tests and as a fallback when IndexedDB is unavailable (the UI must
 * then warn that data will not persist, as v1 does).
 */
export class MemoryStore {
    name = 'memory';
    #state = _a.empty();
    /** Test hook: throw after N record writes to prove atomicity. */
    failAfterWrites = null;
    static empty() {
        const collections = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
        return { collections, singletons: new Map(), migrationHistory: [] };
    }
    async importBundle(bundle) {
        preflight(bundle);
        const prevLog = this.#state.singletons.get('migrationLog');
        const alreadyPresent = prevLog?.migrationId === bundle.migrationLog.migrationId;
        // Work on a copy; swap only at the end (commit). Any throw leaves #state untouched.
        const next = {
            collections: Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()])),
            singletons: new Map(this.#state.singletons),
            migrationHistory: [...this.#state.migrationHistory],
        };
        let writes = 0;
        const written = Object.fromEntries(COLLECTIONS.map((c) => [c, 0]));
        for (const c of COLLECTIONS) {
            const keyField = COLLECTION_KEYS[c];
            for (const rec of bundle[c]) {
                if (this.failAfterWrites !== null && writes >= this.failAfterWrites)
                    throw new StoreError('injected_failure', `failure injected after ${writes} writes`);
                next.collections[c].set(String(rec[keyField]), structuredClone(rec));
                written[c] += 1;
                writes += 1;
            }
        }
        for (const s of BUNDLE_SINGLETONS)
            next.singletons.set(s, structuredClone(bundle[s]));
        next.singletons.set('bundleShape', bundleShape(bundle));
        if (!alreadyPresent)
            next.migrationHistory.push(structuredClone(bundle.migrationLog));
        this.#state = next; // commit (the journal is a separate structure and is never touched here)
        return { migrationId: bundle.migrationLog.migrationId, written, alreadyPresent };
    }
    async count(c) { return this.#state.collections[c].size; }
    async get(c, id) { return structuredClone(this.#state.collections[c].get(id)); }
    async getSingleton(name) { return structuredClone(this.#state.singletons.get(name)); }
    async migrationHistory() { return structuredClone(this.#state.migrationHistory); }
    #journal = [];
    async exportBundle() {
        const shape = this.#state.singletons.get('bundleShape');
        if (!shape)
            return null;
        return structuredClone(assembleBundle(shape, this.#state.collections, this.#state.singletons));
    }
    async readJournal() { return structuredClone(sortEntries(this.#journal)); }
    async appendJournal(entry) {
        assertEntry(entry);
        if (this.#journal.some((e) => e.entryId === entry.entryId))
            throw new StoreError('duplicate_entry', `entry ${entry.entryId} already recorded`);
        if (this.#journal.some((e) => e.seq === entry.seq))
            throw new StoreError('duplicate_seq', `seq ${entry.seq} already used`);
        this.#journal = [...this.#journal, structuredClone(entry)];
    }
    async mergeJournal(entries) {
        for (const e of entries)
            assertEntry(e);
        const m = mergeJournal(this.#journal, entries);
        this.#journal = structuredClone(m.merged);
        return { added: m.added, skipped: m.skipped };
    }
    async putSingleton(name, value) {
        assertWritableSingleton(name);
        this.#state.singletons.set(name, structuredClone(value));
    }
}
_a = MemoryStore;
