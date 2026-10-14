import { ENGINE_VERSION } from "../domain/types.js";
import { apportionBp, TOTAL_BP } from "../domain/basisPoints.js";
import { allocateMg } from "../domain/grams.js";
import { canonicalJson, contentId, sha256Hex } from "../domain/hash.js";
import { recipeVersionId, diffVersions } from "../domain/recipeVersion.js";
import { canonicalIngredients, validateIngredients } from "../domain/validator.js";
import { findForbiddenClaims, ALLOWED_DECISIONS } from "../domain/vocabulary.js";
import { DESCRIPTOR_GROUPS, GROUP_LABEL_AR, LEXICON } from "../knowledge/descriptors.js";
import { counterexamples, hardCheck, heuristicWarnings, UNDESCRIBED_AR } from "./review.js";
import { canonicalShares, isDistinct } from "./similarity.js";
import { validateRequest, } from "./api.js";
const TIER_ORDINAL = { A: 5, B: 4, C: 3, D: 2, E: 1, U: 0 };
const KNOWN_TERMS = new Set([...LEXICON.map((e) => e.id), ...DESCRIPTOR_GROUPS]);
/** Arabic label of a descriptor id or group (for explanations). */
export function termAr(t) {
    return LEXICON.find((e) => e.id === t)?.ar ?? GROUP_LABEL_AR[t] ?? t;
}
/** CORE §4: the tier letter (repetition) is always shown with its attribution (where the record comes from). */
export function attributionAr(a) {
    return { exact: 'تقييماتك على هذه النسخة نفسها', probable_legacy: 'ربط مرجَّح من التطبيق القديم', published: 'وصفة منشورة غير مجرَّبة منك', none: 'بلا ملاحظات على هذه الصيغة' }[a];
}
/** "مرة واحدة / مرتين / 3 مرات / 11 مرة" */
export function timesAr(n) {
    if (n === 1)
        return 'مرة واحدة';
    if (n === 2)
        return 'مرتين';
    if (n >= 3 && n <= 10)
        return `${n} مرات`;
    return `${n} مرة`;
}
const uniq = (xs) => [...new Set(xs)];
/** A product answers a requested term when one of its descriptors is that term or belongs to that group. */
export const matches = (p, term) => !!p && p.descriptors.some((d) => d.id === term || d.group === term);
/** Flavor components of a product (taste words such as "sweet" are not components). */
export const components = (p) => new Set((p?.descriptors ?? []).filter((d) => d.group !== 'taste_attribute').map((d) => d.id));
/** Proportional re-apportionment to exactly 10 000 bp (largest remainder). */
export function reapportion(ings) {
    const bp = apportionBp(ings.map((i) => ({ key: i.flavorId, weight: i.basisPoints })));
    return ings.map((i) => ({ flavorId: i.flavorId, basisPoints: bp.get(i.flavorId) }));
}
export function generate(req, ctx, opts = {}) {
    const cfg = ctx.config;
    const requestId = opts.requestId ?? contentId('rq', { req, fp: ctx.dataFingerprint, cfg: cfg.id });
    const base = (status, messages, interpreted, candidates = [], stats = { referencesConsidered: 0, referencesEligible: 0, candidatesBuilt: 0, candidatesRejected: 0 }) => ({
        engineVersion: ENGINE_VERSION, configId: cfg.id, requestId, dataFingerprint: ctx.dataFingerprint, status, candidates, messages, interpreted, stats,
    });
    // ---- 1. normalize -----------------------------------------------------------
    const errors = validateRequest(req, new Set(ctx.products.keys()));
    const unknownTerms = [...req.targetDescriptors, ...req.negativeDescriptors].filter((t) => !KNOWN_TERMS.has(t));
    if (unknownTerms.length)
        errors.push(`unknown descriptors: ${unknownTerms.join(',')}`);
    const targets = uniq([...req.targetDescriptors, ...(req.cooling === 'wanted' ? ['cooling'] : []), ...(req.sweetness === 'high' ? ['sweet'] : [])]);
    const negatives = uniq([...req.negativeDescriptors, ...(req.cooling === 'none' ? ['cooling'] : [])]);
    if (targets.some((t) => negatives.includes(t)))
        errors.push('a descriptor is both wanted and unwanted');
    const interpretedBase = { targets, negatives, excluded: [], preferred: [...req.preferredFlavorIds], sourceQualityMin: req.sourceQualityMin, maxProducts: req.maxProducts };
    if (errors.length)
        return base('invalid_request', errors, interpretedBase);
    const canonOf = (id) => ctx.products.get(id)?.canonicalId ?? id;
    const excludedCanon = new Set(req.excludedFlavorIds.map(canonOf));
    for (const p of ctx.products.values())
        if (negatives.some((n) => matches(p, n)))
            excludedCanon.add(p.canonicalId);
    const excludedIds = [...ctx.products.values()].filter((p) => excludedCanon.has(p.canonicalId)).map((p) => p.id).sort();
    const excluded = new Set(excludedIds);
    const preferredCanon = new Set(req.preferredFlavorIds.map(canonOf));
    const interpreted = { ...interpretedBase, excluded: excludedIds };
    const stockOk = (id, ings, i) => {
        if (!req.stockOnly)
            return true;
        const mg = allocateMg(ings, req.gramsTotalMg)[i].mg;
        return (ctx.balancesMg.get(id) ?? 0) >= mg;
    };
    const targetMatch = (ings) => {
        const covered = targets.filter((t) => ings.some((i) => matches(ctx.products.get(i.flavorId), t)));
        const missing = targets.filter((t) => !covered.includes(t));
        const negativesPresent = negatives.filter((n) => ings.some((i) => matches(ctx.products.get(i.flavorId), n)));
        const weighted = targets.length
            ? targets.reduce((s, t) => s + Math.max(0, ...ings.filter((i) => matches(ctx.products.get(i.flavorId), t)).map((i) => i.basisPoints)) / TOTAL_BP, 0) / targets.length
            : 0;
        return { covered, missing, negativesPresent, coverage: targets.length ? covered.length / targets.length : 1, weighted };
    };
    // ---- 3. retrieve references ------------------------------------------------------
    const eligible = ctx.references.filter((r) => {
        if (r.support < r.caution)
            return false; // a formula rated low more than high is a counterexample, not a reference
        switch (req.sourceQualityMin) {
            case 'any': return true;
            // minimum quality, strictest last: any (adds U) ⊃ published (adds C) ⊃ recorded (A/B) ⊃ verified (A)
            case 'recorded': return (r.tier === 'A' || r.tier === 'B') && r.support >= 1;
            case 'published': return r.tier === 'C' || ((r.tier === 'A' || r.tier === 'B') && r.support >= 1);
            case 'verified': return (r.tier === 'A' || r.tier === 'B') && r.attribution === 'exact' && r.support >= 1;
        }
    });
    const relevant = eligible
        .map((r) => ({ r, tm: targetMatch(r.ingredients), pref: [...canonicalShares(ctx, r.ingredients).keys()].filter((c) => preferredCanon.has(c)).length }))
        .filter((x) => !targets.length || x.tm.coverage >= cfg.retrieval.minTargetCoverage || x.pref > 0)
        .sort((a, b) => b.pref - a.pref || b.tm.weighted - a.tm.weighted || TIER_ORDINAL[b.r.tier] - TIER_ORDINAL[a.r.tier] || b.r.support - a.r.support || (a.r.refId < b.r.refId ? -1 : 1))
        .slice(0, cfg.retrieval.maxReferences)
        .map((x) => x.r);
    // ---- 5. candidate pool ------------------------------------------------------
    const drafts = [];
    const draftFrom = (ref, ings, kind, notes, lost = []) => {
        const keepsEvidence = kind === 'exact' || kind === 'same_product_substitution';
        return { ings, kind, parent: kind === 'exact' ? null : ref, refs: [ref], tier: keepsEvidence ? ref.tier : 'D', attribution: keepsEvidence ? ref.attribution : 'none', notes, lostDescriptors: lost };
    };
    for (const ref of relevant) {
        const ings = ref.ingredients.map((i) => ({ ...i }));
        drafts.push(draftFrom(ref, ings, 'exact', []));
        // substitutions for excluded or (stock-only) short ingredients
        const problems = ings.map((ing, k) => ({ ing, k })).filter(({ ing, k }) => excluded.has(ing.flavorId) || !stockOk(ing.flavorId, ings, k));
        if (problems.length) {
            let fixed = ings.map((i) => ({ ...i }));
            let kind = 'same_product_substitution';
            const notes = [];
            for (const { ing, k } of problems) {
                const p = ctx.products.get(ing.flavorId);
                const inUse = new Set(fixed.map((x) => canonOf(x.flavorId)));
                const same = p.sameAs.find((s) => !excluded.has(s) && stockOk(s, fixed, k));
                if (same) {
                    notes.push(`استُبدل «${p.name}» بـ«${ctx.products.get(same).name}» — قلتَ إنهما المنتج نفسه.`);
                    fixed[k] = { flavorId: same, basisPoints: ing.basisPoints };
                    continue;
                }
                const comp = components(p);
                const equiv = p.sourced && comp.size
                    ? [...ctx.products.values()].filter((q) => q.sourced && !excluded.has(q.id) && !inUse.has(q.canonicalId) && q.id !== p.id
                        && [...comp].every((c) => components(q).has(c)) && components(q).size === comp.size && stockOk(q.id, fixed, k)).sort((a, b) => (a.id < b.id ? -1 : 1))[0]
                    : undefined;
                if (equiv) {
                    kind = 'equivalent_substitution';
                    notes.push(`استُبدل «${p.name}» بـ«${equiv.name}» لأن نصّيهما يذكران المكوّنات نفسها (${[...comp].join('، ')}). استبدال غير مجرَّب.`);
                    fixed[k] = { flavorId: equiv.id, basisPoints: ing.basisPoints };
                    continue;
                }
                fixed = null;
                break;
            }
            if (fixed)
                drafts.push(draftFrom(ref, fixed, kind, notes));
        }
        // preferred product not in the reference: swap the ingredient whose identity it covers
        for (const prefCanon of preferredCanon) {
            if (canonicalShares(ctx, ings).has(prefCanon))
                continue;
            const pref = [...ctx.products.values()].find((q) => q.canonicalId === prefCanon && !excluded.has(q.id));
            if (!pref)
                continue;
            const pc = components(pref);
            const swaps = ings.map((ing, k) => ({ ing, k, comp: components(ctx.products.get(ing.flavorId)) }))
                .filter((x) => x.comp.size > 0 && [...x.comp].every((c) => pc.has(c)))
                .sort((a, b) => b.comp.size - a.comp.size || b.ing.basisPoints - a.ing.basisPoints || a.k - b.k);
            if (swaps.length) {
                const s = swaps[0];
                const out = ings.map((i) => ({ ...i }));
                out[s.k] = { flavorId: pref.id, basisPoints: s.ing.basisPoints };
                drafts.push(draftFrom(ref, out, 'preferred_swap', [`وُضع «${pref.name}» مكان «${ctx.products.get(s.ing.flavorId).name}» لأن نصّه يذكر المكوّنات نفسها وأكثر (${[...s.comp].join('، ')}). تعديل غير مجرَّب.`]));
            }
        }
        // reduction to the product limit (least complexity, ENGINE §6)
        if (ings.length > req.maxProducts) {
            let cur = ings.map((i) => ({ ...i }));
            const lost = [];
            while (cur.length > req.maxProducts) {
                const before = targetMatch(cur).covered.length;
                const order = cur.map((ing, k) => ({ ing, k, keeps: targetMatch(cur.filter((_, j) => j !== k)).covered.length === before }))
                    .sort((a, b) => Number(b.keeps) - Number(a.keeps) || a.ing.basisPoints - b.ing.basisPoints || (a.ing.flavorId < b.ing.flavorId ? -1 : 1));
                const drop = order[0];
                const others = new Set(cur.filter((_, j) => j !== drop.k).flatMap((x) => [...components(ctx.products.get(x.flavorId))]));
                for (const c of components(ctx.products.get(drop.ing.flavorId)))
                    if (!others.has(c) && !lost.includes(c))
                        lost.push(c);
                cur = reapportion(cur.filter((_, j) => j !== drop.k));
            }
            drafts.push(draftFrom(ref, cur, 'reduced', [`قُلّصت إلى ${req.maxProducts} منتجات كما طلبت، ووُزّعت النسبة المحذوفة على الباقي بالتناسب.`], lost));
        }
    }
    // exploratory structures — only when the mode allows hypotheses
    if ((req.mode === 'SIGNATURE' || req.mode === 'DISCOVERY') && targets.length) {
        const pool = [...ctx.products.values()].filter((p) => !excluded.has(p.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
        const chosen = [];
        const left = new Set(targets);
        const k = Math.min(req.maxProducts, 3);
        while (chosen.length < k && left.size) {
            const best = pool.filter((p) => !chosen.some((c) => c.canonicalId === p.canonicalId))
                .map((p) => ({ p, gain: [...left].filter((t) => matches(p, t)).length, pref: preferredCanon.has(p.canonicalId) ? 1 : 0, stock: (ctx.balancesMg.get(p.id) ?? 0) > 0 ? 1 : 0, src: p.auditStatus === 'verified' ? 2 : p.sourced ? 1 : 0 }))
                .filter((x) => x.gain > 0)
                .sort((a, b) => b.pref - a.pref || b.gain - a.gain || b.stock - a.stock || b.src - a.src || (a.p.id < b.p.id ? -1 : 1))[0];
            if (!best)
                break;
            chosen.push(best.p);
            for (const t of targets)
                if (matches(best.p, t))
                    left.delete(t);
        }
        // proportion template: median shares of the owner's supported formulas with this many
        // products; if none exist, the leading shares of the nearest larger template, rescaled
        // (a one-product "blend" is not a structure: nothing to apportion below 2 products)
        let tpl = chosen.length >= 2 ? ctx.proportionTemplates.get(chosen.length) : undefined;
        let tplNote = '';
        if (!tpl && chosen.length >= 2) {
            const larger = [...ctx.proportionTemplates.keys()].filter((n) => n > chosen.length).sort((a, b) => a - b)[0];
            if (larger !== undefined) {
                const head = ctx.proportionTemplates.get(larger).slice(0, chosen.length);
                const bp = apportionBp(head.map((w, j) => ({ key: String(j), weight: w })));
                tpl = head.map((_, j) => bp.get(String(j)));
                tplNote = ` (لا توجد وصفات مسجّلة بـ${chosen.length} منتجات؛ أُخذت أكبر ${chosen.length} حصص من قالب ${larger} منتجات وأُعيد توزيعها)`;
            }
        }
        if (chosen.length >= 2 && tpl) {
            const ings = chosen.map((p, j) => ({ flavorId: p.id, basisPoints: tpl[j] }));
            drafts.push({ ings, kind: 'exploratory', parent: null, refs: [], tier: 'E', attribution: 'none', notes: [`فرضية استكشافية: اختيرت المنتجات لأنها تغطي ما طلبته، والنسب من قالب وسيط لوصفاتك المسجّلة${tplNote} — ليست قياساً.`], lostDescriptors: [] });
        }
    }
    // ---- 6–9. normalize, hard reject, heuristics, counterexamples -------------------------
    const seen = new Set();
    const scored = [];
    let rejected = 0;
    for (const d of drafts) {
        const key = canonicalJson(canonicalIngredients(d.ings));
        if (seen.has(key))
            continue;
        seen.add(key);
        const check = hardCheck(ctx, d.ings, { gramsTotalMg: req.gramsTotalMg, stockOnly: req.stockOnly, excluded, maxProducts: req.maxProducts });
        const tm = targetMatch(d.ings);
        if (check.structural === 'fail' || check.stock === 'fail' || tm.negativesPresent.length || (targets.length && tm.coverage < cfg.retrieval.minTargetCoverage && !d.ings.some((i) => preferredCanon.has(canonOf(i.flavorId))))) {
            rejected++;
            continue;
        }
        // unknown identities are listed under `unknowns`; the doctor shows them as warnings
        const warnings = [...heuristicWarnings(ctx, d.ings, req.stockOnly ? [] : check.shortages).filter((w) => w.code !== 'no_published_description'), ...counterexamples(ctx, d.ings, new Set(d.refs.map((r) => r.refId)))];
        const uncertainty = d.ings.reduce((s, i) => s + (ctx.products.get(i.flavorId)?.sourced ? 0 : i.basisPoints), 0) / TOTAL_BP;
        scored.push({
            ...d, key, check, covered: tm.covered, missing: tm.missing, negativesPresent: tm.negativesPresent, targetScore: tm.weighted, warnings, uncertainty,
            stockShort: check.shortages.length ? 1 : 0, front: 0, score: 0,
            tiebreak: sha256Hex(`${req.seed}|${key}`),
        });
    }
    // ---- 10–11. rank (Pareto + weighted tie-break) and diversify ------------------------
    const redundancy = (s) => s.warnings.filter((w) => w.code.startsWith('potential_redundancy') || w.code === 'legacy_potential_redundancy').length;
    const evidenceValue = (s) => TIER_ORDINAL[s.tier] / 5 + Math.min(s.refs[0]?.support ?? 0, 10) / 100;
    const rank = (weights) => {
        const vec = (s) => [evidenceValue(s), s.targetScore, -redundancy(s), -s.uncertainty, -s.stockShort];
        const dominated = (a, b) => { const va = vec(a); const vb = vec(b); return vb.every((x, i) => x >= va[i]) && vb.some((x, i) => x > va[i]); };
        const remaining = [...scored];
        const front = new Map();
        let f = 0;
        while (remaining.length) {
            const layer = remaining.filter((a) => !remaining.some((b) => b !== a && dominated(a, b)));
            for (const a of layer) {
                front.set(a, f);
                remaining.splice(remaining.indexOf(a), 1);
            }
            f++;
        }
        const score = (s) => weights.evidence * evidenceValue(s) + weights.target * s.targetScore - weights.redundancy * redundancy(s)
            - weights.uncertainty * s.uncertainty - weights.complexity * (s.ings.length / 8) - weights.stock * s.stockShort;
        return [...scored].sort((a, b) => front.get(a) - front.get(b) || score(b) - score(a) || (a.tiebreak < b.tiebreak ? -1 : 1))
            .map((s) => ({ ...s, front: front.get(s), score: score(s) }));
    };
    const diversify = (ranked) => {
        const out = [];
        for (const s of ranked) {
            if (out.length >= 3)
                break;
            if (out.every((o) => isDistinct(ctx, o.ings, s.ings)))
                out.push(s);
        }
        return out;
    };
    const ranked = rank(cfg.ranking.weights);
    const selected = diversify(ranked);
    // robustness: does each selection survive ± perturbation of every weight?
    const keys = Object.keys(cfg.ranking.weights);
    const survives = new Map(selected.map((s) => [s.key, true]));
    for (const k of keys)
        for (const sign of [1, -1]) {
            const w = { ...cfg.ranking.weights, [k]: cfg.ranking.weights[k] * (1 + sign * cfg.ranking.perturbation) };
            const alt = new Set(diversify(rank(w)).map((s) => s.key));
            for (const s of selected)
                if (!alt.has(s.key))
                    survives.set(s.key, false);
        }
    // ---- 12. assemble + independent validator -------------------------------------
    const slots = ['reference_like', 'alternative_architecture', 'more_original'];
    const messages = [];
    const candidates = [];
    selected.forEach((s, idx) => {
        const c = assemble(ctx, req, s, slots[idx], survives.get(s.key) ? 'stable' : 'sensitive', ranked.findIndex((x) => x.key === s.key));
        const problems = independentValidator(ctx, req, c);
        if (problems.length) {
            messages.push(`candidate dropped by the independent validator: ${problems.join('; ')}`);
            return;
        }
        candidates.push(c);
    });
    const stats = { referencesConsidered: ctx.references.length, referencesEligible: eligible.length, candidatesBuilt: drafts.length, candidatesRejected: rejected };
    if (!candidates.length) {
        messages.push(req.mode === 'PRECISION' || req.mode === 'REFERENCE'
            ? 'لا توجد صيغة مسجّلة أو منشورة تدعم هذا الطلب بالقيود المحددة. يمكنك تخفيف القيود أو طلب وضع الاستكشاف (فرضية غير مختبرة).'
            : 'لا توجد صيغة مدعومة ولا مكوّنات كافية لبناء فرضية بهذه القيود.');
        return base('insufficient_evidence', messages, interpreted, [], stats);
    }
    if (candidates.length < 3)
        messages.push(`أُعيد ${candidates.length} فقط لأن البدائل الأخرى إما مكررة فعلياً أو غير مدعومة — أفضل من بدائل ملفقة.`);
    return base('ok', messages, interpreted, candidates, stats);
}
function decisionFor(s) {
    if (s.kind === 'exploratory')
        return 'exploratory';
    if (s.kind === 'exact' || s.kind === 'same_product_substitution')
        return s.tier === 'U' ? 'unknown' : 'reference_supported';
    return 'adapted_with_uncertainty';
}
function evidenceSummary(s) {
    const r = s.refs[0];
    const o = r?.observations;
    const high = r?.support ?? 0;
    const low = r?.caution ?? 0;
    switch (s.tier) {
        case 'A':
        case 'B':
            return s.attribution === 'exact'
                ? `سُجّلت هذه الصيغة بالضبط ${timesAr(o.verified)}: ${high} بتقييم 4–5 و${low} بتقييم منخفض.`
                : `سُجّلت هذه الصيغة على الأرجح ${timesAr(o.probable)} (ربط السجل بالنسخة استنتاج من تاريخ التعديل): ${high} بتقييم 4–5 و${low} بتقييم منخفض.`;
        case 'C':
            return 'صيغة منشورة بنسبها الكاملة في مصدر علني — مرجع منشور، وليست نتيجة تجربة لديك.';
        case 'D':
            return `تعديل على «${s.parent?.name ?? '—'}» (${s.parent?.tier ?? 'U'}). التعديل نفسه لم يُجرَّب، وتقييم الصيغة الأم لا ينتقل إليه.`;
        case 'E':
            return 'فرضية استكشافية لم تُجرَّب.';
        default:
            return 'صيغة من كتاب التطبيق القديم بلا تجربة مسجّلة لها.';
    }
}
function assemble(ctx, req, s, slot, robustness, rankIndex) {
    const alloc = allocateMg(s.ings, req.gramsTotalMg);
    const parentVersionId = s.parent?.versionId ?? null;
    const recipeVersion = s.kind === 'exact' && s.refs[0]?.versionId
        ? s.refs[0].versionId
        : recipeVersionId(`candidate:${s.parent?.recipeId ?? 'exploratory'}`, parentVersionId, s.ings);
    const name = s.kind === 'exact' ? s.refs[0].name
        : s.kind === 'exploratory' ? `فرضية: ${s.ings.map((i) => ctx.products.get(i.flavorId).name).join(' + ')}`
            : `تعديل على «${s.parent.name}»`;
    const rationale = [];
    if (s.covered.length)
        rationale.push(`يغطي ما طلبته: ${s.covered.map(termAr).join('، ')}.`);
    if (s.missing.length)
        rationale.push(`لا يغطي: ${s.missing.map(termAr).join('، ')}.`);
    if (req.stockOnly)
        rationale.push('كل المكوّنات متوفرة في مخزونك بالكميات المحسوبة.');
    rationale.push(...s.notes);
    if (slot === 'alternative_architecture')
        rationale.push('بديل بمكوّنات مختلفة فعلاً عن الاقتراح الأول.');
    if (slot === 'more_original')
        rationale.push('البديل الأبعد عن الاقتراحين الأولين.');
    const unknowns = ['لا يوجد قياس لشدة أي منتج؛ النسب ليست معايرة حسياً.'];
    for (const i of s.ings)
        if (!ctx.products.get(i.flavorId).sourced)
            unknowns.push(`لا يوجد نص منشور يصف «${ctx.products.get(i.flavorId).name}»؛ وصفه مستنتج من اسمه فقط.`);
    if (s.attribution === 'probable_legacy')
        unknowns.push('التطبيق القديم لم يحفظ لقطة للنسخة؛ ربط التقييمات بها استنتاج.');
    if (s.lostDescriptors.length)
        unknowns.push(`قد تضعف بعد التقليص: ${s.lostDescriptors.map(termAr).join('، ')}.`);
    const r0o = s.refs[0]?.observations;
    if (r0o && r0o.clustered > 0 && (s.kind === 'exact' || s.kind === 'same_product_substitution'))
        unknowns.push(`${r0o.clustered} من هذه السجلات تشترك في توقيت واحد؛ لا يُفترض أنها تجارب مستقلة.`);
    if (robustness === 'sensitive')
        unknowns.push('ترتيب هذا الاقتراح يتغير إذا غُيّرت أوزان الترتيب قليلاً.');
    // least-complexity variant (ENGINE §6) — shown as an option, never as "better"
    let simplerVariant = null;
    if (s.ings.length > 2) {
        const opts = s.ings.map((ing, k) => {
            const rest = s.ings.filter((_, j) => j !== k);
            const others = new Set(rest.flatMap((x) => [...components(ctx.products.get(x.flavorId))]));
            const own = components(ctx.products.get(ing.flavorId));
            // an ingredient of unknown identity may carry anything: never the "cheapest" to drop
            const unknown = own.size === 0;
            const lost = [...own].filter((c) => !others.has(c));
            return { ing, k, rest, lost, unknown, losesTarget: s.covered.some((t) => matches(ctx.products.get(ing.flavorId), t) && !rest.some((x) => matches(ctx.products.get(x.flavorId), t))) };
        }).filter((o) => !o.losesTarget).sort((a, b) => Number(a.unknown) - Number(b.unknown) || a.lost.length - b.lost.length || a.ing.basisPoints - b.ing.basisPoints || (a.ing.flavorId < b.ing.flavorId ? -1 : 1));
        if (opts.length)
            simplerVariant = { ingredients: reapportion(opts[0].rest), removed: opts[0].ing.flavorId, lostDescriptors: opts[0].unknown ? [UNDESCRIBED_AR] : opts[0].lost.map(termAr) };
    }
    const r0 = s.refs[0];
    return {
        recipeVersionId: recipeVersion, parentVersionId, mode: req.mode, slot, decision: decisionFor(s), name,
        ingredients: alloc.map((a) => ({ flavorId: a.flavorId, name: ctx.products.get(a.flavorId).name, brand: ctx.products.get(a.flavorId).brand, basisPoints: a.basisPoints, mg: a.mg })),
        gramsTotalMg: req.gramsTotalMg,
        referenceIds: s.refs.map((r) => r.refId),
        references: s.refs.map((r) => ({ refId: r.refId, kind: r.kind, name: r.name, url: r.url })),
        evidence: {
            tier: s.tier, attribution: s.attribution, summaryAr: evidenceSummary(s),
            // Records belong to an exact formula: an adaptation or hypothesis shows none (no inheritance).
            observations: s.tier === 'D' || s.tier === 'E' || !r0
                ? { verified: 0, probable: 0, ratingsHigh: 0, ratingsLow: 0, sessions: 0 }
                : { verified: r0.observations.verified, probable: r0.observations.probable, ratingsHigh: r0.support, ratingsLow: r0.caution, sessions: r0.observations.sessions },
        },
        targetMatch: { covered: s.covered, missing: s.missing, negativesPresent: s.negativesPresent },
        diff: s.parent ? diffVersions(s.parent.ingredients, s.ings) : null,
        rationale, warnings: s.warnings, unknowns, simplerVariant, robustness,
        rankingIndexNotProbability: rankIndex,
        validation: { structural: s.check.structural, stock: s.check.stock, independent: 'pass' },
    };
}
/** Stage 12: re-check everything from scratch; any failure drops the candidate. */
export function independentValidator(ctx, req, c) {
    const p = [];
    const ings = c.ingredients.map((i) => ({ flavorId: i.flavorId, basisPoints: i.basisPoints }));
    const v = validateIngredients(ings, { knownFlavorIds: new Set(ctx.products.keys()) });
    if (v.status !== 'pass')
        p.push(`structure: ${v.errors.map((e) => e.code).join(',')}`);
    if (ings.reduce((s, i) => s + i.basisPoints, 0) !== TOTAL_BP)
        p.push('bp sum');
    if (c.ingredients.reduce((s, i) => s + i.mg, 0) !== req.gramsTotalMg)
        p.push('mg sum');
    if (new Set(ings.map((i) => ctx.products.get(i.flavorId)?.canonicalId)).size !== ings.length)
        p.push('same product twice');
    if (ings.length > req.maxProducts)
        p.push('product limit');
    if (req.stockOnly)
        for (const i of c.ingredients)
            if ((ctx.balancesMg.get(i.flavorId) ?? 0) < i.mg)
                p.push(`stock ${i.flavorId}`);
    for (const id of c.referenceIds)
        if (!ctx.references.some((r) => r.refId === id))
            p.push(`invented reference ${id}`);
    for (const w of c.warnings)
        for (const b of w.basis) {
            const isRef = ctx.references.some((r) => r.refId === b);
            const isRel = w.flavorIds.length === 2 && w.flavorIds[0] !== w.flavorIds[1] && ctx.relationships.between(w.flavorIds[0], w.flavorIds[1]).some((r) => r.claimId === b);
            if (!isRef && !isRel)
                p.push(`warning cites unknown record ${b}`);
        }
    if (!ALLOWED_DECISIONS.includes(c.decision))
        p.push('decision vocabulary');
    const expected = { A: 'reference_supported', B: 'reference_supported', C: 'reference_supported', D: 'adapted_with_uncertainty', E: 'exploratory', U: 'unknown' };
    if (c.decision !== expected[c.evidence.tier])
        p.push(`decision ${c.decision} does not match evidence tier ${c.evidence.tier}`);
    for (const t of [c.name, c.evidence.summaryAr, ...c.rationale, ...c.unknowns, ...c.warnings.map((w) => w.textAr)]) {
        const hits = findForbiddenClaims(t);
        if (hits.length)
            p.push(`forbidden wording: ${hits.map((h) => h.id).join(',')}`);
    }
    return p;
}
