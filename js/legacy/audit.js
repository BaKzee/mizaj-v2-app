import { sha256Hex, canonicalJson } from "../domain/hash.js";
import { evidenceForVersion, probableRatings } from "../domain/evidence.js";
import { findForbiddenClaims } from "../domain/vocabulary.js";
import { legacyRecipeKey } from "./extract.js";
import { LEGACY_DEFECTS } from "./defects.js";
const count = (xs, f) => {
    const out = {};
    for (const x of xs) {
        const k = f(x);
        out[k] = (out[k] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
};
/** Values from the handoff's own CORE v1 run (reference/mizaj_core_baseline_2026-10-09.json; re-run in P0, 11/11 tests OK). */
export const CORE_V1_BASELINE = {
    flavors: 89, bundled_recipes: 110, my_recipes: 26, recipe_count: 136, rating_records: 119, rated_recipe_keys: 75,
    rated_versions_with_3plus_observations: 7, ratings_excluded_pre_edit: 12, current_formulas_without_structural_errors: 136,
};
export function buildAuditReport(cat, backupText, backup, mig) {
    const C = cat.catalog;
    const b = mig.bundle;
    const ratings = (backup.ratings ?? {});
    const edits = (backup.edits ?? {});
    const flavorIds = new Set(C.flavors.map((f) => f.id));
    const flavorNames = new Set(C.flavors.map((f) => f.name));
    const keys = [...C.recipes, ...backup.myRecipes].map(legacyRecipeKey);
    const keySet = new Set(keys);
    const integrity = [];
    const add = (id, description, ok, detail, info = false) => integrity.push({ id, description, result: info ? 'info' : ok ? 'pass' : 'fail', detail });
    add('I-01', 'Flavor ids unique', flavorIds.size === C.flavors.length, `${flavorIds.size}/${C.flavors.length}`);
    add('I-02', 'Flavor names unique (needed to resolve name-based bans)', flavorNames.size === C.flavors.length, `${flavorNames.size}/${C.flavors.length}`);
    add('I-03', 'Recipe keys unique across bundled + user recipes', keySet.size === keys.length, `${keySet.size}/${keys.length}`);
    const heads = b.recipes.map((r) => ({ r, v: b.recipeVersions.find((v) => v.versionId === r.headVersionId) }));
    const invalidHeads = heads.filter((h) => h.v.structuralStatus !== 'valid');
    add('I-04', 'Current formula of every recipe: known ids, no duplicates, positive integer bp, sum 10 000', invalidHeads.length === 0, invalidHeads.map((h) => `${h.r.legacyKey}: ${h.v.structuralErrors.join(',')}`).join('; ') || `${heads.length}/${heads.length} valid`);
    const invalidAll = b.recipeVersions.filter((v) => v.structuralStatus !== 'valid');
    add('I-05', 'Every recipe version (originals + edits) structurally valid', invalidAll.length === 0, `${b.recipeVersions.length - invalidAll.length}/${b.recipeVersions.length}`);
    const banUnresolved = C.bans.filter((x) => !flavorNames.has(x.a) || !flavorNames.has(x.b));
    add('I-06', 'Ban pairs resolve to catalog names', banUnresolved.length === 0, `${C.bans.length - banUnresolved.length}/${C.bans.length}`);
    const dupUnresolved = C.duplicates.filter((d) => d.members.some((m) => !flavorNames.has(m)));
    add('I-07', 'Similarity-group names resolve', dupUnresolved.length === 0, `${C.duplicates.length - dupUnresolved.length}/${C.duplicates.length}`);
    const orphanRatings = Object.keys(ratings).filter((k) => !keySet.has(k));
    add('I-08', 'Rating keys resolve to recipes', orphanRatings.length === 0, orphanRatings.join(',') || `${Object.keys(ratings).length} keys`);
    const orphanEdits = Object.keys(edits).filter((k) => !keySet.has(k));
    add('I-09', 'Edit keys resolve to recipes', orphanEdits.length === 0, orphanEdits.join(',') || `${Object.keys(edits).length} keys`);
    const orphanSessions = backup.sessions.filter((s) => !keySet.has(s.key));
    add('I-10', 'Session keys resolve to recipes', orphanSessions.length === 0, `${backup.sessions.length - orphanSessions.length}/${backup.sessions.length}`);
    const invUnknown = Object.keys(backup.inventory).filter((k) => !flavorIds.has(k));
    add('I-11', 'Inventory rows resolve to flavors', invUnknown.length === 0, invUnknown.join(',') || `${Object.keys(backup.inventory).length} rows`);
    const allStars = Object.values(ratings).flat();
    const badStars = allStars.filter((r) => !(Number.isInteger(r['stars']) && r['stars'] >= 1 && r['stars'] <= 5));
    add('I-12', 'Stars are integers 1–5', badStars.length === 0, `${allStars.length - badStars.length}/${allStars.length}`);
    const draft = Array.isArray(backup.draft) ? backup.draft : [];
    add('I-13', 'Draft (unsaved builder state) ids known and sum', draft.every((d) => flavorIds.has(d.id)), `${draft.length} items, sum ${draft.reduce((s, d) => s + d.pct, 0)}% (kept verbatim; not a recipe)`, true);
    const rt = mig.bundle.migrationLog.droppedFields;
    add('I-14', 'Migration dropped no field (byte-exact v1 rebuild from v2 entities)', rt.length === 0, rt.join(', ') || 'see migration certificate');
    const forbiddenInDesc = C.recipes.filter((r) => typeof r['desc'] === 'string' && findForbiddenClaims(r['desc']).length > 0);
    add('I-15', 'Bundled recipe descriptions using certainty language (stored as unverified)', true, `${forbiddenInDesc.length} recipe description(s)`, true);
    /* anomalies */
    const invAnom = mig.stats['inventoryAnomalies'] ?? [];
    const sessAnom = count(b.sessions.flatMap((s) => s.anomalies.map((a) => a.split(':')[0])), (x) => x);
    const dupStartGroups = new Set(b.sessions.filter((s) => s.anomalies.includes('duplicate_start_timestamp')).map((s) => s.startedAt)).size;
    const clusters = b.assessments.filter((a) => a.flags.some((f) => f.startsWith('same_timestamp_cluster')));
    const clusterGroups = count(clusters, (a) => `${a.legacyKey} @ ${a.recordedAt}`);
    const anomalies = {
        inventory: {
            reconciliationMismatches: invAnom.filter((a) => a.anomaly === 'legacy_balance_does_not_reconcile'),
            priceUnknownCount: invAnom.filter((a) => a.anomaly === 'price_unknown').length,
            noInventoryRow: invAnom.filter((a) => a.anomaly === 'no_inventory_row').map((a) => a.flavorId),
        },
        sessions: { byAnomaly: sessAnom, duplicateStartGroups: dupStartGroups, manualEntries: b.sessions.filter((s) => s.durationSource === 'legacy_manual_entry').length },
        ratings: {
            datePrecisionOnly: b.assessments.filter((a) => a.timestampPrecision === 'date_only_presumed').length,
            sameTimestampClusters: clusterGroups,
            linkedToSession: b.assessments.filter((a) => a.sessionId).length,
            linkBasis: count(b.assessments, (a) => a.sessionLinkBasis ?? 'unlinked'),
            withLegacyAutoAdviceMentioningHeatOrCoal: b.assessments.filter((a) => a.legacyAutoAdvice?.safetySensitive).length,
        },
        meta: {
            note: 'meta.lastBackup is set by v1 AFTER the file is generated (L1216), so the exported value is always the previous backup time.',
            lastBackupInFile: backup.meta?.['lastBackup'] ?? null,
            asOfFromRecords: mig.stats['asOf'],
        },
    };
    /* attribution */
    const byStatus = count(b.assessments, (a) => `${a.legacyAttributionStatus} / ${a.attributionBasis}`);
    let preEditByTs = 0;
    for (const [k, list] of Object.entries(ratings)) {
        const e = edits[k];
        if (e)
            preEditByTs += list.filter((r) => r['ts'] < e.ts).length;
    }
    const headProbable = b.recipes.map((r) => ({ key: r.legacyKey, n: evidenceForVersion(r.headVersionId, b.assessments).probable.length }));
    const attribution = {
        byStatusAndBasis: byStatus,
        ratingsBeforeLatestEditByTimestamp: preEditByTs,
        exactVersionVerified: b.assessments.filter((a) => a.legacyAttributionStatus === 'exact_version_verified').length,
        headVersionsWith3PlusProbableRatings: headProbable.filter((x) => x.n >= 3).length,
        policy: 'No v1 rating is exact-version verified (v1 kept no snapshots). Probable = uncertain with a single candidate; unattributed ratings never count for any version.',
    };
    /* baseline parity with CORE v1 */
    const v1usable = (() => {
        // CORE v1 rule: usable = rating not before the edit timestamp (it ignores date precision).
        let n3 = 0;
        for (const k of keys) {
            const e = edits[k];
            const usable = (ratings[k] ?? []).filter((r) => !e || r['ts'] >= e.ts);
            if (usable.length >= 3)
                n3 += 1;
        }
        return n3;
    })();
    const parity = [
        { metric: 'flavors', coreV1: CORE_V1_BASELINE.flavors, v2: b.flavors.length, note: '' },
        { metric: 'recipes (bundled + user)', coreV1: CORE_V1_BASELINE.recipe_count, v2: b.recipes.length, note: '' },
        { metric: 'rating records', coreV1: CORE_V1_BASELINE.rating_records, v2: b.assessments.length, note: 'all preserved' },
        { metric: 'rated recipe keys', coreV1: CORE_V1_BASELINE.rated_recipe_keys, v2: new Set(b.assessments.map((a) => a.legacyKey)).size, note: '' },
        { metric: 'ratings before latest edit', coreV1: CORE_V1_BASELINE.ratings_excluded_pre_edit, v2: preEditByTs, note: 'same rule (timestamp < edit ts); v2 additionally marks day-precision ratings near an edit as unattributed' },
        { metric: 'current formulas with ≥3 usable ratings', coreV1: CORE_V1_BASELINE.rated_versions_with_3plus_observations, v2: `${v1usable} (v1 rule) / ${attribution.headVersionsWith3PlusProbableRatings} (v2 probable)`, note: 'v2 is stricter by design' },
        { metric: 'structurally valid current formulas', coreV1: CORE_V1_BASELINE.current_formulas_without_structural_errors, v2: heads.length - invalidHeads.length, note: '' },
    ];
    const fams = Object.keys(C.familyMatrix).sort();
    const asym = [];
    for (const a of fams)
        for (const c of fams)
            if (a < c && C.familyMatrix[a]?.[c] !== C.familyMatrix[c]?.[a])
                asym.push({ pair: [a, c], forward: C.familyMatrix[a]?.[c], reverse: C.familyMatrix[c]?.[a] });
    const structure = {
        catalog: {
            flavors: C.flavors.length,
            flavorsByFamily: count(C.flavors, (f) => f.family),
            officialConfLabels: count(C.flavors, (f) => String(f['officialConf'] ?? 'none')),
            recipes: C.recipes.length,
            recipesByTestedLabel: count(C.recipes, (r) => String(r['tag'] ?? 'none')),
            families: C.families.length,
            bans: count(C.bans, (x) => x.kind),
            banRules: C.banRules.length,
            laws: C.laws.length,
            similarityGroups: C.duplicates.length,
        },
        backup: {
            schema: backup.schema,
            topLevelKeys: Object.keys(backup),
            userRecipes: backup.myRecipes.length,
            inventoryRows: Object.keys(backup.inventory).length,
            legacyPurchases: Object.values(backup.inventory).reduce((s, r) => s + r.purchases.length, 0),
            sessions: backup.sessions.length,
            ratingKeys: Object.keys(ratings).length,
            ratingRecords: allStars.length,
            starsDistribution: count(allStars, (r) => String(r['stars'])),
            edits: Object.keys(edits).length,
            draftItems: draft.length,
            activeSession: backup.session ? 'present' : 'none',
            settings: backup.settings,
        },
    };
    const report = {
        reportType: 'mizaj-legacy-audit',
        engineVersion: b.engineVersion,
        inputs: { catalogHtmlSha256: cat.htmlSha256, catalogDataLine: cat.lineNumber, catalogDataLineSha256: cat.lineSha256, backupSha256: sha256Hex(backupText), backupBytes: new TextEncoder().encode(backupText).length },
        structure, integrity, anomalies, attribution, baselineParityWithCoreV1: parity, legacyMatrixAsymmetry: asym,
        defects: LEGACY_DEFECTS.map((d) => ({ id: d.id, severity: d.severity, area: d.area, line: d.line, titleAr: d.titleAr })),
    };
    return { ...report, contentSha256: sha256Hex(canonicalJson(report)) };
}
/** Formulas for the rule auditor: current head of each recipe with its probable ratings. */
export function formulasForRuleAudit(mig) {
    const b = mig.bundle;
    const vById = new Map(b.recipeVersions.map((v) => [v.versionId, v]));
    return b.recipes.map((r) => {
        const v = vById.get(r.headVersionId);
        return {
            key: r.legacyKey ?? r.recipeId,
            name: r.name,
            items: v.ingredients.map((i) => ({ id: i.flavorId, pct: i.basisPoints / 100 })),
            probableRatings: probableRatings(r.headVersionId, b.assessments),
        };
    });
}
/* ---------------- Markdown renderers ---------------- */
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
export function renderAuditMarkdown(r) {
    const L = [];
    L.push('# MIZAJ — Legacy audit (P0)', '');
    L.push(`Engine \`${r.engineVersion}\` · content sha256 \`${r.contentSha256}\``, '');
    L.push('## Inputs', '', '| Item | Value |', '|---|---|');
    L.push(`| index.html sha256 | \`${r.inputs.catalogHtmlSha256}\` |`, `| DATA line | ${r.inputs.catalogDataLine} |`, `| backup sha256 | \`${r.inputs.backupSha256}\` |`, `| backup bytes | ${r.inputs.backupBytes} |`, '');
    L.push('## Integrity checks', '', '| ID | Check | Result | Detail |', '|---|---|---|---|');
    for (const c of r.integrity)
        L.push(`| ${c.id} | ${esc(c.description)} | ${c.result} | ${esc(c.detail)} |`);
    L.push('', '## Baseline parity with CORE v1', '', '| Metric | CORE v1 | v2 | Note |', '|---|---|---|---|');
    for (const p of r.baselineParityWithCoreV1)
        L.push(`| ${esc(p.metric)} | ${esc(p.coreV1)} | ${esc(p.v2)} | ${esc(p.note)} |`);
    L.push('', '## Rating attribution', '', '```json', JSON.stringify(r.attribution, null, 2), '```');
    L.push('', '## Anomalies (reported, never auto-corrected)', '', '```json', JSON.stringify(r.anomalies, null, 2), '```');
    L.push('', '## Legacy matrix asymmetry', '');
    for (const a of r.legacyMatrixAsymmetry)
        L.push(`- ${a.pair[0]} → ${a.pair[1]} = ${String(a.forward)}, ${a.pair[1]} → ${a.pair[0]} = ${String(a.reverse)}`);
    L.push('', '## Code defects found in index.html', '', '| ID | Severity | Area | Line | Finding |', '|---|---|---|---|---|');
    for (const d of r.defects)
        L.push(`| ${d.id} | ${d.severity} | ${d.area} | ${d.line} | ${esc(d.titleAr)} |`);
    L.push('', 'Full impact and v2 remedy per defect: `src/legacy/defects.ts`.', '');
    return L.join('\n');
}
export function renderRuleAuditMarkdown(entries, opts = { includePersonal: true }) {
    const L = [`# MIZAJ — Scientific Rule Auditor (P0)${opts.includePersonal ? ' — PRIVATE (contains the user’s ratings)' : ' — shareable summary'}`, ''];
    L.push('Every rule below is `LEGACY_UNVERIFIED`: it exists in the v1 code/catalog with no traceable source. v2 never uses any of them as a hard veto.', '');
    L.push('“Flagged with strong personal record” lists the user’s own formulas that the rule would flag although they carry ≥3 probable-attribution ratings averaging ≥4.5. This shows the rule cannot be an absolute law for this data; it does not prove the rule wrong in general.', '');
    L.push('| Rule | v1 enforcement | v2 decision | Flagged / checked | Strong personal records flagged |', '|---|---|---|---|---|');
    for (const e of entries) {
        const chk = e.check ? `${e.check.flagged} / ${e.check.formulasChecked}` : '—';
        const strong = !e.check ? '—' : opts.includePersonal
            ? e.check.flaggedWithStrongPersonalRecord.map((f) => `${esc(f.name)} (${f.probableN}× avg ${f.probableAvg})`).join('<br>') || '—'
            : String(e.check.flaggedWithStrongPersonalRecord.length);
        L.push(`| ${e.ruleId} | ${e.legacyEnforcement} | ${e.v2Decision} | ${chk} | ${strong} |`);
    }
    L.push('');
    for (const e of entries) {
        L.push(`## ${e.ruleId} — ${e.category}`, '', `- **Where:** ${esc(e.location)}`, `- **Legacy text:** ${esc(e.legacyText)}`, `- **v2 decision:** \`${e.v2Decision}\` — ${esc(e.rationale)}`, `- **Evidence needed to upgrade:** ${esc(e.evidenceNeededToUpgrade)}`);
        if (e.methodSourceIds.length)
            L.push(`- **Method/health sources consulted:** ${e.methodSourceIds.join(', ')} (see src/domain/sourceRegistry.ts for scope limits)`);
        if (opts.includePersonal && e.check?.flaggedWithStrongPersonalRecord.length) {
            L.push('- **Flagged formulas with strong personal record:**');
            for (const f of e.check.flaggedWithStrongPersonalRecord)
                L.push(`  - ${esc(f.name)} \`${f.key}\`: ${f.probableN} probable ratings, avg ${f.probableAvg} — ${esc(f.detail)}`);
        }
        L.push('');
    }
    return L.join('\n');
}
export function renderDefectsMarkdown() {
    const L = ['# Legacy code defects (index.html sha256 74545e09…)', ''];
    L.push('Found by reading the v1 source. Each line reference is checked automatically by tests/regression/defects.test.ts. The legacy file is not modified.', '');
    L.push('| ID | Severity | Area | Line | Finding | Impact | v2 remedy |', '|---|---|---|---|---|---|---|');
    for (const d of LEGACY_DEFECTS)
        L.push(`| ${d.id} | ${d.severity} | ${d.area} | ${d.line} | ${esc(d.titleAr)} | ${esc(d.impact)} | ${esc(d.v2Remedy)} |`);
    L.push('');
    return L.join('\n');
}
