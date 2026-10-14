import { assembleBundle, assertEntry, assertWritableSingleton, BUNDLE_SINGLETONS, bundleShape, COLLECTION_KEYS, COLLECTIONS, LEGACY_DB_NAME, LEGACY_KEY, LEGACY_STORE, StoreError, V2_DB_NAME, preflight } from "./store.js";
import { mergeJournal, sortEntries } from "./journal.js";
/** v1 → v2 of the v2 database adds the journal store (P3). Existing stores are never touched by an upgrade. */
const DB_VERSION = 2;
const SINGLETONS = 'singletons';
const HISTORY = 'migrationHistory';
const JOURNAL = 'journal';
function req(r) {
    return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function txDone(tx) {
    return new Promise((res, rej) => {
        tx.oncomplete = () => res();
        tx.onabort = () => rej(tx.error ?? new StoreError('aborted', 'transaction aborted'));
        tx.onerror = () => rej(tx.error);
    });
}
/**
 * Some embedded viewers (file previews inside apps, locked-down WebViews) accept `indexedDB.open`
 * but never fire any event, so awaiting it forever leaves the app on its loading screen.
 * After this long without an answer the open is abandoned and the app falls back to memory.
 */
export const IDB_OPEN_TIMEOUT_MS = 6000;
export function openV2Db(factory = indexedDB, name = V2_DB_NAME, timeoutMs = IDB_OPEN_TIMEOUT_MS) {
    if (name === LEGACY_DB_NAME)
        return Promise.reject(new StoreError('legacy_db_forbidden', 'v2 must never open the legacy database for writing'));
    return new Promise((res, rej) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            rej(new StoreError('db_timeout', 'التخزين لم يستجب (قد يكون هذا العارض لا يسمح بالتخزين)'));
        }, timeoutMs);
        const fail = (e) => { if (settled)
            return; settled = true; clearTimeout(timer); rej(e); };
        let r;
        try {
            r = factory.open(name, DB_VERSION);
        }
        catch (e) {
            fail(e);
            return;
        }
        r.onupgradeneeded = () => {
            const db = r.result;
            for (const c of COLLECTIONS)
                if (!db.objectStoreNames.contains(c))
                    db.createObjectStore(c, { keyPath: COLLECTION_KEYS[c] });
            if (!db.objectStoreNames.contains(SINGLETONS))
                db.createObjectStore(SINGLETONS);
            if (!db.objectStoreNames.contains(HISTORY))
                db.createObjectStore(HISTORY, { keyPath: 'migrationId' });
            if (!db.objectStoreNames.contains(JOURNAL))
                db.createObjectStore(JOURNAL, { keyPath: 'entryId' }).createIndex('seq', 'seq', { unique: true });
        };
        r.onblocked = () => fail(new StoreError('db_blocked', 'another tab keeps an older version of the database open'));
        r.onsuccess = () => {
            if (settled) {
                try {
                    r.result.close();
                }
                catch { /* answered too late; the app already runs from memory */ }
                return;
            }
            settled = true;
            clearTimeout(timer);
            res(r.result);
        };
        r.onerror = () => fail(r.error);
    });
}
export class IndexedDbStore {
    name = 'indexeddb';
    #db;
    /** Test hook: throw after N record writes to prove the transaction is atomic. */
    failAfterWrites = null;
    constructor(db) {
        if (db.name === LEGACY_DB_NAME)
            throw new StoreError('legacy_db_forbidden', 'refusing to wrap the legacy database');
        this.#db = db;
    }
    async importBundle(bundle) {
        preflight(bundle);
        const stores = [...COLLECTIONS, SINGLETONS, HISTORY];
        const tx = this.#db.transaction(stores, 'readwrite');
        const done = txDone(tx);
        const written = Object.fromEntries(COLLECTIONS.map((c) => [c, 0]));
        let alreadyPresent = false;
        try {
            const prev = (await req(tx.objectStore(SINGLETONS).get('migrationLog')));
            alreadyPresent = prev?.migrationId === bundle.migrationLog.migrationId;
            let writes = 0;
            for (const c of COLLECTIONS) {
                const os = tx.objectStore(c);
                os.clear(); // replace semantics for the legacy-derived dataset (same tx ⇒ atomic)
                for (const rec of bundle[c]) {
                    if (this.failAfterWrites !== null && writes >= this.failAfterWrites)
                        throw new StoreError('injected_failure', `failure injected after ${writes} writes`);
                    os.put(rec);
                    written[c] += 1;
                    writes += 1;
                }
            }
            const s = tx.objectStore(SINGLETONS);
            for (const k of BUNDLE_SINGLETONS)
                s.put(bundle[k], k);
            s.put(bundleShape(bundle), 'bundleShape');
            if (!alreadyPresent)
                tx.objectStore(HISTORY).put(bundle.migrationLog);
        }
        catch (e) {
            try {
                tx.abort();
            }
            catch { /* already finished */ }
            await done.catch(() => undefined);
            throw e;
        }
        await done;
        return { migrationId: bundle.migrationLog.migrationId, written, alreadyPresent };
    }
    async count(c) {
        return req(this.#db.transaction(c).objectStore(c).count());
    }
    async get(c, id) {
        return req(this.#db.transaction(c).objectStore(c).get(id));
    }
    async getSingleton(name) {
        return req(this.#db.transaction(SINGLETONS).objectStore(SINGLETONS).get(name));
    }
    async migrationHistory() {
        return req(this.#db.transaction(HISTORY).objectStore(HISTORY).getAll());
    }
    async exportBundle() {
        const tx = this.#db.transaction([...COLLECTIONS, SINGLETONS], 'readonly');
        const shape = (await req(tx.objectStore(SINGLETONS).get('bundleShape')));
        if (!shape)
            return null;
        const records = {};
        for (const c of COLLECTIONS) {
            const all = (await req(tx.objectStore(c).getAll()));
            records[c] = new Map(all.map((r) => [String(r[COLLECTION_KEYS[c]]), r]));
        }
        const singletons = new Map();
        for (const k of BUNDLE_SINGLETONS)
            singletons.set(k, await req(tx.objectStore(SINGLETONS).get(k)));
        return assembleBundle(shape, records, singletons);
    }
    async readJournal() {
        return sortEntries((await req(this.#db.transaction(JOURNAL).objectStore(JOURNAL).getAll())));
    }
    /** `add` + a unique seq index: a duplicate entry or a racing tab fails instead of overwriting. */
    async appendJournal(entry) {
        assertEntry(entry);
        const tx = this.#db.transaction(JOURNAL, 'readwrite');
        const done = txDone(tx);
        tx.objectStore(JOURNAL).add(entry);
        try {
            await done;
        }
        catch (e) {
            const name = e?.name;
            throw new StoreError(name === 'ConstraintError' ? 'duplicate_entry' : 'journal_write_failed', `journal write failed: ${String(name ?? e)}`);
        }
    }
    /** Union by entry id in one transaction; nothing already stored is changed or removed. */
    async mergeJournal(entries) {
        for (const e of entries)
            assertEntry(e);
        const tx = this.#db.transaction(JOURNAL, 'readwrite');
        const done = txDone(tx);
        const os = tx.objectStore(JOURNAL);
        const existing = (await req(os.getAll()));
        const m = mergeJournal(existing, entries);
        const have = new Set(existing.map((e) => e.entryId));
        for (const e of m.merged)
            if (!have.has(e.entryId))
                os.add(e);
        await done;
        return { added: m.added, skipped: m.skipped };
    }
    async putSingleton(name, value) {
        assertWritableSingleton(name);
        const tx = this.#db.transaction(SINGLETONS, 'readwrite');
        const done = txDone(tx);
        tx.objectStore(SINGLETONS).put(value, name);
        await done;
    }
}
/**
 * Read the v1 state WITHOUT side effects: if the legacy database does not exist it
 * is not created (indexedDB.open would create it), and no write transaction is ever
 * started. Returns the stored object (v1 stores the state object directly, L1038).
 */
export async function readLegacyStateReadOnly(factory = indexedDB) {
    const list = typeof factory.databases === 'function' ? await factory.databases() : null;
    if (list && !list.some((d) => d.name === LEGACY_DB_NAME))
        return null;
    const db = await new Promise((res, rej) => {
        const r = factory.open(LEGACY_DB_NAME); // no version ⇒ no upgrade
        r.onupgradeneeded = () => { r.transaction?.abort(); rej(new StoreError('legacy_db_absent', 'legacy database does not exist')); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
    try {
        if (!db.objectStoreNames.contains(LEGACY_STORE))
            return null;
        const v = await req(db.transaction(LEGACY_STORE, 'readonly').objectStore(LEGACY_STORE).get(LEGACY_KEY));
        return v ?? null;
    }
    finally {
        db.close();
    }
}
