import { GROUP_LABEL_AR } from "./descriptors.js";
import { DISPUTING_ISSUE_CODES, brandSlug } from "./researchBatch.js";
export const AUDIT_DETAIL_AR = {
    manufacturer_text_verified: 'نص المصنّع موثّق بمراجعتك',
    identity_disputed: 'هوية المنتج متنازع عليها — تحتاج قرارك',
    manufacturer_text_pending_owner_review: 'نص المصنّع موجود — بانتظار مراجعتك',
    manufacturer_name_differs: 'نص المصنّع موجود لكن الاسم مختلف — تأكيد مطلوب',
    manufacturer_text_rejected_by_owner: 'رفضتَ نص المصنّع المقترح',
    secondary_text_only: 'وصف من مصدر ثانوي فقط (غير موثّق)',
    listing_only: 'مُدرج في مصدر ثانوي بلا وصف',
    maker_page_unreachable: 'صفحة المصنّع تعذّر فتحها',
    no_source_found: 'لم يُعثر على مصدر',
    not_researched_yet: 'لم يُبحث بعد',
};
export const BADGE_LABEL_AR = {
    manufacturer_text_verified: 'نص المصنّع ✓',
    manufacturer_text_pending: 'نص المصنّع — بانتظار مراجعتك',
    manufacturer_name_differs: 'نص المصنّع — الاسم مختلف',
    manufacturer_text_rejected: 'نص مرفوض',
    secondary_text: 'وصف من مصدر ثانوي',
    listing_seen: 'مُدرج لدى مصدر ثانوي',
    identity_disputed: 'هوية متنازع عليها',
    identity_resolved_by_owner: 'حسمتَ الهوية',
    identity_note: 'ملاحظة هوية',
    no_source_found: 'لا مصدر',
    maker_page_unreachable: 'صفحة المصنّع غير متاحة',
    descriptors_from_text: 'كلمات وصف من نص منشور',
    multi_note_text: 'النص يذكر أكثر من مكوّن',
    brand_tea_base: 'قاعدة شاي بلا تبغ (حسب الموزّع) — لا يعني بلا نيكوتين',
    brand_nicotine_statement: 'صفحة بيع تذكر أنه يحتوي نيكوتين',
    legacy_unverified: 'بيانات موروثة غير موثّقة',
};
export const PASSPORT_FIELDS = ['official_source_url', 'product_line', 'preblend_status', 'measured_intensity', 'sourced_sensory_descriptors'];
export function buildCtx(allClaims, sources) {
    const byId = new Map(allClaims.map((c) => [c.claimId, c]));
    const next = new Map();
    for (const c of allClaims)
        if (c.supersedesClaimId)
            next.set(c.supersedesClaimId, c.claimId);
    const head = new Map();
    for (const c of allClaims) {
        let id = c.claimId;
        const seen = new Set();
        while (next.has(id) && !seen.has(id)) {
            seen.add(id);
            id = next.get(id);
        }
        head.set(c.claimId, id);
    }
    const current = allClaims.filter((c) => !next.has(c.claimId));
    return { current, head, byId, sources };
}
function txt(c, sources) {
    const v = (c.claimValue ?? {});
    const s = sources.find((x) => x.url === c.sourceRef);
    return {
        claimId: c.claimId, text: String(v['text'] ?? ''), lang: v['lang'] ?? null, url: c.sourceRef ?? '',
        publisher: s?.publisher ?? null, publisherRole: s?.publisherRole ?? null, status: c.verificationStatus,
        observedName: v['observedName'] ?? null, observedNameRu: v['observedNameRu'] ?? null, observedLine: v['observedLine'] ?? null,
    };
}
function badge(code, claims, extraRefs = []) {
    const refs = [...new Set([...claims.map((c) => c.sourceRef ?? ''), ...extraRefs].filter(Boolean))];
    return { code, labelAr: BADGE_LABEL_AR[code], claimIds: claims.map((c) => c.claimId), refs };
}
export function buildPassport(f, ctx, legacyClaims, usage, researchedIds, identityDecisions = new Map()) {
    const mine = ctx.current.filter((c) => c.entityType === 'flavor' && c.entityId === f.id);
    const slug = brandSlug(f.brand);
    const brandClaims = ctx.current.filter((c) => c.entityType === 'brand' && c.entityId === slug);
    const maker = mine.filter((c) => c.claimType === 'manufacturer_description');
    const secondary = mine.filter((c) => /_(description|editorial)$/.test(c.claimType) && c.claimType !== 'manufacturer_description');
    const listings = mine.filter((c) => c.claimType === 'product_listing');
    const identity = mine.filter((c) => c.claimType === 'identity_issue');
    const outcomes = mine.filter((c) => c.claimType === 'research_outcome');
    const descClaims = mine.filter((c) => c.claimType === 'derived_descriptors');
    const multi = mine.filter((c) => c.claimType === 'derived_multi_note_signal');
    const live = (c) => c.verificationStatus !== 'rejected';
    // An identity issue answered by the owner (OwnerDecision product_identity) is resolved, not disputed.
    const answerFor = (c) => identityDecisions.get(c.claimId) ?? (c.supersedesClaimId ? identityDecisions.get(c.supersedesClaimId) : undefined);
    const resolved = identity.filter((c) => live(c) && answerFor(c));
    const disputes = identity.filter((c) => live(c) && !answerFor(c) && DISPUTING_ISSUE_CODES.has(String(c.claimValue.code)));
    const notes = identity.filter((c) => live(c) && !answerFor(c) && !DISPUTING_ISSUE_CODES.has(String(c.claimValue.code)));
    const myAnswers = identity.map(answerFor).filter((d) => !!d && d.scope.flavorIds[0] === f.id);
    const ownerAnswer = myAnswers.sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1))[0] ?? null;
    const makerVerified = maker.filter((c) => c.verificationStatus === 'verified');
    const makerPending = maker.filter((c) => c.verificationStatus === 'plausible');
    const makerDiffers = maker.filter((c) => c.verificationStatus === 'unverified');
    const makerRejected = maker.filter((c) => c.verificationStatus === 'rejected');
    const secondaryLive = secondary.filter(live);
    const unreachable = outcomes.filter((c) => c.claimValue.outcome === 'manufacturer_page_unreachable');
    const notFound = outcomes.filter((c) => c.claimValue.outcome === 'not_found');
    const researched = researchedIds.has(f.id);
    let auditDetail;
    if (disputes.length)
        auditDetail = 'identity_disputed';
    else if (makerVerified.length)
        auditDetail = 'manufacturer_text_verified';
    else if (makerPending.length)
        auditDetail = 'manufacturer_text_pending_owner_review';
    else if (makerDiffers.length)
        auditDetail = 'manufacturer_name_differs';
    else if (makerRejected.length && !secondaryLive.length)
        auditDetail = 'manufacturer_text_rejected_by_owner';
    else if (secondaryLive.length)
        auditDetail = 'secondary_text_only';
    else if (unreachable.length)
        auditDetail = 'maker_page_unreachable';
    else if (listings.length)
        auditDetail = 'listing_only';
    else if (researched)
        auditDetail = 'no_source_found';
    else
        auditDetail = 'not_researched_yet';
    const auditStatus = auditDetail === 'identity_disputed' ? 'disputed' : auditDetail === 'manufacturer_text_verified' ? 'verified' : 'unverified';
    // Descriptors: resolve the status of the text each set was read from (follow revisions).
    const statusOfBase = (baseId) => {
        const h = ctx.head.get(baseId);
        return h ? ctx.byId.get(h)?.verificationStatus ?? 'unknown' : 'unknown';
    };
    const descriptors = [];
    const usedDescClaims = [];
    for (const c of descClaims) {
        const v = c.claimValue;
        const st = statusOfBase(v.basedOnClaimId);
        if (st === 'rejected')
            continue; // text rejected by the owner → its words are not shown
        usedDescClaims.push(c);
        for (const d of v.descriptors) {
            if (d.group === 'mix_marker' || d.group === 'style')
                continue;
            if (!descriptors.some((x) => x.id === d.id))
                descriptors.push({ id: d.id, group: d.group, groupAr: GROUP_LABEL_AR[d.group], claimId: c.claimId, basedOnClaimId: v.basedOnClaimId, basedOnStatus: st });
        }
    }
    const multiLive = multi.filter((c) => statusOfBase(c.claimValue.basedOnClaimId) !== 'rejected');
    const teaBase = brandClaims.filter((c) => c.property === 'base_material' && live(c) && c.claimValue.value === 'tea_leaf_tobacco_free');
    const nicotine = brandClaims.filter((c) => c.property === 'nicotine_statement' && live(c));
    const legacyLive = legacyClaims.filter((c) => c.usage !== 'excluded');
    const fieldStatus = {
        official_source_url: makerVerified.length ? 'verified' : makerPending.length || makerDiffers.length ? 'pending_owner_review' : 'missing',
        product_line: makerVerified.some((c) => c.claimValue.observedLine)
            ? 'verified'
            : [...maker, ...secondaryLive, ...listings].some((c) => c.claimValue.observedLine) ? 'secondary_unverified' : 'missing',
        preblend_status: multiLive.length ? 'text_signal_unverified' : 'missing',
        measured_intensity: 'missing',
        sourced_sensory_descriptors: descriptors.some((d) => d.basedOnStatus === 'verified')
            ? 'from_verified_maker_text'
            : descriptors.some((d) => d.basedOnStatus === 'plausible' || (ctx.byId.get(ctx.head.get(d.basedOnClaimId) ?? '')?.claimType === 'manufacturer_description'))
                ? 'from_maker_text_pending'
                : descriptors.length ? 'from_secondary_text' : 'missing',
    };
    const badges = [];
    if (makerVerified.length)
        badges.push(badge('manufacturer_text_verified', makerVerified));
    if (makerPending.length)
        badges.push(badge('manufacturer_text_pending', makerPending));
    if (makerDiffers.length)
        badges.push(badge('manufacturer_name_differs', makerDiffers));
    if (makerRejected.length)
        badges.push(badge('manufacturer_text_rejected', makerRejected));
    if (secondaryLive.length)
        badges.push(badge('secondary_text', secondaryLive));
    if (listings.length && !secondaryLive.length && !maker.length)
        badges.push(badge('listing_seen', listings));
    if (disputes.length)
        badges.push(badge('identity_disputed', disputes));
    if (resolved.length)
        badges.push(badge('identity_resolved_by_owner', resolved, resolved.map((c) => `decision:${answerFor(c).decisionId}`)));
    if (notes.length)
        badges.push(badge('identity_note', notes));
    if (notFound.length)
        badges.push(badge('no_source_found', notFound));
    if (unreachable.length)
        badges.push(badge('maker_page_unreachable', unreachable));
    if (usedDescClaims.length) {
        const bases = usedDescClaims.map((c) => ctx.byId.get(ctx.head.get(c.claimValue.basedOnClaimId) ?? '')).filter((x) => !!x);
        badges.push(badge('descriptors_from_text', usedDescClaims, bases.map((b) => b.sourceRef ?? '')));
    }
    if (multiLive.some((c) => c.claimValue.signal === 'description_names_several_components')) {
        const sev = multiLive.filter((c) => c.claimValue.signal === 'description_names_several_components');
        const bases = sev.map((c) => ctx.byId.get(ctx.head.get(c.claimValue.basedOnClaimId) ?? '')).filter((x) => !!x);
        badges.push(badge('multi_note_text', sev, bases.map((b) => b.sourceRef ?? '')));
    }
    if (teaBase.length)
        badges.push(badge('brand_tea_base', teaBase));
    if (nicotine.length)
        badges.push(badge('brand_nicotine_statement', nicotine));
    if (legacyLive.length)
        badges.push(badge('legacy_unverified', legacyLive));
    const legacyConf = f.legacy?.['officialConf'];
    return {
        flavorId: f.id, brand: f.brand, brandSlug: slug, name: f.name, lifecycle: f.lifecycle,
        usage: usage ? { rank: usage.rank, sessions: usage.sessions, sessionsCertain: usage.sessionsCertain } : null,
        researched, auditStatus, auditDetail,
        manufacturerTexts: maker.map((c) => txt(c, ctx.sources)),
        secondaryTexts: secondaryLive.map((c) => txt(c, ctx.sources)),
        listings: listings.map((c) => {
            const v = c.claimValue;
            const s = ctx.sources.find((x) => x.url === c.sourceRef);
            return { claimId: c.claimId, url: c.sourceRef ?? '', observedName: v['observedName'] ?? null, observedNameRu: v['observedNameRu'] ?? null, kind: String(v['excerptKind']), sourceAudit: s?.auditStatus ?? null };
        }),
        descriptors,
        multiNote: multiLive.map((c) => ({ claimId: c.claimId, signal: c.claimValue.signal })),
        identity: identity.map((c) => {
            const v = c.claimValue;
            const d = answerFor(c);
            return { claimId: c.claimId, code: v.code, detail: v.detail, disputing: !d && DISPUTING_ISSUE_CODES.has(v.code), status: c.verificationStatus, resolvedBy: d ? { decisionId: d.decisionId, value: d.value } : null };
        }),
        ownerIdentity: ownerAnswer ? { decisionId: ownerAnswer.decisionId, value: ownerAnswer.value, observedName: ownerAnswer.details?.observedName ?? null, sameAsFlavorId: ownerAnswer.details?.sameAsFlavorId ?? null } : null,
        confirmedNames: [
            ...makerVerified.map((c) => ({ name: String(c.claimValue.observedName ?? ''), basis: c.claimId })),
            ...(ownerAnswer?.value === 'same_as_observed_name' && ownerAnswer.details?.observedName ? [{ name: ownerAnswer.details.observedName, basis: `decision:${ownerAnswer.decisionId}` }] : []),
        ].filter((x) => x.name),
        brandFacts: brandClaims.map((c) => ({ claimId: c.claimId, property: c.property, value: c.claimValue, url: c.sourceRef, status: c.verificationStatus })),
        legacy: { officialConf: typeof legacyConf === 'string' ? legacyConf : null, claimCount: legacyClaims.length, excludedCount: legacyClaims.length - legacyLive.length },
        fieldStatus,
        missingData: PASSPORT_FIELDS.filter((k) => fieldStatus[k] === 'missing'),
        badges,
    };
}
