import { ENGINE_VERSION } from "../domain/types.js";
import { sha256Hex } from "../domain/hash.js";
import { claimVersioningProblems, requiredSourceKind } from "../domain/claims.js";
import { SEED_SOURCES } from "../domain/sourceRegistry.js";
import { findForbiddenClaims } from "../domain/vocabulary.js";
import { parseOwnerDecisions, decisionFor, identityAnswers } from "../domain/ownerDecisions.js";
import { parseResearchBatch, DISPUTING_ISSUE_CODES } from "./researchBatch.js";
import { ingestResearchBatch, INGEST_VERSION } from "./ingest.js";
import { DESCRIPTOR_LEXICON_VERSION } from "./descriptors.js";
import { applyClaimReviews, parseClaimReviews } from "./reviews.js";
import { CORPUS_RULES_VERSION, ingestCorpus, parseCorpusFile, productSuggestions } from "./corpus.js";
import { computeUsage } from "./usage.js";
import { AUDIT_DETAIL_AR, buildCtx, buildPassport, PASSPORT_FIELDS } from "./passport.js";
export const KNOWLEDGE_PACK_SCHEMA = 'mizaj-knowledge-pack@1';
const count = (xs, key) => {
    const o = {};
    for (const x of xs)
        o[key(x)] = (o[key(x)] ?? 0) + 1;
    return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
};
function reviewQueue(pack, current) {
    const q = [];
    const byId = new Map(pack.claims.map((c) => [c.claimId, c]));
    const nameById = new Map(pack.passports.map((p) => [p.flavorId, p.name]));
    for (const p of pack.passports) {
        for (const t of p.manufacturerTexts) {
            if (!current.has(t.claimId) || (t.status !== 'plausible' && t.status !== 'unverified'))
                continue;
            const differs = t.status === 'unverified';
            q.push({
                claimId: t.claimId, kind: differs ? 'manufacturer_name_differs' : 'manufacturer_text', priorityRank: p.usage?.rank ?? null, flavorId: p.flavorId, brand: p.brand,
                libraryName: p.name, observedName: t.observedName ?? t.observedNameRu, excerpt: t.text, url: t.url,
                questionAr: differs
                    ? `اسم المنتج في صفحة المصنّع «${t.observedName ?? '—'}» يختلف عن اسمه في مكتبتك «${p.name}». إن كان المنتج نفسه وكان النص صحيحاً اكتب verify، وإن لم يكن اكتب reject.`
                    : `هل هذا هو نص المصنّع لمنتج «${p.name}» كما يظهر في الرابط؟ اكتب verify للتوثيق أو reject للرفض.`,
                allowedActions: ['verify', 'reject'],
            });
        }
        for (const i of p.identity) {
            if (!i.disputing || i.resolvedBy || i.status === 'rejected' || !current.has(i.claimId))
                continue;
            const related = (byId.get(i.claimId)?.claimValue?.relatedFlavorIds ?? [])
                .map((id) => nameById.get(id) ?? id).map((n) => `«${n}»`).join('، ');
            const what = i.code === 'possible_duplicate_product'
                ? `قد يكون «${p.name}» و${related || 'منتج آخر'} في مكتبتك منتجاً واحداً باسمين.`
                : i.code === 'brand_not_confirmed'
                    ? `لم يُعثر على «${p.name}» ضمن قائمة علامة «${p.brand}» في المصادر؛ قد تكون العلامة أو الاسم غير صحيح.`
                    : `ملاحظتك القديمة عن «${p.name}» تخالف ما وُجد في المصادر.`;
            q.push({
                claimId: i.claimId, kind: 'identity_dispute', priorityRank: p.usage?.rank ?? null, flavorId: p.flavorId, brand: p.brand,
                libraryName: p.name, observedName: null, excerpt: i.detail, url: byId.get(i.claimId)?.sourceRef ?? null,
                questionAr: `${what} إن كان هذا غير صحيح اكتب reject لإغلاق الملاحظة؛ وإن كان صحيحاً فاتركها واكتب في owner_note ما الصحيح (لن يُدمج أو يُعدَّل شيء تلقائياً).`,
                allowedActions: ['reject'],
            });
        }
    }
    const brandClaims = pack.claims.filter((c) => current.has(c.claimId) && c.entityType === 'brand' && c.claimType === 'manufacturer_self_identification' && c.verificationStatus === 'plausible');
    for (const c of brandClaims) {
        q.push({
            claimId: c.claimId, kind: 'brand_attribution', priorityRank: null, flavorId: null, brand: c.entityId, libraryName: null,
            observedName: String(c.claimValue), excerpt: c.methodOrExcerpt, url: c.sourceRef,
            questionAr: `هل الشركة المصنّعة لعلامة «${c.entityId}» هي «${String(c.claimValue)}» كما تذكر صفحتها الرسمية؟ اكتب verify أو reject.`,
            allowedActions: ['verify', 'reject'],
        });
    }
    q.sort((a, b) => (a.priorityRank ?? 1e9) - (b.priorityRank ?? 1e9) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.claimId < b.claimId ? -1 : 1));
    return q;
}
export function buildKnowledgePack(inp) {
    const b = inp.bundle;
    const parsedBatches = inp.researchTexts.map((t) => ({ batch: parseResearchBatch(t), sha256: sha256Hex(t) })).sort((x, y) => (x.batch.batchId < y.batch.batchId ? -1 : 1));
    const batches = parsedBatches.map((x) => x.batch);
    const seenBatch = new Set();
    for (const x of batches) {
        if (seenBatch.has(x.batchId))
            throw new Error(`duplicate research batch ${x.batchId}`);
        seenBatch.add(x.batchId);
    }
    const decisions = inp.ownerDecisionsText ? parseOwnerDecisions(inp.ownerDecisionsText) : null;
    const reviews = inp.claimReviewsText ? parseClaimReviews(inp.claimReviewsText) : null;
    const corpusFiles = inp.corpusTexts.map(parseCorpusFile);
    const sources = [...SEED_SOURCES];
    const claims = [];
    const unknownProducts = [];
    const researched = new Set();
    for (const batch of batches) {
        const r = ingestResearchBatch(batch, b.flavors);
        sources.push(...r.sources);
        claims.push(...r.claims);
        unknownProducts.push(...r.unknownProducts.map((x) => `${batch.batchId}:${x}`));
        for (const p of batch.products)
            if (b.flavors.some((f) => f.id === p.flavorId))
                researched.add(p.flavorId);
    }
    // Names the owner has confirmed (verified maker texts + identity answers) — used to map
    // published formulas. A preliminary review pass on research claims only; the final pass
    // below covers every claim.
    const prelim = applyClaimReviews(claims, sources, reviews);
    const confirmed = new Map();
    const addName = (id, n) => { if (n && n.trim())
        confirmed.set(id, [...(confirmed.get(id) ?? []), n]); };
    for (const c of prelim.claims) {
        if (c.claimType === 'manufacturer_description' && c.verificationStatus === 'verified')
            addName(c.entityId, c.claimValue.observedName);
    }
    for (const d of identityAnswers(decisions).values())
        if (d.value === 'same_as_observed_name')
            addName(d.scope.flavorIds[0], d.details?.observedName);
    const corpus = ingestCorpus(corpusFiles, b.flavors, confirmed);
    sources.push(...corpus.sources);
    claims.push(...corpus.claims);
    const outcome = applyClaimReviews(claims, sources, reviews);
    const allClaims = outcome.claims;
    const ctx = buildCtx(allClaims, sources);
    const usage = computeUsage(b);
    const usageById = new Map(usage.map((u) => [u.flavorId, u]));
    const legacyByFlavor = new Map();
    for (const c of b.claims) {
        if (c.entityType !== 'flavor')
            continue;
        const l = legacyByFlavor.get(c.entityId) ?? [];
        l.push(c);
        legacyByFlavor.set(c.entityId, l);
    }
    const idAnswers = identityAnswers(decisions);
    const passports = b.flavors.map((f) => buildPassport(f, ctx, legacyByFlavor.get(f.id) ?? [], usageById.get(f.id), researched, idAnswers))
        .sort((x, y) => (x.usage?.rank ?? 1e9) - (y.usage?.rank ?? 1e9) || (x.flavorId < y.flavorId ? -1 : 1));
    const currentIds = new Set(ctx.current.map((c) => c.claimId));
    const queue = reviewQueue({ passports, claims: allClaims }, currentIds);
    const top20 = passports.slice(0, 20);
    const brands = [...new Set(passports.map((p) => p.brand))].sort();
    const coverage = {
        products: passports.length,
        researched: passports.filter((p) => p.researched).length,
        byAuditStatus: count(passports, (p) => p.auditStatus),
        byAuditDetail: count(passports, (p) => p.auditDetail),
        byField: Object.fromEntries(PASSPORT_FIELDS.map((k) => [k, count(passports, (p) => p.fieldStatus[k])])),
        byBrand: brands.map((br) => {
            const ps = passports.filter((p) => p.brand === br);
            return { brand: br, products: ps.length, researched: ps.filter((p) => p.researched).length, verified: ps.filter((p) => p.auditStatus === 'verified').length, disputed: ps.filter((p) => p.auditStatus === 'disputed').length };
        }),
        sourcesByRole: count(sources, (s) => s.publisherRole ?? 'none'),
        sourcesByAudit: count(sources, (s) => s.auditStatus),
        claimsByStatus: count(ctx.current, (c) => c.verificationStatus),
        verifiedClaims: ctx.current.filter((c) => c.verificationStatus === 'verified').length,
        corpus: { accepted: corpus.decisions.filter((d) => d.status === 'accepted').length, rejected: corpus.decisions.filter((d) => d.status === 'rejected').length, duplicate: corpus.decisions.filter((d) => d.status === 'duplicate').length },
        reviews: { applied: outcome.applied.length, refused: outcome.refused.length },
        top20ByUsage: { researched: top20.filter((p) => p.researched).length, withManufacturerText: top20.filter((p) => p.manufacturerTexts.length > 0).length },
    };
    const priority = decisionFor(decisions, 'knowledge_audit_priority');
    return {
        schema: KNOWLEDGE_PACK_SCHEMA,
        engineVersion: ENGINE_VERSION,
        rules: { ingest: INGEST_VERSION, lexicon: DESCRIPTOR_LEXICON_VERSION, corpus: CORPUS_RULES_VERSION },
        inputs: {
            bundleSha256: inp.bundleSha256,
            bundleFlavorCount: b.flavors.length,
            researchBatches: parsedBatches.map(({ batch: x, sha256 }) => ({ batchId: x.batchId, sha256, collector: `${x.collector.kind}:${x.collector.id}`, collectedAt: x.collectedAt })),
            ownerDecisionsSha256: inp.ownerDecisionsText ? sha256Hex(inp.ownerDecisionsText) : null,
            claimReviewsSha256: inp.claimReviewsText ? sha256Hex(inp.claimReviewsText) : null,
            corpusFiles: corpusFiles.map((c, i) => ({ corpusId: c.corpusId, sha256: sha256Hex(inp.corpusTexts[i]), entries: c.entries.length })),
            priorityDecision: priority ? `${priority.decisionId}:${priority.value}` : null,
        },
        sources,
        claims: allClaims,
        passports,
        usage,
        corpus: corpus.decisions,
        productSuggestions: productSuggestions(corpus.decisions),
        reviews: { applied: outcome.applied, refused: outcome.refused },
        reviewQueue: queue,
        unknownProducts,
        coverage,
    };
}
const POINTER = /^(https:\/\/\S+|legacy:\S+|research:\S+|derived:cl_[0-9a-f]{20}|decision:OD-[0-9A-Za-z-]+)$/;
/** P1 accept-gate checks. Returns problems (empty = pass). */
export function knowledgePackProblems(pack, bundle) {
    const p = [];
    const all = new Map([...bundle.claims, ...pack.claims].map((c) => [c.claimId, c]));
    const superseded = new Set(pack.claims.map((c) => c.supersedesClaimId).filter(Boolean));
    const ids = new Set();
    for (const c of pack.claims) {
        if (ids.has(c.claimId))
            p.push(`duplicate claim id ${c.claimId}`);
        ids.add(c.claimId);
        if (bundle.claims.some((x) => x.claimId === c.claimId))
            p.push(`pack claim ${c.claimId} collides with a bundle claim`);
    }
    p.push(...claimVersioningProblems(pack.claims));
    const srcIds = new Set();
    for (const s of pack.sources) {
        if (srcIds.has(s.sourceId))
            p.push(`duplicate source id ${s.sourceId}`);
        srcIds.add(s.sourceId);
        if (s.kind === 'MANUFACTURER_DESCRIPTION' && s.publisherRole !== 'manufacturer')
            p.push(`source ${s.sourceId}: MANUFACTURER_DESCRIPTION must be published by the manufacturer`);
    }
    for (const c of pack.claims) {
        if (c.safetySensitive && c.usage !== 'excluded')
            p.push(`claim ${c.claimId}: safety-sensitive must be excluded`);
        if (c.verificationStatus !== 'verified')
            continue;
        if (c.sourceType === 'LEGACY_UNVERIFIED' || c.sourceType === 'MODEL_INFERENCE' || c.sourceType === 'UNKNOWN')
            p.push(`claim ${c.claimId}: verified from a non-verifying source type ${c.sourceType}`);
        if (!/^https:\/\//.test(c.sourceRef ?? ''))
            p.push(`claim ${c.claimId}: verified without a URL`);
        if (!/^(human|process):/.test(c.reviewerOrProcess))
            p.push(`claim ${c.claimId}: verified without a human/process reviewer`);
        const req = requiredSourceKind(c.claimType);
        if (req && c.sourceType !== req)
            p.push(`claim ${c.claimId}: ${c.claimType} verified by ${c.sourceType}`);
        const src = pack.sources.find((s) => s.url === c.sourceRef && s.kind === c.sourceType);
        if (!src || src.auditStatus !== 'link_checked')
            p.push(`claim ${c.claimId}: verified source is not link-checked`);
        if (c.claimType === 'manufacturer_description' && src?.publisherRole !== 'manufacturer')
            p.push(`claim ${c.claimId}: manufacturer text verified from a non-manufacturer page`);
    }
    for (const c of bundle.claims)
        if (c.verificationStatus === 'verified')
            p.push(`bundle claim ${c.claimId}: legacy data must not be verified`);
    for (const ps of pack.passports) {
        for (const bd of ps.badges) {
            if (!bd.claimIds.length)
                p.push(`${ps.flavorId}: badge ${bd.code} without claims`);
            if (!bd.refs.length)
                p.push(`${ps.flavorId}: badge ${bd.code} without URL/record`);
            for (const r of bd.refs)
                if (!POINTER.test(r))
                    p.push(`${ps.flavorId}: badge ${bd.code} has a non-traceable ref ${r}`);
            for (const id of bd.claimIds) {
                const c = all.get(id);
                if (!c) {
                    p.push(`${ps.flavorId}: badge ${bd.code} → unknown claim ${id}`);
                    continue;
                }
                if (superseded.has(id))
                    p.push(`${ps.flavorId}: badge ${bd.code} → superseded claim ${id}`);
                if (!c.sourceRef || !bd.refs.includes(c.sourceRef))
                    p.push(`${ps.flavorId}: badge ${bd.code} → claim ${id} ref not listed`);
                if (c.usage === 'excluded' && bd.code !== 'manufacturer_text_rejected')
                    p.push(`${ps.flavorId}: badge ${bd.code} shows excluded claim ${id}`);
            }
        }
        if (ps.auditStatus === 'verified') {
            const ok = ps.manufacturerTexts.some((t) => t.status === 'verified' && all.get(t.claimId)?.sourceType === 'MANUFACTURER_DESCRIPTION');
            if (!ok)
                p.push(`${ps.flavorId}: verified without a verified manufacturer text`);
        }
        if (ps.auditStatus === 'disputed' && !ps.identity.some((i) => i.disputing && !i.resolvedBy && i.status !== 'rejected' && DISPUTING_ISSUE_CODES.has(i.code)))
            p.push(`${ps.flavorId}: disputed without an open identity issue`);
        for (const bd of ps.badges)
            for (const r of bd.refs) {
                const m = /^decision:(.+)$/.exec(r);
                if (m && !ps.identity.some((i) => i.resolvedBy?.decisionId === m[1]))
                    p.push(`${ps.flavorId}: badge ${bd.code} cites decision ${m[1]} that answers none of its identity claims`);
            }
        for (const t of [AUDIT_DETAIL_AR[ps.auditDetail], ...ps.badges.map((x) => x.labelAr)]) {
            if (findForbiddenClaims(t).length)
                p.push(`${ps.flavorId}: forbidden wording in "${t}"`);
        }
    }
    for (const q of pack.reviewQueue)
        for (const t of [q.questionAr])
            if (findForbiddenClaims(t).length)
                p.push(`review queue ${q.claimId}: forbidden wording`);
    return p;
}
