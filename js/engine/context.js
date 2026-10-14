import { deriveBalances } from "../domain/inventory.js";
import { RelationshipIndex } from "../domain/relationships.js";
import { apportionBp, TOTAL_BP } from "../domain/basisPoints.js";
import { sha256Hex, canonicalJson } from "../domain/hash.js";
import { extractDescriptors } from "../knowledge/descriptors.js";
import { PRECISION_CONFIG_V1 } from "./config.js";
function observationsFor(versionId, assessments, sessionsByVersion) {
    const o = { verified: 0, probable: 0, ambiguous: 0, ratings: [], sessions: sessionsByVersion.get(versionId) ?? 0, clustered: 0 };
    const clustered = (a) => a.flags.some((f) => f.startsWith('same_timestamp_cluster'));
    for (const a of assessments) {
        if (a.legacyAttributionStatus === 'exact_version_verified' && a.recipeVersionId === versionId) {
            o.verified++;
            if (clustered(a))
                o.clustered++;
            if (a.rating !== null)
                o.ratings.push(a.rating);
        }
        else if (a.legacyAttributionStatus === 'uncertain' && a.candidateVersionIds.length === 1 && a.candidateVersionIds[0] === versionId) {
            o.probable++;
            if (clustered(a))
                o.clustered++;
            if (a.rating !== null)
                o.ratings.push(a.rating);
        }
        else if (a.candidateVersionIds.includes(versionId)) {
            o.ambiguous++;
        }
    }
    return o;
}
/** CORE §4: tiers describe provenance and repetition of evidence, never liking. */
export function tierFor(o) {
    if (o.verified >= 3)
        return { tier: 'A', attribution: 'exact' };
    if (o.verified >= 1)
        return { tier: 'B', attribution: 'exact' };
    if (o.probable >= 3)
        return { tier: 'A', attribution: 'probable_legacy' };
    if (o.probable >= 1)
        return { tier: 'B', attribution: 'probable_legacy' };
    return { tier: 'U', attribution: 'none' };
}
function nameDescriptors(names) {
    const out = [];
    for (const n of names)
        for (const h of extractDescriptors(n)) {
            if (h.group === 'mix_marker' || h.group === 'style')
                continue;
            if (!out.some((d) => d.id === h.id))
                out.push({ id: h.id, group: h.group, provenance: 'product_name' });
        }
    return out;
}
export function buildEngineContext(bundle, pack, config = PRECISION_CONFIG_V1) {
    const passports = new Map((pack?.passports ?? []).map((p) => [p.flavorId, p]));
    // Identity groups from owner answers (same physical product).
    const parent = new Map();
    const find = (x) => { let r = x; while (parent.get(r) && parent.get(r) !== r)
        r = parent.get(r); return r; };
    const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) {
        const [lo, hi] = ra < rb ? [ra, rb] : [rb, ra];
        parent.set(hi, lo);
        parent.set(lo, lo);
    } };
    for (const f of bundle.flavors)
        parent.set(f.id, f.id);
    for (const p of passports.values()) {
        const other = p.ownerIdentity?.value === 'same_product_as_library_entry' ? p.ownerIdentity.sameAsFlavorId : null;
        if (other && parent.has(other))
            union(p.flavorId, other);
    }
    const products = new Map();
    for (const f of bundle.flavors) {
        const pp = passports.get(f.id);
        const confirmed = (pp?.confirmedNames ?? []).map((c) => c.name);
        const names = [...new Set([f.name, ...f.aliases, ...confirmed])];
        const sourced = (pp?.descriptors ?? []).map((d) => ({
            id: d.id, group: d.group, provenance: d.basedOnStatus === 'verified' ? 'maker_text_verified' : 'sourced_text',
        }));
        const descriptors = [...sourced];
        for (const d of nameDescriptors(names))
            if (!descriptors.some((x) => x.id === d.id))
                descriptors.push(d);
        products.set(f.id, {
            id: f.id, brand: f.brand, name: f.name, names, canonicalId: find(f.id), sameAs: [],
            descriptors,
            multiNote: (pp?.multiNote ?? []).some((m) => m.signal === 'description_names_several_components'),
            sourced: sourced.length > 0,
            auditStatus: pp?.auditStatus ?? 'unknown',
        });
    }
    for (const p of products.values())
        p.sameAs = [...products.values()].filter((q) => q.id !== p.id && q.canonicalId === p.canonicalId).map((q) => q.id).sort();
    // Recorded sessions per exact version (usage only).
    const sessionsByVersion = new Map();
    for (const s of bundle.sessions)
        if (s.candidateVersionIds.length === 1)
            sessionsByVersion.set(s.candidateVersionIds[0], (sessionsByVersion.get(s.candidateVersionIds[0]) ?? 0) + 1);
    const references = [];
    const recipeById = new Map(bundle.recipes.map((r) => [r.recipeId, r]));
    for (const v of bundle.recipeVersions) {
        if (v.structuralStatus !== 'valid')
            continue;
        const r = recipeById.get(v.recipeId);
        const o = observationsFor(v.versionId, bundle.assessments, sessionsByVersion);
        const { tier, attribution } = tierFor(o);
        references.push({
            refId: v.versionId, kind: r?.origin === 'legacy_bundled' ? 'legacy_book' : 'personal', recipeId: v.recipeId, name: r?.name ?? v.recipeId,
            versionId: v.versionId, isHead: r?.headVersionId === v.versionId, ingredients: v.ingredients.map((i) => ({ ...i })),
            observations: o, tier, attribution,
            support: o.ratings.filter((x) => x >= 4).length, caution: o.ratings.filter((x) => x <= config.caution.lowRating).length,
            url: null, claimId: null,
        });
    }
    for (const d of pack?.corpus ?? []) {
        if (d.status !== 'accepted' || !d.ingredients || !d.claimId)
            continue;
        references.push({
            refId: d.claimId, kind: 'published', recipeId: null, name: d.entryId, versionId: null, isHead: true, ingredients: d.ingredients.map((i) => ({ ...i })),
            observations: { verified: 0, probable: 0, ambiguous: 0, ratings: [], sessions: 0, clustered: 0 }, tier: 'C', attribution: 'published', support: 0, caution: 0,
            url: d.url, claimId: d.claimId,
        });
    }
    references.sort((a, b) => (a.refId < b.refId ? -1 : 1));
    const balancesMg = new Map();
    for (const [id, b] of deriveBalances(bundle.inventoryEvents))
        balancesMg.set(id, b.availableMg);
    // Proportion templates: median share at each rank among supported personal formulas.
    const proportionTemplates = new Map();
    for (let k = 2; k <= 6; k++) {
        const rows = references.filter((r) => r.kind !== 'published' && r.support > 0 && r.support >= r.caution && r.ingredients.length === k)
            .map((r) => r.ingredients.map((i) => i.basisPoints).sort((x, y) => y - x));
        if (!rows.length)
            continue;
        const med = Array.from({ length: k }, (_, j) => {
            const col = rows.map((row) => row[j]).sort((x, y) => x - y);
            return col.length % 2 ? col[(col.length - 1) / 2] : (col[col.length / 2 - 1] + col[col.length / 2]) / 2;
        });
        const bp = apportionBp(med.map((w, j) => ({ key: String(j), weight: w })));
        proportionTemplates.set(k, med.map((_, j) => bp.get(String(j))));
    }
    for (const t of proportionTemplates.values())
        if (t.reduce((s, x) => s + x, 0) !== TOTAL_BP)
            throw new Error('template does not sum to 10 000 bp');
    const dataFingerprint = sha256Hex(canonicalJson({
        config: config.id,
        flavors: bundle.flavors.map((f) => f.id),
        refs: references.map((r) => [r.refId, r.tier, r.support, r.caution]),
        balances: [...balancesMg].sort(),
        identity: [...products.values()].map((p) => [p.id, p.canonicalId, p.descriptors.map((d) => d.id)]),
    })).slice(0, 16);
    const legacyPct = new Map();
    for (const c of bundle.claims) {
        if (c.claimType !== 'legacy_pct_heuristic' || !['minPct', 'maxPct', 'hardCap'].includes(c.property) || typeof c.claimValue !== 'number')
            continue;
        const l = legacyPct.get(c.entityId) ?? [];
        l.push({ property: c.property, value: c.claimValue, claimId: c.claimId });
        legacyPct.set(c.entityId, l);
    }
    return { config, products, references, balancesMg, relationships: new RelationshipIndex(bundle.claims), proportionTemplates, legacyPct, dataFingerprint };
}
export function productOf(ctx, id) {
    return ctx.products.get(id);
}
