import { allocateMg } from "../domain/grams.js";
import { apportionBp } from "../domain/basisPoints.js";
import { canonicalJson } from "../domain/hash.js";
import { counterexamples, hardCheck, heuristicWarnings, UNDESCRIBED_AR } from "./review.js";
import { canonicalShares, halfL1Bp, ingredientJaccard } from "./similarity.js";
import { termAr, timesAr } from "./generate.js";
export function doctor(ings, ctx, opts = {}) {
    const gramsTotalMg = opts.gramsTotalMg ?? ctx.config.defaults.gramsTotalMg;
    const check = hardCheck(ctx, ings, { gramsTotalMg, stockOnly: !!opts.stockOnly, excluded: new Set(), maxProducts: null });
    const name = (id) => ctx.products.get(id)?.name ?? id;
    const unknowns = ['لا يوجد قياس لشدة أي منتج؛ لا يمكن التنبؤ بالطعم من النسب.'];
    if (check.structural === 'fail') {
        return {
            decision: 'invalid', structural: 'fail', errors: check.errors, stock: check.stock, ingredients: ings.map((i) => ({ flavorId: i.flavorId, name: name(i.flavorId), basisPoints: i.basisPoints, mg: 0 })),
            evidence: { tier: 'U', summaryAr: 'الصيغة غير صالحة بنيوياً، فلم يُبحث عن دليل.', exactMatch: null }, similarSupported: [], warnings: [], legacyRuleNotes: [], simplifications: [], unknowns,
        };
    }
    const alloc = allocateMg(ings, gramsTotalMg);
    const key = canonicalJson([...canonicalShares(ctx, ings)].sort());
    const exact = ctx.references.find((r) => canonicalJson([...canonicalShares(ctx, r.ingredients)].sort()) === key) ?? null;
    const tier = exact ? exact.tier : 'U';
    const summaryAr = !exact
        ? 'لا يوجد سجل لهذه الصيغة بالضبط ولا صيغة منشورة مطابقة.'
        : exact.tier === 'C' ? 'صيغة منشورة بنسبها الكاملة.'
            : exact.tier === 'U' ? `مطابقة لـ«${exact.name}» لكن بلا تجربة مسجّلة.`
                : `مطابقة لـ«${exact.name}»: سُجّلت ${timesAr(exact.observations.probable + exact.observations.verified)} (${exact.support} بتقييم 4–5، ${exact.caution} منخفض)${exact.attribution === 'probable_legacy' ? '؛ ربط السجلات بالنسخة استنتاج' : ''}.`;
    const supported = (r) => (r.tier === 'A' || r.tier === 'B' || r.tier === 'C') && r.support >= r.caution && r.refId !== exact?.refId;
    const similarSupported = ctx.references.filter(supported)
        .map((r) => ({ refId: r.refId, name: r.name, tier: r.tier, jaccard: ingredientJaccard(ctx, ings, r.ingredients), halfL1Bp: halfL1Bp(ctx, ings, r.ingredients) }))
        .filter((x) => x.jaccard >= 0.5)
        .sort((a, b) => b.jaccard - a.jaccard || a.halfL1Bp - b.halfL1Bp || (a.refId < b.refId ? -1 : 1))
        .slice(0, 3);
    const warnings = [...heuristicWarnings(ctx, ings, check.shortages), ...counterexamples(ctx, ings, new Set(exact ? [exact.refId] : []))];
    const legacyRuleNotes = [];
    for (const i of ings)
        for (const r of ctx.legacyPct.get(i.flavorId) ?? []) {
            const pct = i.basisPoints / 100;
            const tripped = r.property === 'minPct' ? pct < r.value : pct > r.value;
            if (tripped)
                legacyRuleNotes.push({ flavorId: i.flavorId, claimId: r.claimId, textAr: `التطبيق القديم كان سيعترض: ${name(i.flavorId)} ${pct}% ${r.property === 'minPct' ? 'أقل من' : 'أكثر من'} ${r.value}% (${r.property}). قاعدة قديمة غير موثّقة — لا تُطبَّق.` });
        }
    const comp = (id) => new Set((ctx.products.get(id)?.descriptors ?? []).filter((d) => d.group !== 'taste_attribute').map((d) => d.id));
    const simplifications = [];
    if (ings.length > 2) {
        for (const [k, ing] of ings.entries()) {
            const rest = ings.filter((_, j) => j !== k);
            const others = new Set(rest.flatMap((x) => [...comp(x.flavorId)]));
            const own = comp(ing.flavorId);
            const lost = own.size === 0 ? [UNDESCRIBED_AR] : [...own].filter((c) => !others.has(c)).map(termAr);
            const bp = apportionBp(rest.map((x) => ({ key: x.flavorId, weight: x.basisPoints })));
            simplifications.push({ removed: ing.flavorId, lostDescriptors: lost, ingredients: rest.map((x) => ({ flavorId: x.flavorId, basisPoints: bp.get(x.flavorId) })) });
        }
        const unk = (x) => Number(x.lostDescriptors.includes(UNDESCRIBED_AR));
        simplifications.sort((a, b) => unk(a) - unk(b) || a.lostDescriptors.length - b.lostDescriptors.length || (a.removed < b.removed ? -1 : 1));
    }
    for (const i of ings)
        if (!ctx.products.get(i.flavorId)?.sourced)
            unknowns.push(`لا يوجد نص منشور يصف «${name(i.flavorId)}»؛ وصفه مستنتج من اسمه فقط.`);
    const decision = exact && (exact.tier === 'A' || exact.tier === 'B' || exact.tier === 'C') && exact.support >= exact.caution ? 'reference_supported' : 'valid';
    return {
        decision, structural: 'pass', errors: [], stock: check.stock,
        ingredients: alloc.map((a) => ({ flavorId: a.flavorId, name: name(a.flavorId), basisPoints: a.basisPoints, mg: a.mg })),
        evidence: { tier, summaryAr, exactMatch: exact ? { refId: exact.refId, name: exact.name } : null },
        similarSupported, warnings, legacyRuleNotes, simplifications, unknowns,
    };
}
