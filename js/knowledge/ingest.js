import { SCHEMA_VERSION } from "../domain/types.js";
import { makeClaim } from "../domain/claims.js";
import { DESCRIPTOR_LEXICON_VERSION, extractDescriptors, multiNoteSignal } from "./descriptors.js";
import { brandSlug, globalSourceId } from "./researchBatch.js";
export const INGEST_VERSION = 'research-ingest@1';
const SOURCE_LIMITS = ['how the product tastes in a mix', 'any mixing ratio or proportion', 'any heat, coal or smoking-safety statement'];
function sourceKind(s) {
    return s.publisherRole === 'manufacturer' ? 'MANUFACTURER_DESCRIPTION' : 'UNKNOWN';
}
function auditStatus(s) {
    if (s.fetchStatus === 'fetched' || s.fetchStatus === 'fetched_no_product_content')
        return 'link_checked';
    if (s.fetchStatus === 'unreachable')
        return 'unreachable';
    return 'unchecked';
}
const SUPPORTS = {
    manufacturer: "the maker's own product names and short product texts as shown on this page",
    official_distributor: "the distributor's own statements about the brand (e.g. base material)",
    retailer: 'that a shop lists the product under this name and brand',
    review_site: 'that a third-party review site lists the product under this brand/line, with its own short text',
    research: 'the general method described',
    health_authority: 'the general health statement described',
};
export function toSourceRecord(batch, s) {
    const notes = [...s.notes];
    if (s.fetchStatus === 'fetched' || s.fetchStatus === 'fetched_no_product_content') {
        notes.push(`Captured ${s.accessedAt} by ${batch.collector.kind}:${batch.collector.id} via a summarising fetch tool; quotes were not compared with the raw HTML and the page was not archived.`);
    }
    if (s.fetchStatus === 'fetched_no_product_content')
        notes.push('Page opened but showed no product text to the fetch tool (e.g. rendered by JavaScript).');
    if (s.fetchStatus === 'search_result_only')
        notes.push('Seen only as a search-result title; the page itself was not opened.');
    if (s.fetchStatus === 'unreachable')
        notes.push('The page could not be opened on the access date.');
    const doesNotSupport = [...SOURCE_LIMITS];
    if (s.publisherRole !== 'manufacturer')
        doesNotSupport.unshift("the manufacturer's official description");
    return {
        schemaVersion: SCHEMA_VERSION,
        sourceId: globalSourceId(batch.batchId, s.sourceId),
        kind: sourceKind(s),
        url: s.url,
        publisher: s.publisher,
        publisherRole: s.publisherRole,
        title: s.title,
        year: null,
        retrievedAt: s.accessedAt,
        supports: s.fetchStatus === 'fetched' || s.fetchStatus === 'fetched_no_product_content' ? [SUPPORTS[s.publisherRole]] : [],
        doesNotSupport,
        auditStatus: auditStatus(s),
        notes,
    };
}
/** Lower-case Latin letters and digits only. */
export function normalizeName(s) {
    // Some brands print a Cyrillic «Ё» inside Latin names (e.g. «ЁLKA»); it reads as E.
    return s.replace(/[Ёё]/g, 'e').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
/** Names the library already uses for a product: name, name without brand, aliases, legacy officialAlias. */
export function libraryNames(f) {
    const names = [f.name, ...f.aliases];
    const brandNorm = normalizeName(f.brand);
    const nameNorm = normalizeName(f.name);
    if (brandNorm && nameNorm.startsWith(brandNorm) && nameNorm.length > brandNorm.length)
        names.push(f.name.slice(f.brand.length));
    const alias = f.legacy?.['officialAlias'];
    if (typeof alias === 'string' && alias.trim())
        names.push(alias);
    return [...new Set(names.map(normalizeName).filter(Boolean))];
}
export function nameMatch(f, finding) {
    if (!finding.observedName || !normalizeName(finding.observedName))
        return 'no_latin_name_observed';
    return libraryNames(f).includes(normalizeName(finding.observedName)) ? 'matches_library_name' : 'differs_from_library_name';
}
const PROCESS = (batch) => `process:${INGEST_VERSION} (collector ${batch.collector.kind}:${batch.collector.id})`;
export function ingestResearchBatch(batch, flavors) {
    const byId = new Map(flavors.map((f) => [f.id, f]));
    const srcById = new Map(batch.sources.map((s) => [s.sourceId, s]));
    const sources = batch.sources.map((s) => toSourceRecord(batch, s));
    const claims = [];
    const unknownProducts = [];
    const reviewer = PROCESS(batch);
    const record = (path) => `research:${batch.batchId}/${path}`;
    for (const p of batch.products) {
        const f = byId.get(p.flavorId);
        if (!f) {
            unknownProducts.push(p.flavorId);
            continue;
        }
        for (const fd of p.findings) {
            const s = srcById.get(fd.sourceId);
            const base = {
                entityType: 'flavor', entityId: f.id, sourceRef: s.url, retrievedAt: s.accessedAt, reviewerOrProcess: reviewer,
            };
            const observed = { observedName: fd.observedName, observedNameRu: fd.observedNameRu, observedBrand: fd.observedBrand, observedLine: fd.observedLine };
            if (fd.excerptKind === 'product_description' || fd.excerptKind === 'editorial_note') {
                const isMaker = s.publisherRole === 'manufacturer';
                const match = nameMatch(f, fd);
                const validityNotes = [`Excerpt via ${batch.captureMethod.split('.')[0]}; not compared with raw HTML.`];
                if (match === 'differs_from_library_name')
                    validityNotes.push(`Observed name «${fd.observedName}» differs from the library name «${f.name}» — same product not confirmed.`);
                if (match === 'no_latin_name_observed')
                    validityNotes.push('No Latin product name on the page; identity rests on brand + Russian name.');
                const claimType = fd.excerptKind === 'editorial_note' ? `${s.publisherRole}_editorial` : isMaker ? 'manufacturer_description' : `${s.publisherRole}_description`;
                const desc = makeClaim({
                    ...base, claimType, property: 'description',
                    claimValue: { text: fd.excerpt, lang: fd.excerptLang, ...observed },
                    sourceType: isMaker ? 'MANUFACTURER_DESCRIPTION' : 'UNKNOWN',
                    methodOrExcerpt: fd.excerpt,
                    validityNotes,
                    verificationStatus: isMaker && match === 'matches_library_name' ? 'plausible' : 'unverified',
                    usage: 'descriptive_only',
                });
                claims.push(desc);
                if (fd.excerptKind === 'product_description') {
                    const hits = extractDescriptors(fd.excerpt);
                    if (hits.length) {
                        claims.push(makeClaim({
                            claimType: 'derived_descriptors', entityType: 'flavor', entityId: f.id, property: 'sensory_descriptors',
                            claimValue: { lexicon: DESCRIPTOR_LEXICON_VERSION, basedOnClaimId: desc.claimId, descriptors: hits.map((h) => ({ id: h.id, group: h.group, matchedToken: h.matchedToken })) },
                            sourceType: 'MODEL_INFERENCE', sourceRef: `derived:${desc.claimId}`, retrievedAt: s.accessedAt,
                            methodOrExcerpt: `Lexicon ${DESCRIPTOR_LEXICON_VERSION}: terms found verbatim in the excerpt of ${desc.claimId}.`,
                            validityNotes: ['Words in a product text — not a taste measurement.'],
                            reviewerOrProcess: `process:${DESCRIPTOR_LEXICON_VERSION}`, usage: 'descriptive_only',
                        }));
                        const signal = multiNoteSignal(hits);
                        claims.push(makeClaim({
                            claimType: 'derived_multi_note_signal', entityType: 'flavor', entityId: f.id, property: 'preblend_hint',
                            claimValue: { signal, basedOnClaimId: desc.claimId },
                            sourceType: 'MODEL_INFERENCE', sourceRef: `derived:${desc.claimId}`, retrievedAt: s.accessedAt,
                            methodOrExcerpt: `Lexicon ${DESCRIPTOR_LEXICON_VERSION}: count of distinct flavor components named in the excerpt.`,
                            validityNotes: ['A reading of the product text only; whether the product is a pre-blend is not confirmed.'],
                            reviewerOrProcess: `process:${DESCRIPTOR_LEXICON_VERSION}`, usage: 'descriptive_only',
                        }));
                    }
                }
            }
            else {
                claims.push(makeClaim({
                    ...base, claimType: 'product_listing', property: `listing:${fd.sourceId}`,
                    claimValue: { excerptKind: fd.excerptKind, ...observed },
                    sourceType: s.publisherRole === 'manufacturer' ? 'MANUFACTURER_DESCRIPTION' : 'UNKNOWN',
                    methodOrExcerpt: null,
                    validityNotes: s.fetchStatus === 'search_result_only' ? ['Seen only as a search-result title; page not opened.'] : s.fetchStatus === 'unreachable' ? ['Name taken from the page address; page could not be opened.'] : [],
                    verificationStatus: 'unverified', usage: 'descriptive_only',
                }));
            }
        }
        p.identityIssues.forEach((iss, i) => {
            claims.push(makeClaim({
                claimType: 'identity_issue', entityType: 'flavor', entityId: f.id, property: `identity:${iss.code}`,
                claimValue: { code: iss.code, detail: iss.detail, relatedFlavorIds: iss.relatedFlavorIds ?? [] },
                sourceType: 'MODEL_INFERENCE', sourceRef: record(`products[${p.flavorId}].identityIssues[${i}]`), retrievedAt: batch.collectedAt,
                methodOrExcerpt: 'Collector comparison of library data with the sources in this batch.',
                reviewerOrProcess: reviewer, usage: 'warning_only',
            }));
        });
        if (p.outcome === 'not_found' || p.outcome === 'manufacturer_page_unreachable') {
            claims.push(makeClaim({
                claimType: 'research_outcome', entityType: 'flavor', entityId: f.id, property: 'research_outcome',
                claimValue: { outcome: p.outcome, batchId: batch.batchId },
                sourceType: 'MODEL_INFERENCE', sourceRef: record(`products[${p.flavorId}]`), retrievedAt: batch.collectedAt,
                methodOrExcerpt: batch.captureMethod,
                validityNotes: [p.outcome === 'not_found' ? 'Absence of a found source is not evidence that the product does not exist.' : 'The maker page exists but could not be opened.'],
                reviewerOrProcess: reviewer, usage: 'descriptive_only',
            }));
        }
    }
    for (const bf of batch.brandFindings) {
        const slug = brandSlug(bf.catalogBrand);
        if (bf.manufacturer) {
            const makerSrc = bf.manufacturerSourceIds.map((id) => srcById.get(id)).find((s) => s.publisherRole === 'manufacturer' && s.fetchStatus === 'fetched');
            const anySrc = makerSrc ?? srcById.get(bf.manufacturerSourceIds[0]);
            if (anySrc) {
                claims.push(makeClaim({
                    claimType: makerSrc ? 'manufacturer_self_identification' : 'secondary_brand_attribution', entityType: 'brand', entityId: slug, property: 'manufacturer',
                    claimValue: bf.manufacturer, sourceType: makerSrc ? 'MANUFACTURER_DESCRIPTION' : 'UNKNOWN', sourceRef: anySrc.url, retrievedAt: anySrc.accessedAt,
                    methodOrExcerpt: anySrc.statedFacts.map((x) => x.text).join(' | ') || null,
                    validityNotes: makerSrc ? [] : anySrc.publisherRole === 'manufacturer' ? ['The maker page could not be read; attribution not confirmed by the maker.'] : [`Attributed by a ${anySrc.publisherRole.replace('_', ' ')}, not by the maker.`],
                    verificationStatus: makerSrc ? 'plausible' : 'unverified', reviewerOrProcess: reviewer, usage: 'descriptive_only',
                }));
            }
        }
        for (const fact of bf.brandLevelFacts ?? []) {
            const s = srcById.get(fact.sourceId);
            claims.push(makeClaim({
                claimType: `${s.publisherRole}_brand_fact`, entityType: 'brand', entityId: slug, property: fact.property,
                claimValue: { value: fact.value, excerpt: fact.excerpt }, sourceType: s.publisherRole === 'manufacturer' ? 'MANUFACTURER_DESCRIPTION' : 'UNKNOWN',
                sourceRef: s.url, retrievedAt: s.accessedAt, methodOrExcerpt: fact.excerpt,
                verificationStatus: 'unverified', reviewerOrProcess: reviewer, usage: 'descriptive_only',
            }));
        }
    }
    const ids = new Set();
    for (const c of claims) {
        if (ids.has(c.claimId))
            throw new Error(`ingest: duplicate claim id ${c.claimId} (${c.claimType} ${c.entityId})`);
        ids.add(c.claimId);
    }
    return { sources, claims, unknownProducts };
}
