import { allocateMg } from "../domain/grams.js";
import { JournalError, newInventoryEntry, newObservationEntry, newProductNoteEntry, newRecipeEntry, newVersionEntry, } from "../storage/journal.js";
const REFUSAL_AR = {
    overdraw: 'الرصيد المسجّل أقل من الكمية المطلوبة. سجّل شراءً أو صحّح الرصيد أولاً.',
    no_change: 'الصيغة مطابقة للنسخة الأصلية؛ لا داعي لنسخة جديدة.',
    invalid_formula: 'الصيغة غير صالحة: يجب أن يكون المجموع 100% بلا تكرار.',
    empty_text: 'الاسم مطلوب.',
    too_long: 'النص أطول من المسموح.',
    empty_observation: 'سجّل تقييماً أو وصفاً سريعاً أو ملاحظة.',
    bad_quantity: 'الكمية يجب أن تكون رقماً موجباً.',
    bad_rating: 'التقييم من 1 إلى 5 أو بدون تقييم.',
    no_stock_record: 'لا يوجد سجل مخزون لهذا المنتج؛ سجّل شراءً أو رصيداً أولاً.',
    duplicate_entry: 'سُجّل هذا من قبل.',
};
export function refusalAr(e) {
    if (e instanceof JournalError || (e && typeof e === 'object' && 'code' in e))
        return REFUSAL_AR[e.code] ?? e.message;
    return e instanceof Error ? e.message : String(e);
}
const knownIds = (app) => new Set(app.bundle.flavors.map((f) => f.id));
const versionExists = (app, id) => !!id && app.bundle.recipeVersions.some((v) => v.versionId === id);
/** Save a generated/edited formula as a NEW v2 recipe (lineage kept when the parent version exists here). */
export async function saveAsNewRecipe(app, p) {
    const parent = p.lineage.find((x) => versionExists(app, x)) ?? null;
    return app.record((seq, at) => newRecipeEntry({
        name: p.name, ingredients: p.ingredients, origin: p.origin, lineageParentVersionId: parent, referenceIds: p.referenceIds,
        explanation: p.explanation, at, seq, knownFlavorIds: knownIds(app),
    }));
}
export async function saveAsNewVersion(app, p) {
    const parent = app.bundle.recipeVersions.find((v) => v.versionId === p.parentVersionId);
    if (!parent || parent.recipeId !== p.recipeId)
        throw new Error('النسخة الأصل غير موجودة.');
    return app.record((seq, at) => newVersionEntry({
        recipeId: p.recipeId, parentVersionId: parent.versionId, parentIngredients: parent.ingredients, ingredients: p.ingredients,
        origin: 'derived', explanation: p.explanation, at, seq, knownFlavorIds: knownIds(app), makeHead: true,
    }));
}
/**
 * An observation on ONE exact version, optionally deducting the grams used. All entries are
 * built and checked against the current ledger first (no overdraw), then appended in order.
 */
export async function recordObservation(app, p) {
    const v = app.bundle.recipeVersions.find((x) => x.versionId === p.versionId);
    if (!v || v.recipeId !== p.recipeId)
        throw new Error('النسخة غير موجودة.');
    let seq = app.journal.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
    const at = app.now();
    const planned = [newObservationEntry({ recipeId: p.recipeId, versionId: p.versionId, rating: p.rating, diagnostic: p.diagnostic, note: p.note, at, seq: seq++ })];
    if (p.deductMg !== null) {
        let ledger = [...app.bundle.inventoryEvents];
        let maxSeq = ledger.reduce((m, e) => Math.max(m, e.seq), 0);
        for (const a of allocateMg(v.ingredients, p.deductMg)) {
            if (a.mg === 0)
                continue;
            const e = newInventoryEntry(ledger, { flavorId: a.flavorId, type: 'consume', mg: a.mg, at, seq: seq++, recipeVersionId: v.versionId });
            planned.push(e);
            const ev = e.event;
            ledger = [...ledger, { ...ev, seq: ++maxSeq }];
        }
    }
    await app.store.appendJournalBatch(planned); // the observation and every deduction are stored together or not at all
    app.journal = [...app.journal, ...planned];
    app.recompute();
    return planned;
}
export async function recordMovement(app, p) {
    return app.record((seq, at) => newInventoryEntry(app.bundle.inventoryEvents, { flavorId: p.flavorId, type: p.type, mg: p.mg, at, seq, note: p.note, cost: p.cost }));
}
/** «أسئلة الثواني العشر»: one personal answer about one descriptor of one product (display-only; changes no score). */
export async function recordProductNote(app, p) {
    const known = new Set(app.bundle.flavors.map((f) => f.id));
    return app.recordLight((seq, at) => newProductNoteEntry({ ...p, at, seq, knownFlavorIds: known }));
}
