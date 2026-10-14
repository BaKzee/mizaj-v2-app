import { SCHEMA_VERSION } from "../domain/types.js";
import { contentId, sha256Hex } from "../domain/hash.js";
import { createRecipeVersion } from "../domain/recipeVersion.js";
import { canonicalIngredients } from "../domain/validator.js";
import { applyEvent, deriveBalances, LedgerError } from "../domain/inventory.js";
import { safeJsonParse, UnsafeInputError } from "../domain/sanitize.js";
import { parseBundle, serializeBundle } from "../migration/bundle.js";
import { validateBundleInvariants } from "./invariants.js";
export const JOURNAL_SCHEMA = 'mizaj-v2-journal@1';
export const JOURNAL_FORMAT = 'mizaj-v2-journal';
export const NAME_MAX = 80;
export const NOTE_MAX = 1000;
/** 05_UX §Diagnostic: one optional quick label; never a questionnaire, never heat advice. */
export const DIAGNOSTIC_CODES = ['muddy', 'dominant_note', 'soapy', 'bitter_harsh', 'fades_early', 'aroma_without_clarity', 'setup_issue', 'other'];
export const DIAGNOSTIC_AR = {
    muddy: 'مبهم', dominant_note: 'نكهة طاغية', soapy: 'صابوني', bitter_harsh: 'مر / لاذع',
    fades_early: 'خفوت مبكر', aroma_without_clarity: 'رائحة بدون وضوح', setup_issue: 'مشكلة إعداد', other: 'آخر',
};
/**
 * A personal observation on a PRODUCT descriptor («هل تجد نكهة التوت فيه؟»). It is display-only:
 * it never changes a score or an evidence tier, and it carries no batch number, so it is a note
 * about the product as the owner knows it, not a verified fact about the maker's text.
 */
export const NOTE_ANSWERS = ['yes', 'no', 'unsure'];
export const NOTE_ID_MAX = 64;
export class JournalError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'JournalError';
        this.code = code;
    }
}
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
export function payloadId(e) {
    switch (e.kind) {
        case 'recipe_created': return e.recipe.recipeId;
        case 'version_added': return e.version.versionId;
        case 'assessment_added': return e.assessment.assessmentId;
        case 'inventory_event': return e.event.eventId;
        case 'product_note': return e.note.noteId;
    }
}
export const entryIdFor = (kind, id) => contentId('je', { kind, id });
/** Trim, drop control characters (newlines kept in notes), enforce a length cap. Stored verbatim otherwise; escaped on output. */
export function cleanText(value, max, opts = {}) {
    if (value !== null && value !== undefined && typeof value !== 'string')
        throw new JournalError('bad_text', 'text expected');
    const ctrl = opts.multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
    const s = (value ?? '').replace(ctrl, '').trim();
    if (opts.required && !s)
        throw new JournalError('empty_text', 'text required');
    if ([...s].length > max)
        throw new JournalError('too_long', `text longer than ${max} characters`);
    return s;
}
function assertIso(at) {
    if (!ISO.test(at))
        throw new JournalError('bad_time', `not an ISO UTC timestamp: ${at}`);
}
function base(kind, id, seq, at) {
    assertIso(at);
    if (!Number.isSafeInteger(seq) || seq < 1)
        throw new JournalError('bad_seq', 'seq must be a positive integer');
    return { schema: JOURNAL_SCHEMA, entryId: entryIdFor(kind, id), seq, at, kind };
}
function validVersion(input) {
    const v = createRecipeVersion(input);
    if (v.structuralStatus !== 'valid')
        throw new JournalError('invalid_formula', `formula is not structurally valid: ${v.structuralErrors.join(', ')}`);
    return v;
}
/** A new recipe owned by v2, with its first version (both in one entry ⇒ never half-created). */
export function newRecipeEntry(p) {
    const name = cleanText(p.name, NAME_MAX, { required: true });
    assertIso(p.at);
    const recipeId = contentId('rcp', { name, at: p.at, ingredients: [...p.ingredients].map((i) => [i.flavorId, i.basisPoints]).sort() });
    const version = validVersion({
        recipeId, parentVersionId: p.lineageParentVersionId, createdAt: p.at, origin: p.origin, ingredients: p.ingredients,
        referenceIds: p.referenceIds ?? [], explanation: p.explanation ?? null, knownFlavorIds: p.knownFlavorIds,
    });
    const recipe = {
        schemaVersion: SCHEMA_VERSION, recipeId, legacyKey: null, name, category: null, origin: 'v2_native', createdAt: p.at,
        headVersionId: version.versionId, versionIds: [version.versionId], legacyRaw: null, legacyCollection: null, legacyIndex: null,
    };
    return { ...base('recipe_created', recipeId, p.seq, p.at), recipe, version };
}
/** A new immutable version of an existing recipe (an edit never changes the old version). */
export function newVersionEntry(p) {
    const key = (xs) => JSON.stringify(canonicalIngredients(xs));
    if (key(p.ingredients) === key(p.parentIngredients))
        throw new JournalError('no_change', 'the formula is identical to its parent');
    const version = validVersion({
        recipeId: p.recipeId, parentVersionId: p.parentVersionId, createdAt: p.at, origin: p.origin, ingredients: p.ingredients,
        referenceIds: p.referenceIds ?? [], explanation: p.explanation ?? null, knownFlavorIds: p.knownFlavorIds,
    });
    return { ...base('version_added', version.versionId, p.seq, p.at), version, makeHead: p.makeHead ?? true };
}
/** A quick personal answer about one descriptor of one product. Later answers on the same pair replace earlier ones in the view; every answer stays in the journal. */
export function newProductNoteEntry(p) {
    if (!p.knownFlavorIds.has(p.flavorId))
        throw new JournalError('unknown_product', `unknown product ${p.flavorId}`);
    if (!NOTE_ANSWERS.includes(p.answer))
        throw new JournalError('bad_answer', 'answer must be yes, no or unsure');
    const descriptorId = cleanText(p.descriptorId, NOTE_ID_MAX, { required: true });
    assertIso(p.at);
    const note = { noteId: contentId('pn', { flavorId: p.flavorId, descriptorId, answer: p.answer, at: p.at, seq: p.seq }), flavorId: p.flavorId, descriptorId, answer: p.answer };
    return { ...base('product_note', note.noteId, p.seq, p.at), note };
}
/** An observation the owner records against ONE exact version. Rating is optional (MASTER §3). */
export function newObservationEntry(p) {
    if (p.rating !== null && !(Number.isInteger(p.rating) && p.rating >= 1 && p.rating <= 5))
        throw new JournalError('bad_rating', 'rating must be 1–5 or empty');
    if (p.diagnostic !== null && !DIAGNOSTIC_CODES.includes(p.diagnostic))
        throw new JournalError('bad_diagnostic', 'unknown diagnostic');
    const note = cleanText(p.note, NOTE_MAX, { multiline: true });
    if (p.rating === null && p.diagnostic === null && !note)
        throw new JournalError('empty_observation', 'record a rating, a label or a note');
    assertIso(p.at);
    const assessment = {
        schemaVersion: SCHEMA_VERSION, assessmentId: contentId('as', { versionId: p.versionId, at: p.at, rating: p.rating, diagnostic: p.diagnostic, note }),
        recipeId: p.recipeId, recipeVersionId: p.versionId, candidateVersionIds: [p.versionId],
        legacyAttributionStatus: 'exact_version_verified', attributionBasis: 'native_exact_version', legacyKey: null,
        recordedAt: p.at, timestampPrecision: 'ms', provenance: 'user_observation', rating: p.rating,
        descriptors: p.diagnostic ? [p.diagnostic] : [], note, legacyAutoAdvice: null, sessionId: null, sessionLinkBasis: null,
        flags: [], legacyRaw: null, legacyIndex: null,
    };
    return { ...base('assessment_added', assessment.assessmentId, p.seq, p.at), assessment };
}
/**
 * An inventory movement, validated against the CURRENT effective ledger: a purchase adds,
 * a correction re-bases (consumption history untouched), a consume/waste may not overdraw.
 */
export function newInventoryEntry(ledger, p) {
    assertIso(p.at);
    if (!Number.isSafeInteger(p.mg) || p.mg < 0 || (p.type !== 'correction' && p.mg === 0))
        throw new JournalError('bad_quantity', 'quantity must be a positive whole number of mg');
    const note = cleanText(p.note ?? '', NOTE_MAX, { multiline: true });
    const deltaMg = p.type === 'purchase' ? p.mg : p.type === 'correction' ? null : -p.mg;
    const balanceMg = p.type === 'correction' ? p.mg : null;
    const event = {
        schemaVersion: SCHEMA_VERSION,
        eventId: contentId('ie', { v2: true, flavorId: p.flavorId, type: p.type, at: p.at, deltaMg, balanceMg, recipeVersionId: p.recipeVersionId ?? null, seq: p.seq }),
        flavorId: p.flavorId, seq: 0, type: p.type, at: p.at, deltaMg, balanceMg,
        batchId: p.type === 'purchase' ? contentId('batch', { flavorId: p.flavorId, at: p.at, mg: p.mg }) : null,
        packMg: p.type === 'purchase' ? p.mg : null, cost: p.cost ?? null, sessionId: null,
        recipeVersionId: p.recipeVersionId ?? null, note: note || null, legacyRaw: null,
    };
    const current = deriveBalances(ledger).get(p.flavorId);
    if (!current && p.type !== 'purchase' && p.type !== 'correction')
        throw new JournalError('no_stock_record', `no stock record for ${p.flavorId}`);
    try {
        applyEvent(current ?? { flavorId: p.flavorId, availableMg: 0, consumedSinceOpeningMg: 0, legacyUsedTotalMg: null, purchasedSinceOpeningMg: 0, correctionsCount: 0, anomalies: [] }, event, false);
    }
    catch (e) {
        if (e instanceof LedgerError)
            throw new JournalError(e.code, e.message);
        throw e;
    }
    return { ...base('inventory_event', event.eventId, p.seq, p.at), event };
}
/* ------------------------------------------------------------------ *
 * Shape validation (entries read from a file are untrusted)
 * ------------------------------------------------------------------ */
export function entryShapeProblems(e) {
    const p = [];
    const o = e;
    if (!o || typeof o !== 'object')
        return ['entry: not an object'];
    if (o['schema'] !== JOURNAL_SCHEMA)
        p.push('schema');
    if (!['recipe_created', 'version_added', 'assessment_added', 'inventory_event', 'product_note'].includes(o['kind']))
        return [...p, `kind ${String(o['kind'])}`];
    if (!Number.isSafeInteger(o['seq']) || o['seq'] < 1)
        p.push('seq');
    if (typeof o['at'] !== 'string' || !ISO.test(o['at']))
        p.push('at');
    const ent = e;
    const payload = ent.kind === 'recipe_created' ? ent.recipe : ent.kind === 'version_added' ? ent.version : ent.kind === 'assessment_added' ? ent.assessment : ent.kind === 'product_note' ? ent.note : ent.event;
    if (!payload || typeof payload !== 'object')
        return [...p, 'payload missing'];
    if (o['entryId'] !== entryIdFor(ent.kind, payloadId(ent)))
        p.push('entryId does not match its payload');
    if (ent.kind === 'recipe_created') {
        if (ent.recipe.origin !== 'v2_native')
            p.push('recipe origin must be v2_native');
        if (!ent.version || ent.version.recipeId !== ent.recipe.recipeId)
            p.push('first version must belong to the recipe');
        if (ent.recipe.headVersionId !== ent.version?.versionId || ent.recipe.versionIds.length !== 1)
            p.push('recipe must start with its one version');
        try {
            cleanText(ent.recipe.name, NAME_MAX, { required: true });
        }
        catch {
            p.push('recipe name');
        }
    }
    if (ent.kind === 'version_added' && typeof ent.makeHead !== 'boolean')
        p.push('makeHead');
    if (ent.kind === 'assessment_added') {
        const a = ent.assessment;
        if (a.provenance !== 'user_observation' || a.attributionBasis !== 'native_exact_version' || a.legacyAttributionStatus !== 'exact_version_verified')
            p.push('observation must be a native exact-version record');
        if (a.candidateVersionIds?.length !== 1 || a.candidateVersionIds[0] !== a.recipeVersionId)
            p.push('observation must name exactly its own version');
        if (a.legacyRaw !== null || a.legacyAutoAdvice !== null)
            p.push('observation cannot carry legacy content');
        try {
            cleanText(a.note, NOTE_MAX, { multiline: true });
        }
        catch {
            p.push('note');
        }
    }
    if (ent.kind === 'product_note') {
        const n = ent.note;
        if (typeof n.flavorId !== 'string' || !n.flavorId || [...n.flavorId].length > 200)
            p.push('note product');
        if (typeof n.descriptorId !== 'string' || !n.descriptorId || [...n.descriptorId].length > NOTE_ID_MAX || /[\u0000-\u001F\u007F]/.test(n.descriptorId))
            p.push('note descriptor');
        if (!NOTE_ANSWERS.includes(n.answer))
            p.push('note answer');
        if (Object.keys(n).sort().join() !== 'answer,descriptorId,flavorId,noteId')
            p.push('note carries unexpected fields');
    }
    if (ent.kind === 'inventory_event') {
        if (ent.event.type === 'opening_snapshot')
            p.push('v2 cannot write an opening snapshot');
        if (ent.event.legacyRaw !== null)
            p.push('event cannot carry legacy content');
    }
    return p;
}
/* ------------------------------------------------------------------ *
 * Ordering, merge, composition
 * ------------------------------------------------------------------ */
export function sortEntries(entries) {
    return [...entries].sort((a, b) => a.seq - b.seq || (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0));
}
export const nextSeq = (entries) => entries.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
/** Union by entry id; incoming new entries are appended after the existing ones, in their own order. Never drops anything. */
export function mergeJournal(existing, incoming) {
    const have = new Set(existing.map((e) => e.entryId));
    let seq = nextSeq(existing);
    const merged = sortEntries(existing);
    let added = 0;
    let skipped = 0;
    for (const e of sortEntries(incoming)) {
        if (have.has(e.entryId)) {
            skipped++;
            continue;
        }
        have.add(e.entryId);
        merged.push({ ...e, seq: seq++ });
        added++;
    }
    return { merged, added, skipped };
}
/**
 * Migrated bundle ⊕ journal → effective dataset. The base bundle is never mutated
 * (recipes that gain versions are copied). Inventory events get a replay seq after
 * the migrated ledger so the opening snapshots always come first.
 */
export function composeBundle(baseBundle, entries) {
    const recipes = new Map(baseBundle.recipes.map((r) => [r.recipeId, r]));
    const versions = new Map(baseBundle.recipeVersions.map((v) => [v.versionId, v]));
    const assessments = [...baseBundle.assessments];
    const assessmentIds = new Set(assessments.map((a) => a.assessmentId));
    const events = [...baseBundle.inventoryEvents];
    const eventIds = new Set(events.map((e) => e.eventId));
    const flavorIds = new Set(baseBundle.flavors.map((f) => f.id));
    const seqBase = events.reduce((m, e) => Math.max(m, e.seq), 0);
    const skipped = [];
    const touched = new Set();
    const seen = new Set();
    const copyRecipe = (id) => {
        const r = recipes.get(id);
        if (touched.has(id))
            return r;
        const c = { ...r, versionIds: [...r.versionIds] };
        recipes.set(id, c);
        touched.add(id);
        return c;
    };
    for (const e of sortEntries(entries)) {
        const skip = (reason) => skipped.push({ entryId: e.entryId, reason });
        if (seen.has(e.entryId)) {
            skip('duplicate entry');
            continue;
        }
        seen.add(e.entryId);
        const shape = entryShapeProblems(e);
        if (shape.length) {
            skip(`malformed: ${shape.join(', ')}`);
            continue;
        }
        switch (e.kind) {
            case 'recipe_created': {
                if (recipes.has(e.recipe.recipeId)) {
                    skip('recipe already exists');
                    break;
                }
                if (versions.has(e.version.versionId)) {
                    skip('version already exists');
                    break;
                }
                if (e.version.parentVersionId !== null && !versions.has(e.version.parentVersionId)) {
                    skip(`lineage parent ${e.version.parentVersionId} not in the dataset`);
                    break;
                }
                recipes.set(e.recipe.recipeId, { ...e.recipe, versionIds: [...e.recipe.versionIds] });
                touched.add(e.recipe.recipeId);
                versions.set(e.version.versionId, e.version);
                break;
            }
            case 'version_added': {
                const v = e.version;
                if (!recipes.has(v.recipeId)) {
                    skip(`unknown recipe ${v.recipeId}`);
                    break;
                }
                if (versions.has(v.versionId)) {
                    skip('version already exists');
                    break;
                }
                if (v.parentVersionId === null || !versions.has(v.parentVersionId)) {
                    skip('parent version missing');
                    break;
                }
                const r = copyRecipe(v.recipeId);
                r.versionIds.push(v.versionId);
                if (e.makeHead)
                    r.headVersionId = v.versionId;
                versions.set(v.versionId, v);
                break;
            }
            case 'assessment_added': {
                const a = e.assessment;
                const v = a.recipeVersionId ? versions.get(a.recipeVersionId) : undefined;
                if (!v || v.recipeId !== a.recipeId) {
                    skip('observation names a version that is not in the dataset');
                    break;
                }
                if (assessmentIds.has(a.assessmentId)) {
                    skip('observation already exists');
                    break;
                }
                assessments.push(a);
                assessmentIds.add(a.assessmentId);
                break;
            }
            case 'product_note': {
                // display-only: nothing is added to the bundle; it only has to name a product that exists
                if (!flavorIds.has(e.note.flavorId))
                    skip(`unknown product ${e.note.flavorId}`);
                break;
            }
            case 'inventory_event': {
                const ev = e.event;
                if (!flavorIds.has(ev.flavorId)) {
                    skip(`unknown product ${ev.flavorId}`);
                    break;
                }
                if (eventIds.has(ev.eventId)) {
                    skip('movement already exists');
                    break;
                }
                events.push({ ...ev, seq: seqBase + e.seq });
                eventIds.add(ev.eventId);
                break;
            }
        }
    }
    const bundle = {
        ...baseBundle,
        recipes: [...recipes.values()],
        recipeVersions: [...versions.values()],
        assessments,
        inventoryEvents: events,
    };
    return { bundle, skipped, problems: validateBundleInvariants(bundle) };
}
export const KNOWLEDGE_FORMAT = 'mizaj-v2-knowledge';
export const KNOWLEDGE_PACK_SCHEMA_ID = 'mizaj-knowledge-pack@1';
/**
 * bundle · journal · (optional) knowledge pack — one file restores everything.
 * The knowledge section is one JSON line with its own checksum.
 */
export function serializeFullBackup(baseBundle, entries, exportedAt, knowledgePack = null) {
    const lines = sortEntries(entries).map((e) => JSON.stringify(e));
    const payload = lines.join('\n');
    const header = { format: JOURNAL_FORMAT, schema: JOURNAL_SCHEMA, exportedAt, entries: lines.length, payloadSha256: sha256Hex(payload) };
    let out = `${serializeBundle(baseBundle)}${JSON.stringify(header)}\n${lines.length ? `${payload}\n` : ''}`;
    if (knowledgePack !== null && knowledgePack !== undefined) {
        const k = JSON.stringify(knowledgePack);
        out += `${JSON.stringify({ format: KNOWLEDGE_FORMAT, schema: knowledgePack.schema ?? null, sha256: sha256Hex(k) })}\n${k}\n`;
    }
    return out;
}
const MARK = `\n{"format":"${JOURNAL_FORMAT}"`;
const KMARK = `\n{"format":"${KNOWLEDGE_FORMAT}"`;
/** Accepts a full backup or a plain bundle (journal = []). Every entry is shape-checked; every checksum must match. */
export function parseFullBackup(text, maxBytes = 150 * 1024 * 1024) {
    if (typeof text !== 'string')
        throw new UnsafeInputError('not_text', 'backup is not text');
    if (new TextEncoder().encode(text).length > maxBytes)
        throw new UnsafeInputError('too_large', 'backup too large');
    const at = text.indexOf(MARK);
    if (at < 0)
        return { bundle: parseBundle(text), entries: [], exportedAt: null, knowledgePack: null };
    const bundle = parseBundle(text.slice(0, at + 1));
    let knowledgePack = null;
    const kat = text.indexOf(KMARK, at + 1);
    if (kat >= 0) {
        const ktext = text.slice(kat + 1).replace(/\n$/, '');
        const knl = ktext.indexOf('\n');
        if (knl < 0)
            throw new UnsafeInputError('bad_backup', 'knowledge section without content');
        const kh = safeJsonParse(ktext.slice(0, knl));
        const body = ktext.slice(knl + 1);
        if (kh.format !== KNOWLEDGE_FORMAT || kh.schema !== KNOWLEDGE_PACK_SCHEMA_ID)
            throw new UnsafeInputError('bad_backup', 'unknown knowledge format');
        if (sha256Hex(body) !== kh.sha256)
            throw new UnsafeInputError('integrity', 'knowledge checksum mismatch (file corrupted or edited)');
        knowledgePack = safeJsonParse(body, { maxBytes: 50 * 1024 * 1024 });
    }
    const rest = text.slice(at + 1, kat >= 0 ? kat + 1 : undefined);
    const body = rest.endsWith('\n') ? rest.slice(0, -1) : rest;
    const nl = body.indexOf('\n');
    const header = safeJsonParse(nl < 0 ? body : body.slice(0, nl));
    if (header.format !== JOURNAL_FORMAT || header.schema !== JOURNAL_SCHEMA)
        throw new UnsafeInputError('bad_backup', 'unknown journal format');
    const payload = nl < 0 ? '' : body.slice(nl + 1);
    if (sha256Hex(payload) !== header.payloadSha256)
        throw new UnsafeInputError('integrity', 'journal checksum mismatch (file corrupted or edited)');
    const entries = payload ? payload.split('\n').map((l, i) => {
        const e = safeJsonParse(l);
        const p = entryShapeProblems(e);
        if (p.length)
            throw new UnsafeInputError('bad_backup', `journal line ${i + 1}: ${p.join(', ')}`);
        return e;
    }) : [];
    if (entries.length !== header.entries)
        throw new UnsafeInputError('integrity', 'journal entry count mismatch');
    return { bundle, entries, exportedAt: typeof header.exportedAt === 'string' ? header.exportedAt : null, knowledgePack };
}
