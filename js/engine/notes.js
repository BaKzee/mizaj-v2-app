import { termAr } from "./generate.js";
/** Descriptors that are not a flavour component are never asked about. */
const NOT_ASKED = new Set(['taste_attribute', 'mix_marker', 'style']);
const key = (flavorId, descriptorId) => `${flavorId}|${descriptorId}`;
export function latestProductNotes(entries) {
    const out = new Map();
    const notes = entries.filter((e) => e.kind === 'product_note')
        .sort((a, b) => a.seq - b.seq || (a.entryId < b.entryId ? -1 : 1));
    for (const e of notes) {
        const m = out.get(e.note.flavorId) ?? new Map();
        m.set(e.note.descriptorId, e.note.answer);
        out.set(e.note.flavorId, m);
    }
    return out;
}
export const noteFor = (notes, flavorId, descriptorId) => notes.get(flavorId)?.get(descriptorId) ?? null;
export const NOTE_LABEL_AR = { yes: 'تجده فيه', no: 'لا تجده فيه', unsure: 'غير متأكد' };
/** What a personal answer means next to the descriptor's own provenance. Never a verdict on the maker. */
export function noteStatusAr(d, answer) {
    if (!answer)
        return null;
    if (answer === 'unsure')
        return 'ملاحظتك: غير متأكد';
    if (answer === 'yes')
        return d.provenance === 'maker_text_verified' ? 'ملاحظتك توافق نص المصنّع' : 'ملاحظتك: تجده فيه (لم يُوثَّق بنص المصنّع)';
    return d.provenance === 'product_name'
        ? 'ملاحظتك: لا تجده فيه — الاسم وحده يوحي به'
        : d.provenance === 'sourced_text' ? 'ملاحظتك تخالف النص المنشور — اعتبره تعارضاً غير محسوم' : 'ملاحظتك تخالف نص المصنّع الذي راجعته — راجعه';
}
/** Descriptors still "unknown" to the owner: not maker-verified, never answered, not skipped. Most useful first. */
export function nextQuestions(ctx, notes, opts = {}) {
    const used = new Map();
    for (const r of ctx.references) {
        if (r.tier !== 'A' && r.tier !== 'B')
            continue;
        for (const i of r.ingredients) {
            const s = used.get(i.flavorId) ?? new Set();
            s.add(r.recipeId ?? r.refId);
            used.set(i.flavorId, s);
        }
    }
    const out = [];
    for (const p of ctx.products.values()) {
        for (const d of p.descriptors) {
            if (NOT_ASKED.has(d.group) || d.provenance === 'maker_text_verified')
                continue;
            if (noteFor(notes, p.id, d.id) || opts.skipped?.has(key(p.id, d.id)))
                continue;
            out.push({
                flavorId: p.id, productName: p.name, brand: p.brand, descriptorId: d.id, descriptorAr: termAr(d.id), provenance: d.provenance,
                usedInRecorded: used.get(p.id)?.size ?? 0, inStock: (ctx.balancesMg.get(p.id) ?? 0) > 0,
            });
        }
    }
    out.sort((a, b) => b.usedInRecorded - a.usedInRecorded || Number(b.inStock) - Number(a.inStock)
        || (a.productName < b.productName ? -1 : a.productName > b.productName ? 1 : 0) || (a.descriptorId < b.descriptorId ? -1 : a.descriptorId > b.descriptorId ? 1 : a.flavorId < b.flavorId ? -1 : 1));
    return out.slice(0, opts.limit ?? 1);
}
export const questionKey = (q) => key(q.flavorId, q.descriptorId);
