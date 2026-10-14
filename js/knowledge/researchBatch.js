/**
 * Research batches (P1 "SKU-by-SKU audit").
 *
 * A batch records what a collector found on the web for specific library products:
 * the pages opened, who published them, and short excerpts. A batch is EVIDENCE TO
 * REVIEW, not a verdict:
 *  - a language-model collector may only collect (role `collector_only_not_verifier`);
 *  - an excerpt can only come from a page that was actually fetched — never from a
 *    search-result snippet or an unreachable page;
 *  - batches are stored privately; the app never fetches anything at runtime.
 */
import { PUBLISHER_ROLES } from "../domain/types.js";
import { findMarkupStrings, safeJsonParse, UnsafeInputError } from "../domain/sanitize.js";
export const RESEARCH_BATCH_SCHEMA = 'mizaj-research-batch@1';
export const FETCH_STATUSES = ['fetched', 'fetched_no_product_content', 'unreachable', 'search_result_only'];
export const EXCERPT_KINDS = ['product_description', 'editorial_note', 'page_title', 'search_result_title', 'listing_without_description'];
export const PRODUCT_OUTCOMES = ['manufacturer_source', 'secondary_source', 'identity_conflict', 'not_found', 'manufacturer_page_unreachable'];
/** Identity issues that put the product's identity in dispute (vs. a plain note). */
export const DISPUTING_ISSUE_CODES = new Set([
    'legacy_note_conflicts_with_sources',
    'possible_duplicate_product',
    'brand_not_confirmed',
]);
export const NOTE_ISSUE_CODES = new Set(['name_collision_other_brand', 'legacy_alias_not_confirmed', 'renamed_in_sources']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SRC_ID = /^R-\d{3}$/;
const BATCH_ID = /^RB-\d{4}-\d{2}-\d{2}-\d{2}$/;
function fail(msg) {
    throw new UnsafeInputError('bad_research_batch', msg);
}
function isEnum(list, v) {
    return typeof v === 'string' && list.includes(v);
}
/** Parse and validate a batch. Throws `UnsafeInputError` on the first violation. */
export function parseResearchBatch(text) {
    const b = safeJsonParse(text);
    if (b?.schema !== RESEARCH_BATCH_SCHEMA)
        fail(`expected schema ${RESEARCH_BATCH_SCHEMA}`);
    if (!BATCH_ID.test(String(b.batchId)))
        fail('batchId must look like RB-YYYY-MM-DD-NN');
    if (!DATE.test(String(b.collectedAt)))
        fail('collectedAt must be YYYY-MM-DD');
    if (!b.collector || !['human', 'process', 'language_model'].includes(b.collector.kind))
        fail('collector.kind invalid');
    if (b.collector.kind === 'language_model' && b.collector.role !== 'collector_only_not_verifier') {
        fail('a language-model collector must declare role collector_only_not_verifier');
    }
    const markup = findMarkupStrings(b);
    if (markup.length)
        fail(`markup found in batch text: ${markup.slice(0, 3).join(', ')}`);
    if (!Array.isArray(b.sources) || !Array.isArray(b.products) || !Array.isArray(b.brandFindings))
        fail('sources/products/brandFindings must be arrays');
    const sources = new Map();
    for (const s of b.sources) {
        if (!SRC_ID.test(String(s?.sourceId)))
            fail(`bad sourceId ${String(s?.sourceId)}`);
        if (sources.has(s.sourceId))
            fail(`duplicate sourceId ${s.sourceId}`);
        if (!/^https:\/\/[^\s]+$/.test(String(s.url)))
            fail(`${s.sourceId}: url must be https`);
        if (!isEnum(PUBLISHER_ROLES, s.publisherRole))
            fail(`${s.sourceId}: publisherRole invalid`);
        if (!isEnum(FETCH_STATUSES, s.fetchStatus))
            fail(`${s.sourceId}: fetchStatus invalid`);
        if (!DATE.test(String(s.accessedAt)))
            fail(`${s.sourceId}: accessedAt must be YYYY-MM-DD`);
        if (!Array.isArray(s.statedFacts) || !Array.isArray(s.notes))
            fail(`${s.sourceId}: statedFacts/notes must be arrays`);
        if (s.statedFacts.length && s.fetchStatus !== 'fetched' && s.fetchStatus !== 'fetched_no_product_content') {
            fail(`${s.sourceId}: stated facts require a fetched page`);
        }
        sources.set(s.sourceId, s);
    }
    const flavorIds = new Set();
    for (const p of b.products) {
        if (typeof p?.flavorId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(p.flavorId))
            fail(`bad flavorId ${String(p?.flavorId)}`);
        if (flavorIds.has(p.flavorId))
            fail(`duplicate product ${p.flavorId}`);
        flavorIds.add(p.flavorId);
        if (!isEnum(PRODUCT_OUTCOMES, p.outcome))
            fail(`${p.flavorId}: outcome invalid`);
        if (!Array.isArray(p.findings) || !Array.isArray(p.identityIssues))
            fail(`${p.flavorId}: findings/identityIssues must be arrays`);
        for (const f of p.findings) {
            const src = sources.get(f.sourceId);
            if (!src)
                fail(`${p.flavorId}: unknown source ${f.sourceId}`);
            if (!isEnum(EXCERPT_KINDS, f.excerptKind))
                fail(`${p.flavorId}/${f.sourceId}: excerptKind invalid`);
            const hasExcerpt = typeof f.excerpt === 'string' && f.excerpt.trim() !== '';
            if (hasExcerpt && src.fetchStatus !== 'fetched') {
                fail(`${p.flavorId}/${f.sourceId}: an excerpt requires a fetched page (source is ${src.fetchStatus})`);
            }
            if ((f.excerptKind === 'product_description' || f.excerptKind === 'editorial_note') && (!hasExcerpt || !f.excerptLang)) {
                fail(`${p.flavorId}/${f.sourceId}: ${f.excerptKind} needs an excerpt and its language`);
            }
            if ((f.excerptKind === 'search_result_title' || f.excerptKind === 'page_title' || f.excerptKind === 'listing_without_description') && hasExcerpt) {
                fail(`${p.flavorId}/${f.sourceId}: ${f.excerptKind} must not carry a description excerpt`);
            }
            if (f.excerptKind === 'search_result_title' && src.fetchStatus !== 'search_result_only') {
                fail(`${p.flavorId}/${f.sourceId}: search_result_title must come from a search_result_only source`);
            }
        }
        if (p.outcome === 'manufacturer_source') {
            const ok = p.findings.some((f) => {
                const s = sources.get(f.sourceId);
                return s.publisherRole === 'manufacturer' && s.fetchStatus === 'fetched' && f.excerptKind === 'product_description';
            });
            if (!ok)
                fail(`${p.flavorId}: outcome manufacturer_source needs a fetched manufacturer description`);
        }
        if (p.outcome === 'not_found' && p.findings.length)
            fail(`${p.flavorId}: not_found cannot have findings`);
        for (const i of p.identityIssues) {
            if (typeof i?.code !== 'string' || typeof i.detail !== 'string' || !i.detail.trim())
                fail(`${p.flavorId}: identity issue needs code and detail`);
            if (!DISPUTING_ISSUE_CODES.has(i.code) && !NOTE_ISSUE_CODES.has(i.code))
                fail(`${p.flavorId}: unknown identity issue code ${i.code}`);
        }
    }
    for (const bf of b.brandFindings) {
        if (typeof bf?.catalogBrand !== 'string' || !bf.catalogBrand)
            fail('brand finding without catalogBrand');
        for (const id of bf.manufacturerSourceIds ?? [])
            if (!sources.has(id))
                fail(`${bf.catalogBrand}: unknown source ${id}`);
        for (const fact of bf.brandLevelFacts ?? []) {
            const s = sources.get(fact.sourceId);
            if (!s)
                fail(`${bf.catalogBrand}: unknown source ${fact.sourceId}`);
            if (s.fetchStatus !== 'fetched')
                fail(`${bf.catalogBrand}: brand fact must come from a fetched page`);
        }
    }
    return b;
}
/** Stable, namespaced id for a batch-local source id (R-005 → RB-2026-10-12-01#R-005). */
export function globalSourceId(batchId, sourceId) {
    return `${batchId}#${sourceId}`;
}
export function brandSlug(brand) {
    return brand.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}
