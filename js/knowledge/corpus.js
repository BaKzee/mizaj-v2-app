import { SCHEMA_VERSION, PUBLISHER_ROLES } from "../domain/types.js";
import { makeClaim } from "../domain/claims.js";
import { contentId } from "../domain/hash.js";
import { TOTAL_BP } from "../domain/basisPoints.js";
import { findMarkupStrings, safeJsonParse, UnsafeInputError } from "../domain/sanitize.js";
import { normalizeName, libraryNames } from "./ingest.js";
export const CORPUS_SCHEMA = 'mizaj-recipe-corpus@1';
export const CORPUS_RULES_VERSION = 'corpus-rules@2';
/**
 * Promotion / shop wording (ru, en, ar, he). `word*` = word prefix, otherwise a whole
 * word or phrase; symbols are matched literally. Deliberately narrow (e.g. "руб" is a
 * whole word so "рубиновый" does not trigger).
 */
const AD_MARKERS = [
    'промокод*', 'скидк*', 'купить', 'купите', 'акция', 'акции', 'доставк*', 'в наличии', 'цена', 'руб', '₽',
    'promo*', 'discount*', 'coupon*', 'buy now', 'shop now', 'free shipping', 'sale', 'affiliate*', 'sponsored',
    'كود خصم', 'خصم', 'اشتر*', 'توصيل', 'السعر',
    'קופון', 'הנחה', 'משלוח',
];
export function adMarkers(text) {
    const t = ` ${text.toLowerCase().replace(/ё/g, 'е')} `;
    return AD_MARKERS.filter((m) => {
        if (!/\p{L}/u.test(m))
            return t.includes(m);
        const prefix = m.endsWith('*');
        const body = (prefix ? m.slice(0, -1) : m).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^\\p{L}])${body}${prefix ? '' : '(?![\\p{L}])'}`, 'u').test(t);
    });
}
/** Library-name check for a published product name (brand prefix allowed). */
function productNameMatches(f, brand, productName, extra = []) {
    const names = [...libraryNames(f), ...extra.map(normalizeName).filter(Boolean)];
    let n = normalizeName(productName);
    if (names.includes(n))
        return true;
    for (const b of [normalizeName(brand), normalizeName(f.brand)])
        if (b && n.startsWith(b) && names.includes(n.slice(b.length)))
            return true;
    return false;
}
export function parseCorpusFile(text) {
    const o = safeJsonParse(text);
    if (o?.schema !== CORPUS_SCHEMA || !Array.isArray(o.entries))
        throw new UnsafeInputError('bad_corpus', `expected ${CORPUS_SCHEMA}`);
    if (typeof o.corpusId !== 'string' || !o.corpusId)
        throw new UnsafeInputError('bad_corpus', 'corpusId missing');
    if (o.collector?.kind === 'language_model' && o.collector.role !== 'collector_only_not_verifier') {
        throw new UnsafeInputError('bad_corpus', 'a language-model collector must declare role collector_only_not_verifier');
    }
    const markup = findMarkupStrings(o);
    if (markup.length)
        throw new UnsafeInputError('bad_corpus', `markup in corpus: ${markup.slice(0, 3).join(', ')}`);
    const ids = new Set();
    for (const e of o.entries) {
        if (typeof e?.entryId !== 'string' || !e.entryId)
            throw new UnsafeInputError('bad_corpus', 'entry without id');
        if (ids.has(e.entryId))
            throw new UnsafeInputError('bad_corpus', `duplicate entry ${e.entryId}`);
        ids.add(e.entryId);
        if (!Array.isArray(e.ingredients))
            throw new UnsafeInputError('bad_corpus', `${e.entryId}: ingredients must be an array`);
        if (!['percent', 'grams', 'parts'].includes(e.proportionUnit))
            throw new UnsafeInputError('bad_corpus', `${e.entryId}: proportionUnit invalid`);
        if (![...PUBLISHER_ROLES, 'blog', 'social'].includes(e.publisherRole))
            throw new UnsafeInputError('bad_corpus', `${e.entryId}: publisherRole invalid`);
    }
    return o;
}
/** Largest-remainder apportionment of integer weights to 10 000 bp (ties → earlier index). */
function apportion(weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    const raw = weights.map((w) => (w * TOTAL_BP) / total);
    const floor = raw.map(Math.floor);
    let rest = TOTAL_BP - floor.reduce((a, b) => a + b, 0);
    const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
    for (const o of order) {
        if (rest <= 0)
            break;
        floor[o.i] += 1;
        rest--;
    }
    return floor;
}
function toBasisPoints(e) {
    const amounts = e.ingredients.map((i) => i.amount);
    if (e.proportionUnit === 'percent') {
        const hundredths = amounts.map((a) => Math.round(a * 100));
        if (hundredths.some((h, k) => Math.abs(h - amounts[k] * 100) > 1e-6))
            return { bp: [], exact: false, reasons: ['pct_not_exact_to_0_01'] };
        const sum = hundredths.reduce((a, b) => a + b, 0);
        if (sum !== TOTAL_BP)
            return { bp: [], exact: false, reasons: ['pct_sum_not_100'] };
        return { bp: hundredths, exact: true, reasons: [] };
    }
    // grams/parts → proportions are derived (rounded to 1 bp); marked not exact.
    const scaled = amounts.map((a) => Math.round(a * 1000));
    const bp = apportion(scaled);
    const exact = bp.every((v, k) => Math.abs(v - (scaled[k] * TOTAL_BP) / scaled.reduce((x, y) => x + y, 0)) < 1e-9);
    return { bp, exact, reasons: [] };
}
function fingerprintOf(ings) {
    return contentId('pf', [...ings].sort((a, b) => (a.flavorId < b.flavorId ? -1 : 1)).map((i) => [i.flavorId, i.basisPoints]));
}
const NEAR_DUPLICATE_BP = 100; // ±1 percentage point per product, same product set
/**
 * `confirmedNames`: extra names per library product that the OWNER confirmed (verified
 * maker text or identity answer), e.g. juicy-mango → "Ekzo Mango". Never inferred.
 */
export function ingestCorpus(files, flavors, confirmedNames = new Map()) {
    const byId = new Map(flavors.map((f) => [f.id, f]));
    const all = files.flatMap((f) => f.entries.map((e) => ({ file: f, e })));
    // Entry ids are the keys of decisions, claims and duplicate links: unique across ALL files.
    const seen = new Set();
    for (const { e } of all) {
        if (seen.has(e.entryId))
            throw new UnsafeInputError('bad_corpus', `entry id ${e.entryId} used in more than one corpus file`);
        seen.add(e.entryId);
    }
    // Deterministic order: earliest access first, then URL, then id — the earliest copy wins.
    all.sort((a, b) => (a.e.accessedAt < b.e.accessedAt ? -1 : a.e.accessedAt > b.e.accessedAt ? 1 : a.e.url < b.e.url ? -1 : a.e.url > b.e.url ? 1 : a.e.entryId < b.e.entryId ? -1 : a.e.entryId > b.e.entryId ? 1 : 0));
    const decisions = [];
    const sources = [];
    const claims = [];
    const accepted = [];
    for (const { file, e } of all) {
        const reasons = [];
        if (!/^https:\/\/\S+$/.test(e.url))
            reasons.push('not_https');
        if (e.fetchStatus !== 'fetched')
            reasons.push('page_not_fetched');
        if (e.ingredients.length < 2)
            reasons.push('too_few_ingredients');
        if (e.ingredients.some((i) => i.amount === null || typeof i.amount !== 'number' || !Number.isFinite(i.amount)))
            reasons.push('missing_amount');
        else if (e.ingredients.some((i) => i.amount <= 0))
            reasons.push('non_positive_amount');
        const ids = e.ingredients.map((i) => i.flavorId);
        if (ids.some((x) => x === null))
            reasons.push('unmapped_product');
        if (ids.some((x) => x !== null && !byId.has(x)))
            reasons.push('unknown_flavor_id');
        if (new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length)
            reasons.push('duplicate_ingredient');
        for (const i of e.ingredients) {
            const f = i.flavorId ? byId.get(i.flavorId) : undefined;
            if (!f)
                continue;
            if (normalizeName(f.brand) !== normalizeName(i.brand) && !normalizeName(i.brand).includes(normalizeName(f.brand)) && !normalizeName(f.brand).includes(normalizeName(i.brand)))
                reasons.push('brand_mismatch');
            if (!productNameMatches(f, i.brand, i.productName, confirmedNames.get(f.id)))
                reasons.push('name_mismatch');
        }
        const text = [e.title ?? '', e.context ?? '', ...e.notes, ...e.ingredients.map((i) => i.productName)].join(' \n ');
        if (adMarkers(text).length)
            reasons.push('advertising_markers');
        let ings = null;
        let exact = null;
        if (!reasons.length) {
            const conv = toBasisPoints(e);
            reasons.push(...conv.reasons);
            if (!conv.reasons.length) {
                ings = e.ingredients.map((i, k) => ({ flavorId: i.flavorId, basisPoints: conv.bp[k] }));
                exact = conv.exact;
            }
        }
        const uniqReasons = [...new Set(reasons)];
        if (uniqReasons.length || !ings) {
            let blockedOnlyBy = null;
            if (uniqReasons.length && uniqReasons.every((r) => r === 'unmapped_product') && toBasisPoints(e).reasons.length === 0) {
                blockedOnlyBy = {
                    missing: e.ingredients.filter((i) => i.flavorId === null).map((i) => ({ brand: i.brand, productName: i.productName })),
                    libraryFlavorIds: e.ingredients.filter((i) => i.flavorId !== null).map((i) => i.flavorId),
                };
            }
            decisions.push({ entryId: e.entryId, url: e.url, status: 'rejected', reasons: uniqReasons, duplicateOf: null, ingredients: null, proportionsExact: null, fingerprint: null, claimId: null, blockedOnlyBy });
            continue;
        }
        const fp = fingerprintOf(ings);
        const dup = accepted.find((a) => a.fp === fp)
            ?? accepted.find((a) => a.ings.length === ings.length && ings.every((i) => {
                const o = a.ings.find((x) => x.flavorId === i.flavorId);
                return o !== undefined && Math.abs(o.basisPoints - i.basisPoints) <= NEAR_DUPLICATE_BP;
            }));
        if (dup) {
            decisions.push({ entryId: e.entryId, url: e.url, status: 'duplicate', reasons: [], duplicateOf: dup.entryId, ingredients: ings, proportionsExact: exact, fingerprint: fp, claimId: null, blockedOnlyBy: null });
            continue;
        }
        const src = {
            schemaVersion: SCHEMA_VERSION, sourceId: `${file.corpusId}#${e.entryId}`, kind: 'PUBLISHED_FORMULA', url: e.url,
            publisher: e.publisher, publisherRole: PUBLISHER_ROLES.includes(e.publisherRole) ? e.publisherRole : null,
            title: e.title, year: null, retrievedAt: e.accessedAt,
            supports: ['that this page publishes this mix with these products and amounts'],
            doesNotSupport: ['that the mix tastes good or as described', 'that the products are the same batch/version you own', 'any heat, coal or smoking-safety statement'],
            auditStatus: 'link_checked', notes: [...e.notes, `Collected by ${file.collector.kind}:${file.collector.id}; amounts transcribed, not machine-checked.`],
        };
        sources.push(src);
        const claim = makeClaim({
            claimType: 'published_formula', entityType: 'recipe', entityId: `corpus:${e.entryId}`, property: 'formula',
            claimValue: { proportionUnit: e.proportionUnit, published: e.ingredients.map((i) => ({ brand: i.brand, productName: i.productName, amount: i.amount })), ingredients: ings, proportionsExact: exact, fingerprint: fp },
            sourceType: 'PUBLISHED_FORMULA', sourceRef: e.url, retrievedAt: e.accessedAt,
            methodOrExcerpt: `${CORPUS_RULES_VERSION}; ${e.proportionUnit === 'percent' ? 'percentages converted exactly to basis points' : 'proportions derived from ' + e.proportionUnit + ' by largest remainder'}`,
            validityNotes: exact ? [] : ['Proportions were derived (rounded to 0.01%), not published as percentages.'],
            reviewerOrProcess: `process:${CORPUS_RULES_VERSION} (collector ${file.collector.kind}:${file.collector.id})`, usage: 'descriptive_only',
        });
        claims.push(claim);
        accepted.push({ entryId: e.entryId, ings, fp });
        decisions.push({ entryId: e.entryId, url: e.url, status: 'accepted', reasons: [], duplicateOf: null, ingredients: ings, proportionsExact: exact, fingerprint: fp, claimId: claim.claimId, blockedOnlyBy: null });
    }
    return { decisions, sources, claims };
}
/**
 * Suggestions are counts over published exact formulas — not taste advice. A product is
 * listed only when it appears in an otherwise-valid formula next to a library product.
 * Order: unlocks ↓, appearances ↓, then name (deterministic).
 */
export function productSuggestions(decisions) {
    const key = (b, n) => `${normalizeName(b) || b.trim().toLowerCase()}|${n.trim().toLowerCase().replace(/[ё]/g, 'е')}`;
    const m = new Map();
    for (const d of decisions) {
        const blk = d.blockedOnlyBy;
        if (!blk || !blk.libraryFlavorIds.length)
            continue;
        const seen = new Set();
        for (const x of blk.missing) {
            const k = key(x.brand, x.productName);
            if (seen.has(k))
                continue;
            seen.add(k);
            const s = m.get(k) ?? { brand: x.brand.trim(), productName: x.productName.trim(), unlocks: [], appearsIn: [], withLibraryProducts: [], urls: [] };
            s.appearsIn.push(d.entryId);
            if (new Set(blk.missing.map((y) => key(y.brand, y.productName))).size === 1)
                s.unlocks.push(d.entryId);
            for (const f of blk.libraryFlavorIds)
                if (!s.withLibraryProducts.includes(f))
                    s.withLibraryProducts.push(f);
            if (!s.urls.includes(d.url))
                s.urls.push(d.url);
            m.set(k, s);
        }
    }
    return [...m.values()].map((s) => ({ ...s, withLibraryProducts: [...s.withLibraryProducts].sort() }))
        .sort((a, b) => b.unlocks.length - a.unlocks.length || b.appearsIn.length - a.appearsIn.length || (`${a.brand} ${a.productName}` < `${b.brand} ${b.productName}` ? -1 : 1));
}
