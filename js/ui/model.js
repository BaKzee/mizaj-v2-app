import { bpToPctString } from "../domain/basisPoints.js";
import { mgToGramString } from "../domain/grams.js";
import { costPerGram, deriveBalances } from "../domain/inventory.js";
import { diffVersions } from "../domain/recipeVersion.js";
import { defaultRequest } from "../engine/api.js";
import { attributionAr, termAr } from "../engine/generate.js";
import { parseIntent } from "../engine/intent.js";
import { LEXICON } from "../knowledge/descriptors.js";
/* ------------------------------------------------------------------ *
 * Words shown to the owner
 * ------------------------------------------------------------------ */
export const SAFETY_AR = 'توافق النكهات ليس دليلاً على سلامة التدخين، والطعم الجيد لا يثبت السلامة.';
export const NOT_PROBABILITY_AR = 'الترتيب ليس احتمال أن تعجبك الخلطة.';
export const MODE_AR = {
    PRECISION: { name: 'دقيق (افتراضي)', help: 'وصفاتك المسجّلة أولاً، ثم تعديلات محافظة عليها. لا فرضيات جديدة.' },
    REFERENCE: { name: 'مرجعي', help: 'وصفات مسجّلة أو منشورة كما هي، أو تعديلات قليلة عليها.' },
    SIGNATURE: { name: 'توقيع', help: 'يسمح بصياغة جديدة واضحة الهوية، موسومة «غير مجرّبة».' },
    DISCOVERY: { name: 'استكشاف', help: 'يسمح بفرضيات جديدة غير مجرّبة عندما لا يكفي الدليل.' },
};
export const DECISION_AR = {
    reference_supported: 'وصفة مسجّلة',
    adapted_with_uncertainty: 'معدّلة — غير مجرّبة',
    exploratory: 'فرضية جديدة — غير مجرّبة',
    valid: 'صالحة بنيوياً',
    invalid: 'غير صالحة',
    insufficient_evidence: 'لا توجد أدلة كافية',
    unknown: 'بلا دليل',
};
export const TIER_AR = {
    A: 'دليل A — سُجّلت 3 مرات أو أكثر بالصيغة نفسها',
    B: 'دليل B — سُجّلت مرة أو مرتين بالصيغة نفسها',
    C: 'دليل C — وصفة منشورة بنسب كاملة',
    D: 'دليل D — تعديل على مرجع، بلا تجربة',
    E: 'دليل E — فرضية بلا مرجع',
    U: 'بلا سجل على هذه الصيغة',
};
export const QUALITY_AR = {
    recorded: 'وصفاتي المسجّلة (افتراضي)',
    published: 'المسجّلة + المنشورة',
    verified: 'ما سجّلته في v2 على النسخة نفسها فقط',
    any: 'كل الوصفات حتى غير المقيَّمة',
};
export const ORIGIN_AR = {
    legacy_bundled: 'من كتاب التطبيق القديم',
    user_created: 'وصفتك في التطبيق القديم',
    v2_native: 'أنشأتَها في v2',
};
export const VERSION_ORIGIN_AR = {
    legacy: 'النسخة الأصلية', recorded: 'مسجّلة', published: 'منشورة', derived: 'تعديل', hypothesis: 'فرضية',
};
/**
 * Arabic counted noun: 1 → «منتج واحد», 2 → «منتجان», 3–10 → «3 منتجات», 11+ → «11 منتجاً» / «11 وصفة».
 * `tamyiz` is the singular accusative used from 11 upwards (منتجاً، وصفةً → written «وصفة»).
 */
export function countAr(n, f) {
    if (n === 0)
        return `0 ${f.plural}`;
    if (n === 1)
        return f.one;
    if (n === 2)
        return f.two;
    const m = n % 100;
    if (m >= 3 && m <= 10)
        return `${n} ${f.plural}`;
    return `${n} ${f.tamyiz}`;
}
export const PRODUCTS_AR = { one: 'منتج واحد', two: 'منتجان', plural: 'منتجات', tamyiz: 'منتجاً' };
export const RECIPES_AR = { one: 'وصفة واحدة', two: 'وصفتان', plural: 'وصفات', tamyiz: 'وصفة' };
export const ENTRIES_AR = { one: 'إدخال واحد', two: 'إدخالان', plural: 'إدخالات', tamyiz: 'إدخالاً' };
export const SUGGESTIONS_AR = { one: 'اقتراح واحد', two: 'اقتراحان', plural: 'اقتراحات', tamyiz: 'اقتراحاً' };
export const pct = (bp) => `${bpToPctString(bp)}%`;
export const grams = (mg) => `${mgToGramString(mg, 1)} غ`;
export { attributionAr };
export const GOAL_GROUPS = [
    { id: 'fruit', ar: 'فاكهي' },
    { id: 'floral', ar: 'زهري' },
    { id: 'citrus', ar: 'حامض / حمضي' },
    { id: 'creamy_dessert', ar: 'كريمي' },
    { id: 'berry', ar: 'توتي' },
    { id: 'tropical', ar: 'استوائي' },
    { id: 'herbal', ar: 'عشبي' },
    { id: 'tea', ar: 'شاي' },
];
export function defaultWizard(ctx, defaultGramsTotalMg) {
    return {
        goals: [], novel: false, freeText: '', cooling: null, sweetWanted: false, excludedIds: [], stockOnly: true,
        maxProducts: ctx.config.defaults.maxProducts, gramsTotalMg: defaultGramsTotalMg, mode: 'PRECISION', sourceQualityMin: ctx.config.defaults.sourceQualityMin,
    };
}
/** Specific flavor chips: the descriptors your own products actually carry, most common first. */
export function specificGoalChips(ctx, limit = 18) {
    const count = new Map();
    for (const p of ctx.products.values()) {
        for (const id of new Set(p.descriptors.filter((d) => !['taste_attribute', 'style', 'mix_marker'].includes(d.group)).map((d) => d.id)))
            count.set(id, (count.get(id) ?? 0) + 1);
    }
    const groups = new Set(GOAL_GROUPS.map((g) => g.id));
    return [...count].filter(([id]) => !groups.has(id) && LEXICON.some((e) => e.id === id))
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit).map(([id, n]) => ({ id, ar: termAr(id), products: n }));
}
/** Wizard choices first, then the free text on top (the text can add, exclude and set counts). Deterministic. */
export function wizardToRequest(ws, ctx, seed = 0) {
    const base = defaultRequest({
        mode: ws.novel && ws.mode === 'PRECISION' ? 'DISCOVERY' : ws.mode,
        targetDescriptors: [...ws.goals],
        cooling: ws.cooling,
        sweetness: ws.sweetWanted ? 'high' : null,
        excludedFlavorIds: [...ws.excludedIds],
        stockOnly: ws.stockOnly,
        maxProducts: ws.maxProducts,
        gramsTotalMg: ws.gramsTotalMg,
        sourceQualityMin: ws.sourceQualityMin,
        seed,
    });
    const parsed = ws.freeText.trim() ? parseIntent(ws.freeText, ctx, base) : { request: base, understood: [], ignored: [] };
    const r = parsed.request;
    // a word typed as unwanted wins over the same word chosen as a goal (never both)
    r.targetDescriptors = r.targetDescriptors.filter((t) => !r.negativeDescriptors.includes(t));
    if (r.cooling === 'wanted' && r.negativeDescriptors.includes('cooling'))
        r.cooling = null;
    if (r.cooling === 'none' && r.targetDescriptors.includes('cooling'))
        r.targetDescriptors = r.targetDescriptors.filter((t) => t !== 'cooling');
    r.preferredFlavorIds = r.preferredFlavorIds.filter((id) => !r.excludedFlavorIds.includes(id));
    return { ...parsed, request: r, seed };
}
/** One line: what the generator was asked, in Arabic. */
export function requestSummaryAr(r, ctx) {
    const parts = [];
    const t = [...r.targetDescriptors, ...(r.cooling === 'wanted' ? ['cooling'] : []), ...(r.sweetness === 'high' ? ['sweet'] : [])];
    parts.push(t.length ? `طلبت: ${[...new Set(t)].map(termAr).join('، ')}` : 'بلا وصف محدد');
    const neg = [...r.negativeDescriptors, ...(r.cooling === 'none' ? ['cooling'] : [])];
    if (neg.length)
        parts.push(`بدون: ${[...new Set(neg)].map(termAr).join('، ')}`);
    if (r.excludedFlavorIds.length)
        parts.push(`مستبعد: ${r.excludedFlavorIds.map((id) => ctx.products.get(id)?.name ?? id).join('، ')}`);
    if (r.preferredFlavorIds.length)
        parts.push(`مفضّل: ${r.preferredFlavorIds.map((id) => ctx.products.get(id)?.name ?? id).join('، ')}`);
    parts.push(r.stockOnly ? 'من مخزونك فقط' : 'حتى من خارج مخزونك');
    parts.push(`حتى ${r.maxProducts} منتجات`);
    parts.push(grams(r.gramsTotalMg));
    parts.push(`نمط ${MODE_AR[r.mode].name.replace(' (افتراضي)', '')}`);
    return parts.join(' · ');
}
export function compareCandidates(a, b, ctx) {
    const rows = [];
    const ids = [...new Set([...a.ingredients.map((i) => i.flavorId), ...b.ingredients.map((i) => i.flavorId)])];
    const bpOf = (c, id) => c.ingredients.find((i) => i.flavorId === id);
    for (const id of ids) {
        const x = bpOf(a, id);
        const y = bpOf(b, id);
        rows.push({ label: ctx.products.get(id)?.name ?? id, a: x ? `${pct(x.basisPoints)} · ${grams(x.mg)}` : '—', b: y ? `${pct(y.basisPoints)} · ${grams(y.mg)}` : '—', same: !!x && !!y && x.basisPoints === y.basisPoints });
    }
    const row = (label, f) => { const va = f(a); const vb = f(b); rows.push({ label, a: va, b: vb, same: va === vb }); };
    row('المنشأ', (c) => DECISION_AR[c.decision]);
    row('الدليل', (c) => `${c.evidence.tier} · ${attributionAr(c.evidence.attribution)}`);
    row('يغطي طلبك', (c) => (c.targetMatch.covered.length ? c.targetMatch.covered.map(termAr).join('، ') : '—'));
    row('ينقصه', (c) => (c.targetMatch.missing.length ? c.targetMatch.missing.map(termAr).join('، ') : '—'));
    row('عدد المنتجات', (c) => String(c.ingredients.length));
    row('تنبيهات', (c) => String(c.warnings.length));
    row('مجاهيل', (c) => String(c.unknowns.length));
    row('المخزون', (c) => (c.validation.stock === 'pass' ? 'متوفر' : c.validation.stock === 'fail' ? 'ناقص' : 'لم يُطلب فحصه'));
    return rows;
}
export function recipeRows(bundle, ctx) {
    const versions = new Map(bundle.recipeVersions.map((v) => [v.versionId, v]));
    return bundle.recipes.map((r) => {
        const head = versions.get(r.headVersionId);
        const ref = ctx.references.find((x) => x.refId === r.headVersionId);
        return {
            recipeId: r.recipeId, name: r.name, origin: r.origin, originAr: ORIGIN_AR[r.origin], versions: r.versionIds.length,
            headIngredients: (head?.ingredients ?? []).map((i) => ctx.products.get(i.flavorId)?.name ?? i.flavorId).join(' · '),
            tier: ref?.tier ?? 'U', attribution: attributionAr(ref?.attribution ?? 'none'), support: ref?.support ?? 0, caution: ref?.caution ?? 0,
            mine: r.origin !== 'legacy_bundled',
        };
    }).sort((a, b) => Number(b.support > 0 && b.support >= b.caution) - Number(a.support > 0 && a.support >= a.caution) || b.support - a.support || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
export function versionTimeline(bundle, recipeId, ctx) {
    const r = bundle.recipes.find((x) => x.recipeId === recipeId);
    if (!r)
        return [];
    const byId = new Map(bundle.recipeVersions.map((v) => [v.versionId, v]));
    const label = new Map(r.versionIds.map((id, i) => [id, `V${i + 1}`]));
    const name = (id) => ctx.products.get(id)?.name ?? id;
    return r.versionIds.map((id) => {
        const v = byId.get(id);
        const parent = v.parentVersionId ? byId.get(v.parentVersionId) : undefined;
        const diff = parent ? diffVersions(parent.ingredients, v.ingredients).map((d) => ({
            name: name(d.flavorId), kind: d.kind,
            text: d.kind === 'added' ? `أُضيف ${pct(d.toBp)}` : d.kind === 'removed' ? `حُذف (كان ${pct(d.fromBp)})` : `${pct(d.fromBp)} ← ${pct(d.toBp)}`,
        })) : [];
        const ref = ctx.references.find((x) => x.refId === id);
        const o = ref?.observations;
        return {
            versionId: id, label: label.get(id), isHead: id === r.headVersionId, createdAt: v.createdAt, originAr: VERSION_ORIGIN_AR[v.origin],
            parentLabel: v.parentVersionId ? (label.get(v.parentVersionId) ?? `من «${ctx.references.find((x) => x.refId === v.parentVersionId)?.name ?? 'وصفة أخرى'}»`) : null,
            ingredients: v.ingredients.map((i) => ({ flavorId: i.flavorId, name: name(i.flavorId), basisPoints: i.basisPoints })),
            diff, structural: v.structuralStatus,
            evidence: { verified: o?.verified ?? 0, probable: o?.probable ?? 0, ambiguous: o?.ambiguous ?? 0, ratings: [...(o?.ratings ?? [])], tier: ref?.tier ?? 'U', attribution: attributionAr(ref?.attribution ?? 'none') },
        };
    });
}
export function packMgFor(events, flavorId, defaultPackMg) {
    let pack = null;
    for (const e of events) {
        if (e.flavorId !== flavorId)
            continue;
        if (e.type === 'purchase' && e.packMg)
            pack = e.packMg;
        if (e.type === 'opening_snapshot' && pack === null && e.legacyRaw && typeof e.legacyRaw['packG'] === 'number')
            pack = Math.round(e.legacyRaw['packG'] * 1000);
    }
    return pack && pack > 0 ? pack : defaultPackMg;
}
export function inventoryRows(bundle, ctx) {
    const bal = deriveBalances(bundle.inventoryEvents);
    return bundle.flavors.map((f) => {
        const b = bal.get(f.id);
        const packMg = packMgFor(bundle.inventoryEvents, f.id, bundle.settings.defaultPackMg);
        const available = b?.availableMg ?? 0;
        const p = Math.round((available / packMg) * 100);
        return {
            flavorId: f.id, name: ctx.products.get(f.id)?.name ?? f.name, brand: f.brand, availableMg: available, packMg, pctOfPack: p,
            low: p <= bundle.settings.lowStockPct, consumedSinceOpeningMg: b?.consumedSinceOpeningMg ?? 0,
            costPerGram: costPerGram(bundle.inventoryEvents, f.id), anomalies: b?.anomalies ?? [],
        };
    }).sort((a, b) => Number(b.low) - Number(a.low) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
/** Ingredient lines with grams for a formula (used by save/log dialogs). */
export function formulaLines(ings, ctx) {
    return ings.map((i) => `${ctx.products.get(i.flavorId)?.name ?? i.flavorId} ${pct(i.basisPoints)}`);
}
