import { openV2Db, IndexedDbStore, readLegacyStateReadOnly } from "../storage/indexedDbStore.js";
import { MemoryStore } from "../storage/store.js";
import { latestProductNotes } from "../engine/notes.js";
import { composeBundle, nextSeq, parseFullBackup, serializeFullBackup } from "../storage/journal.js";
import { readFlags, writeFlags } from "../storage/flags.js";
import { validateBundleInvariants } from "../storage/invariants.js";
import { runP0Pipeline } from "../migration/pipeline.js";
import { exportBackupV1Text } from "../migration/exportV1.js";
import { buildEngineContext } from "../engine/context.js";
import { knowledgePackProblems, KNOWLEDGE_PACK_SCHEMA } from "../knowledge/pack.js";
import { safeJsonParse } from "../domain/sanitize.js";
import { parseOwnerDecisions } from "../domain/ownerDecisions.js";
import { isSingleFile, readEmbedded } from "./env.js";
const PREFS_KEY = 'mizaj:v2:ui';
export class App {
    store = new MemoryStore();
    persistent = false;
    base = null;
    journal = [];
    pack = null;
    comp = null;
    ctx = null;
    last = null;
    /** Milliseconds of the last context rebuild (shown in the data screen; measured, not assumed). */
    lastBuildMs = 0;
    listeners = new Set();
    async open() {
        try {
            this.store = new IndexedDbStore(await openV2Db());
            this.persistent = true;
        }
        catch {
            this.store = new MemoryStore();
            this.persistent = false;
        }
        await this.reload();
    }
    async reload() {
        this.base = await this.store.exportBundle();
        this.journal = await this.store.readJournal();
        const pack = (await this.store.getSingleton('knowledgePack'));
        this.pack = pack && pack.schema === KNOWLEDGE_PACK_SCHEMA ? pack : null;
        this.recompute();
    }
    recompute() {
        const t0 = performance.now();
        if (!this.base) {
            this.comp = null;
            this.ctx = null;
            return;
        }
        this.comp = composeBundle(this.base, this.journal);
        this.ctx = buildEngineContext(this.comp.bundle, this.pack);
        this.lastBuildMs = Math.round(performance.now() - t0);
        for (const f of this.listeners)
            f();
    }
    get bundle() { return this.comp?.bundle ?? null; }
    get hasData() { return !!this.base; }
    now() { return new Date().toISOString(); }
    /** Build an entry with the next seq and the current time, store it, then rebuild. Throws on refusal (nothing stored). */
    async record(make) {
        const entry = make(nextSeq(this.journal), this.now());
        await this.store.appendJournal(entry);
        this.journal = [...this.journal, entry];
        this.recompute();
        return entry;
    }
    /**
     * Like `record`, for entries that cannot change the engine context (personal product notes are
     * display-only): stored and journaled, but the context is NOT rebuilt, so answering a quick
     * question costs one write.
     */
    async recordLight(make) {
        const entry = make(nextSeq(this.journal), this.now());
        if (entry.kind !== 'product_note')
            throw new Error('recordLight is only for display-only entries');
        await this.store.appendJournal(entry);
        this.journal = [...this.journal, entry];
        for (const f of this.listeners)
            f();
        return entry;
    }
    notesCache = null;
    /** Latest personal answer per (product, descriptor); display-only. */
    get productNotes() {
        if (this.notesCache?.journal !== this.journal)
            this.notesCache = { journal: this.journal, notes: latestProductNotes(this.journal) };
        return this.notesCache.notes;
    }
    /* ------------------------------ imports ------------------------------ */
    /** Same-origin legacy app: read its database (read-only) and its catalog page, migrate in the browser. */
    async previewFromLegacyDevice(legacyIndexUrl = '../index.html') {
        const state = await readLegacyStateReadOnly();
        if (!state) {
            throw new Error(isSingleFile()
                ? 'لم أجد بيانات التطبيق القديم في هذا المتصفح. افتح التطبيق القديم، صدّر منه نسخة احتياطية، ثم استوردها هنا من «ملف نسخة التطبيق القديم».'
                : 'لم أجد بيانات التطبيق القديم في هذا المتصفح. يجب أن يكون v2 على نفس الموقع، أو استورد من ملفات.');
        }
        let html = readEmbedded()?.legacyHtml ?? null;
        if (!html) {
            if (isSingleFile())
                throw new Error('هذا الملف لا يحتوي صفحة التطبيق القديم؛ اختر ملف index.html مع ملف النسخة من «ملفات التطبيق القديم».');
            const res = await fetch(legacyIndexUrl, { cache: 'no-store' });
            if (!res.ok)
                throw new Error(`لم أستطع قراءة صفحة التطبيق القديم (${res.status}).`);
            html = await res.text();
        }
        return this.previewFromLegacy(html, JSON.stringify(state, null, 1), 'legacy-idb', 'legacy_device');
    }
    /** Migrates in the browser; the owner decisions embedded in a private build are applied (same as the CLI). */
    previewFromLegacy(html, backupText, backupFileName, source = 'legacy_files') {
        const decisionsText = readEmbedded()?.ownerDecisionsText ?? null;
        const out = runP0Pipeline({ html, backupText, backupFileName, ranAt: this.now(), ownerDecisions: decisionsText ? parseOwnerDecisions(decisionsText) : null });
        const b = out.migration.bundle;
        const problems = [...out.invariantProblems.map(String), ...(out.roundTrip.backupByteExact ? [] : ['الرجوع إلى صيغة التطبيق القديم لا يطابق الملف بايتاً ببايت'])];
        return {
            source, bundle: b, entries: [], pack: null, counts: { ...b.migrationLog.postCounts }, outcome: b.migrationLog.outcome, problems,
            notes: ['لن يُكتب أي شيء في التطبيق القديم.', `بنود للمراجعة: ${b.migrationLog.reviewItems.length}`],
        };
    }
    previewFromBackup(text) {
        const p = parseFullBackup(text);
        const pack = p.knowledgePack;
        const problems = validateBundleInvariants(p.bundle);
        const c = composeBundle(p.bundle, p.entries);
        problems.push(...c.problems, ...c.skipped.map((s) => `إدخال لم يُطبَّق: ${s.reason}`));
        if (pack)
            problems.push(...this.packProblems(pack, p.bundle));
        return {
            source: 'v2_backup', bundle: p.bundle, entries: p.entries, pack, counts: { ...p.bundle.migrationLog.postCounts, journal: p.entries.length },
            outcome: p.bundle.migrationLog.outcome, problems,
            notes: [p.exportedAt ? `صُدّرت في ${p.exportedAt.slice(0, 16).replace('T', ' ')}` : 'ملف حزمة بلا سجل v2', pack ? 'تحتوي حزمة المعرفة' : 'لا تحتوي حزمة المعرفة'],
        };
    }
    /**
     * Private single-file build: on the very first open the embedded data is imported (once).
     * Never blocks the app: embedded data that does not validate is simply not imported, and
     * the owner can still import from files on the data screen.
     */
    async loadEmbeddedIfEmpty(emb = readEmbedded()) {
        if (this.hasData || !emb?.backupText)
            return false;
        try {
            const p = this.previewFromBackup(emb.backupText);
            if (p.problems.some((x) => !x.startsWith('إدخال لم يُطبَّق')))
                return false;
            await this.applyImport(p);
            return true;
        }
        catch {
            return false;
        }
    }
    /** Bundle: replace the migrated data atomically. Journal: union (nothing already recorded is lost). */
    async applyImport(p) {
        if (p.problems.some((x) => !x.startsWith('إدخال لم يُطبَّق')))
            throw new Error('الملف فيه مشاكل؛ لم يُستورد شيء.');
        await this.store.importBundle(p.bundle);
        const m = p.entries.length ? await this.store.mergeJournal(p.entries) : { added: 0, skipped: 0 };
        if (p.pack)
            await this.store.putSingleton('knowledgePack', p.pack);
        await this.reload();
        return m;
    }
    /** Untrusted file: shape first, then the P1 gate checks; any failure is a refusal, never a crash. */
    packProblems(pack, bundle) {
        if (pack?.schema !== KNOWLEDGE_PACK_SCHEMA || !Array.isArray(pack.passports) || !Array.isArray(pack.claims) || !Array.isArray(pack.sources))
            return ['ليست حزمة معرفة صالحة'];
        const ids = new Set(bundle.flavors.map((f) => f.id));
        const foreign = pack.passports.filter((x) => !ids.has(x?.flavorId)).map((x) => String(x?.flavorId));
        if (foreign.length)
            return [`الحزمة تخص منتجات غير موجودة هنا: ${foreign.slice(0, 5).join('، ')}`];
        try {
            return knowledgePackProblems(pack, bundle);
        }
        catch (e) {
            return [`الحزمة تالفة: ${e.message}`];
        }
    }
    async importKnowledgePackText(text) {
        if (!this.base)
            throw new Error('استورد بياناتك أولاً.');
        const pack = safeJsonParse(text, { maxBytes: 50 * 1024 * 1024 });
        const problems = this.packProblems(pack, this.base);
        if (problems.length)
            throw new Error(`لم تُستورد الحزمة: ${problems.slice(0, 3).join(' · ')}`);
        await this.store.putSingleton('knowledgePack', pack);
        await this.reload();
    }
    /* ------------------------------ exports ------------------------------ */
    exportFullBackup() {
        if (!this.base)
            throw new Error('لا توجد بيانات');
        return serializeFullBackup(this.base, this.journal, this.now(), this.pack);
    }
    /** The original v1 data, byte-exact (what v2 created is not representable in v1 and stays in the v2 backup). */
    exportLegacyFile() {
        if (!this.base)
            throw new Error('لا توجد بيانات');
        return exportBackupV1Text(this.base);
    }
    /* ------------------------------ flags & prefs ------------------------------ */
    get v2IsDefault() { return readFlags(safeStorage()).MIZAJ_CORE_V2; }
    setV2Default(on) { return writeFlags(safeStorage(), { MIZAJ_CORE_V2: on }); }
    prefs() {
        try {
            return JSON.parse(safeStorage()?.getItem(PREFS_KEY) ?? '{}');
        }
        catch {
            return {};
        }
    }
    setPref(key, value) {
        try {
            const p = this.prefs();
            p[key] = value;
            safeStorage()?.setItem(PREFS_KEY, JSON.stringify(p));
        }
        catch { /* per-device convenience only */ }
    }
}
export function safeStorage() {
    try {
        return window.localStorage;
    }
    catch {
        return null;
    }
}
