import { ENGINE_VERSION, SCHEMA_VERSION } from "../domain/types.js";
import { contentId, sha256Hex } from "../domain/hash.js";
import { pctToBpExact } from "../domain/basisPoints.js";
import { createRecipeVersion } from "../domain/recipeVersion.js";
import { makeClaim } from "../domain/claims.js";
import { groupKey, pairKey } from "../domain/relationships.js";
import { SEED_SOURCES } from "../domain/sourceRegistry.js";
import { findForbiddenClaims, isSafetySensitive } from "../domain/vocabulary.js";
import { findMarkupStrings } from "../domain/sanitize.js";
import { applyOwnerDecisions } from "../domain/ownerDecisions.js";
import { legacyRecipeKey, parseBackup, recipeIdFromLegacyKey } from "../legacy/extract.js";
import { attributeByTime, isValidTs, timestampPrecision } from "./attribution.js";
export const PROCESS_ID = `migration:v1-import@${ENGINE_VERSION}`;
const HANDLED_TOP_LEVEL = new Set(['schema', 'settings', 'inventory', 'draft', 'sessions', 'myRecipes', 'meta', 'ratings', 'edits', 'session']);
const HANDLED_CATALOG = new Set(['flavors', 'families', 'familyMatrix', 'bans', 'banRules', 'duplicates', 'laws', 'recipes']);
export const OUTLIER_SESSION_MINUTES = 240;
export const TIMER_LINK_WINDOW_MS = 24 * 3_600_000;
const iso = (ts) => (isValidTs(ts) ? new Date(ts).toISOString() : null);
const legacyRef = (path) => `legacy:index.html#${path}`;
const backupRef = (path) => `legacy:backup#${path}`;
/* ------------------------------------------------------------------ */
function itemsToIngredients(items) {
    const problems = [];
    if (!Array.isArray(items))
        return { ingredients: [], problems: ['items_not_array'] };
    const ingredients = items.map((it, i) => {
        const conv = pctToBpExact(it?.pct);
        if (!conv.ok)
            problems.push(`item[${i}]:${conv.reason}`);
        const bp = conv.ok ? conv.bp : typeof it?.pct === 'number' && Number.isFinite(it.pct) ? Math.round(it.pct * 100) : 0;
        return { flavorId: typeof it?.id === 'string' ? it.id : '', basisPoints: bp };
    });
    return { ingredients, problems };
}
const FLAVOR_AXES = ['power', 'sweet', 'acid', 'cool', 'density', 'ceiling', 'volatility', 'duration'];
const FLAVOR_PCT = ['idealPct', 'idealG', 'minPct', 'maxPct', 'hardCap'];
const FLAVOR_KNOWN = new Set([
    'id', 'name', 'brand', 'family', 'subfamily', 'role', 'roles', 'roleStrict', 'official', 'officialConf', 'note',
    'ceilingAr', 'volatilityAr', 'durationAr', 'userAdded', ...FLAVOR_AXES, ...FLAVOR_PCT,
]);
function flavorClaims(f, base) {
    const out = [];
    const ref = (p) => `${base}.${p}`;
    for (const ax of FLAVOR_AXES) {
        if (f[ax] === undefined || f[ax] === null)
            continue;
        const label = f[`${ax}Ar`];
        const safety = ax === 'ceiling';
        out.push(makeClaim({
            claimType: 'legacy_axis_estimate', entityType: 'flavor', entityId: f.id, property: ax,
            claimValue: label === undefined ? f[ax] : { value: f[ax], labelAr: label }, unit: 'legacy_scale_1_5',
            sourceType: 'LEGACY_UNVERIFIED', sourceRef: ref(ax),
            validityNotes: ['Unmeasured catalog estimate (CORE §2). Not a sensory measurement; not used as intensity.'],
            reviewerOrProcess: PROCESS_ID, usage: safety ? 'excluded' : 'descriptive_only', safetySensitive: safety,
        }));
    }
    for (const p of FLAVOR_PCT) {
        if (f[p] === undefined || f[p] === null)
            continue;
        out.push(makeClaim({
            claimType: 'legacy_pct_heuristic', entityType: 'flavor', entityId: f.id, property: p, claimValue: f[p],
            unit: p === 'idealG' ? 'g' : 'pct', sourceType: 'LEGACY_UNVERIFIED', sourceRef: ref(p),
            validityNotes: ['legacy_heuristic: non-binding (CORE §2). Never rejects a recipe.'],
            reviewerOrProcess: PROCESS_ID, usage: 'warning_only', safetySensitive: false,
        }));
    }
    for (const p of ['family', 'subfamily', 'role', 'roles', 'roleStrict']) {
        if (f[p] === undefined)
            continue;
        out.push(makeClaim({
            claimType: 'legacy_taxonomy', entityType: 'flavor', entityId: f.id, property: p, claimValue: f[p],
            sourceType: 'LEGACY_UNVERIFIED', sourceRef: ref(p), reviewerOrProcess: PROCESS_ID, usage: 'descriptive_only', safetySensitive: false,
            validityNotes: ['Catalog label; not a verified product identity (P1 audit pending).'],
        }));
    }
    if (typeof f['official'] === 'string' && f['official']) {
        out.push(makeClaim({
            claimType: 'manufacturer_description_unsourced', entityType: 'flavor', entityId: f.id, property: 'official',
            claimValue: f['official'], sourceType: 'LEGACY_UNVERIFIED', sourceRef: ref('official'),
            methodOrExcerpt: `legacy officialConf=${JSON.stringify(f['officialConf'] ?? null)}`,
            validityNotes: [
                'Described as an official text in v1 but carries no URL; cannot be MANUFACTURER_DESCRIPTION until a source is recorded (P1).',
                'A legacy confidence label such as "exact" does not verify anything (ROADMAP P1 acceptance).',
            ],
            reviewerOrProcess: PROCESS_ID, usage: 'descriptive_only',
        }));
    }
    if (typeof f['note'] === 'string' && f['note']) {
        const safety = isSafetySensitive(f['note']);
        out.push(makeClaim({
            claimType: 'legacy_book_note', entityType: 'flavor', entityId: f.id, property: 'note', claimValue: f['note'],
            sourceType: 'LEGACY_UNVERIFIED', sourceRef: ref('note'), reviewerOrProcess: PROCESS_ID,
            usage: safety ? 'excluded' : 'descriptive_only', safetySensitive: safety,
            validityNotes: safety ? ['Mentions heat/coal: stored for audit only (rule 12).'] : [],
        }));
    }
    for (const k of Object.keys(f)) {
        if (FLAVOR_KNOWN.has(k))
            continue;
        out.push(makeClaim({
            claimType: 'legacy_unclassified_field', entityType: 'flavor', entityId: f.id, property: k, claimValue: f[k],
            sourceType: 'LEGACY_UNVERIFIED', sourceRef: ref(k), reviewerOrProcess: PROCESS_ID, usage: 'descriptive_only',
        }));
    }
    return out;
}
function toFlavorProduct(f, collection, index) {
    return {
        schemaVersion: SCHEMA_VERSION,
        id: f.id,
        brand: typeof f.brand === 'string' ? f.brand : '—',
        name: f.name,
        line: null,
        aliases: [],
        isPreblend: null,
        sensoryNotes: [],
        estimatedIntensity: null,
        sourceRefs: [],
        verificationStatus: 'unverified',
        lifecycle: collection === 'backup.userFlavors' ? 'user_added' : 'catalog',
        missingData: ['official_source_url', 'product_line', 'preblend_status', 'measured_intensity', 'sourced_sensory_descriptors'],
        legacy: f,
        legacyCollection: collection,
        legacyIndex: index,
    };
}
/* ------------------------------------------------------------------ */
export function migrateV1ToV2(input) {
    const review = [];
    const { catalog } = input.catalog;
    const backupSha256 = sha256Hex(input.backupText);
    const backup = parseBackup(input.backupText);
    const ratingsObj = (backup.ratings ?? {});
    const editsObj = (backup.edits ?? {});
    /* ---------- flavors ---------- */
    const flavors = [];
    const claims = [];
    const knownIds = new Set();
    catalog.flavors.forEach((f, i) => {
        if (knownIds.has(f.id))
            review.push({ code: 'duplicate_flavor_id_in_catalog', severity: 'blocking', detail: f.id });
        knownIds.add(f.id);
        flavors.push(toFlavorProduct(f, 'catalog.flavors', i));
        claims.push(...flavorClaims(f, legacyRef(`L${input.catalog.lineNumber}/DATA.flavors[${f.id}]`)));
    });
    const userFlavors = Array.isArray(backup.userFlavors) ? backup.userFlavors : [];
    userFlavors.forEach((f, i) => {
        if (!f || typeof f.id !== 'string') {
            review.push({ code: 'user_flavor_without_id', severity: 'decision', detail: `userFlavors[${i}]` });
            return;
        }
        if (knownIds.has(f.id)) {
            review.push({ code: 'user_flavor_id_collision', severity: 'decision', detail: `${f.id} (kept verbatim in passthrough; v1 also ignores it)` });
            return;
        }
        knownIds.add(f.id);
        flavors.push(toFlavorProduct(f, 'backup.userFlavors', i));
        claims.push(...flavorClaims(f, backupRef(`userFlavors[${i}]`)));
    });
    const flavorEdits = backup.flavorEdits && typeof backup.flavorEdits === 'object' ? backup.flavorEdits : {};
    for (const [fid, ov] of Object.entries(flavorEdits)) {
        for (const prop of ['official', 'note']) {
            const v = ov?.[prop];
            if (typeof v !== 'string')
                continue;
            claims.push(makeClaim({
                claimType: 'user_text_override', entityType: 'flavor', entityId: fid, property: prop, claimValue: v,
                sourceType: 'USER_OBSERVATION', sourceRef: backupRef(`flavorEdits.${fid}.${prop}`), reviewerOrProcess: PROCESS_ID,
                usage: isSafetySensitive(v) ? 'excluded' : 'descriptive_only',
                validityNotes: ['User-edited product text from v1. Personal note, not a manufacturer statement.'],
            }));
        }
    }
    const nameToId = new Map(flavors.map((f) => [f.name, f.id]));
    /* ---------- family matrix, bans, duplicates (relationship claims) ---------- */
    const fm = catalog.familyMatrix;
    const fams = Object.keys(fm);
    for (const a of fams) {
        for (const b of fams) {
            if (a > b)
                continue;
            const fwd = fm[a]?.[b];
            const rev = fm[b]?.[a];
            const conflicting = fwd !== rev;
            claims.push(makeClaim({
                claimType: 'legacy_family_score', entityType: 'family_pair', entityId: a === b ? `${a}|${a}` : pairKey(a, b), property: 'compatibility_score',
                claimValue: { relationshipType: 'unknown', legacyScore: conflicting ? null : fwd, legacyForward: fwd, legacyReverse: rev, note: a === b ? 'same-family score' : null },
                unit: 'legacy_scale_1_5', sourceType: 'LEGACY_UNVERIFIED', sourceRef: legacyRef(`L${input.catalog.lineNumber}/DATA.familyMatrix[${a}][${b}]`),
                reviewerOrProcess: PROCESS_ID, usage: conflicting ? 'excluded' : 'weak_prior', conflicting,
                validityNotes: conflicting
                    ? [`Asymmetric in v1 (${a}→${b}=${fwd}, ${b}→${a}=${rev}); order-dependent scoring removed (D-11). No value chosen without evidence.`]
                    : ['Unsourced family-level prior; never a veto (CORE §6).'],
            }));
        }
    }
    catalog.bans.forEach((ban, i) => {
        const ia = nameToId.get(ban.a);
        const ib = nameToId.get(ban.b);
        if (!ia || !ib || ia === ib) {
            review.push({ code: 'ban_name_unresolved', severity: 'decision', detail: `bans[${i}] ${ban.a} × ${ban.b}` });
        }
        const entityId = ia && ib && ia !== ib ? pairKey(ia, ib) : `unresolved:${ban.a}|${ban.b}`;
        claims.push(makeClaim({
            claimType: 'legacy_pair_verdict', entityType: 'flavor_pair', entityId, property: 'relationship',
            claimValue: { relationshipType: ban.kind === 'fail' ? 'reported_clash' : 'potential_redundancy', note: ban.reason, legacyKind: ban.kind },
            sourceType: 'LEGACY_UNVERIFIED', sourceRef: legacyRef(`L${input.catalog.lineNumber}/DATA.bans[${i}]`), reviewerOrProcess: PROCESS_ID,
            usage: 'warning_only', validityNotes: ['v1 hard ban demoted: caution only, never a veto (CORE §6).'],
        }));
    });
    catalog.duplicates.forEach((d, i) => {
        const ids = d.members.map((m) => nameToId.get(m));
        if (ids.some((x) => !x))
            review.push({ code: 'duplicate_group_name_unresolved', severity: 'decision', detail: `duplicates[${i}] ${d.members.join(', ')}` });
        claims.push(makeClaim({
            claimType: 'legacy_similarity_group', entityType: 'flavor_group', entityId: groupKey(ids.map((x, k) => x ?? `unresolved:${d.members[k]}`)), property: 'relationship',
            claimValue: { relationshipType: 'potential_redundancy', note: d.note, members: d.members },
            sourceType: 'LEGACY_UNVERIFIED', sourceRef: legacyRef(`L${input.catalog.lineNumber}/DATA.duplicates[${i}]`), reviewerOrProcess: PROCESS_ID, usage: 'warning_only',
        }));
    });
    catalog.laws.forEach((l, i) => {
        claims.push(makeClaim({
            claimType: 'legacy_law', entityType: 'rule', entityId: `law_${l.n}`, property: 'text', claimValue: l,
            sourceType: 'LEGACY_UNVERIFIED', sourceRef: legacyRef(`L${input.catalog.lineNumber}/DATA.laws[${i}]`), reviewerOrProcess: PROCESS_ID,
            usage: isSafetySensitive(`${l.title} ${l.rule}`) ? 'excluded' : 'warning_only',
            validityNotes: ['Unsourced v1 “law”; see reports/rule_audit for the v2 decision.'],
        }));
    });
    catalog.banRules.forEach((b, i) => {
        claims.push(makeClaim({
            claimType: 'legacy_ban_rule', entityType: 'rule', entityId: `banRule_${i}`, property: 'text', claimValue: b,
            sourceType: 'LEGACY_UNVERIFIED', sourceRef: legacyRef(`L${input.catalog.lineNumber}/DATA.banRules[${i}]`), reviewerOrProcess: PROCESS_ID, usage: 'warning_only',
        }));
    });
    /* ---------- recipes + immutable versions ---------- */
    const recipes = [];
    const versions = [];
    const timelines = new Map();
    const headItems = new Map();
    const keysSeen = new Set();
    const addRecipe = (r, collection, index) => {
        let key;
        try {
            key = legacyRecipeKey(r);
        }
        catch (e) {
            review.push({ code: 'recipe_without_key', severity: 'blocking', detail: `${collection}[${index}]: ${e.message}` });
            return;
        }
        if (keysSeen.has(key)) {
            review.push({ code: 'duplicate_recipe_key', severity: 'blocking', detail: key });
            return;
        }
        keysSeen.add(key);
        const recipeId = recipeIdFromLegacyKey(key);
        const isUser = collection === 'backup.myRecipes';
        const conv = itemsToIngredients(r.items);
        if (conv.problems.length)
            review.push({ code: 'non_exact_legacy_pct', severity: 'blocking', detail: `${key}: ${conv.problems.join(', ')}` });
        const v0 = createRecipeVersion({
            recipeId, parentVersionId: null, createdAt: isUser ? iso(r.created) : null, origin: isUser ? 'recorded' : 'legacy',
            ingredients: conv.ingredients, knownFlavorIds: knownIds,
            explanation: isUser ? 'Original formula as saved by the user in v1.' : 'Bundled v1 library formula (not evidence of testing).',
        });
        if (v0.structuralStatus !== 'valid')
            review.push({ code: 'invalid_legacy_formula', severity: 'blocking', detail: `${key} v0: ${v0.structuralErrors.join(', ')}` });
        versions.push(v0);
        const versionIds = [v0.versionId];
        let head = v0;
        let headRaw = Array.isArray(r.items) ? r.items : [];
        const edit = editsObj[key];
        if (edit !== undefined) {
            const conv1 = itemsToIngredients(edit?.['items']);
            if (conv1.problems.length)
                review.push({ code: 'non_exact_legacy_pct', severity: 'blocking', detail: `${key} edit: ${conv1.problems.join(', ')}` });
            const v1 = createRecipeVersion({
                recipeId, parentVersionId: v0.versionId, createdAt: iso(edit?.['ts']), origin: 'derived', ingredients: conv1.ingredients, knownFlavorIds: knownIds,
                explanation: typeof edit?.['reason'] === 'string' ? `User edit reason (v1): ${edit['reason']}` : 'User edit (v1).',
                legacyEditRaw: edit ?? null,
            });
            if (v1.structuralStatus !== 'valid')
                review.push({ code: 'invalid_legacy_formula', severity: 'blocking', detail: `${key} edit: ${v1.structuralErrors.join(', ')}` });
            if (v1.ingredients.length === v0.ingredients.length && JSON.stringify([...v1.ingredients].sort((a, b) => (a.flavorId < b.flavorId ? -1 : 1))) === JSON.stringify([...v0.ingredients].sort((a, b) => (a.flavorId < b.flavorId ? -1 : 1)))) {
                review.push({ code: 'edit_identical_to_original', severity: 'info', detail: key });
            }
            versions.push(v1);
            versionIds.push(v1.versionId);
            head = v1;
            headRaw = Array.isArray(edit?.['items']) ? edit['items'] : [];
            timelines.set(key, { originalVersionId: v0.versionId, latestEdit: isValidTs(edit?.['ts']) ? { versionId: v1.versionId, ts: edit['ts'] } : { versionId: v1.versionId, ts: Number.MAX_SAFE_INTEGER } });
            if (!isValidTs(edit?.['ts']))
                review.push({ code: 'edit_without_timestamp', severity: 'decision', detail: key });
        }
        else {
            timelines.set(key, { originalVersionId: v0.versionId, latestEdit: null });
        }
        headItems.set(key, { name: r.name, items: headRaw.map((x) => ({ id: x.id, pct: x.pct })) });
        recipes.push({
            schemaVersion: SCHEMA_VERSION, recipeId, legacyKey: key, name: String(r.name ?? ''), category: typeof r.category === 'string' ? r.category : null,
            origin: isUser ? 'user_created' : 'legacy_bundled', createdAt: isUser ? iso(r.created) : null,
            headVersionId: head.versionId, versionIds, legacyRaw: r, legacyCollection: collection, legacyIndex: index,
        });
        // recipe-level legacy claims
        const rBase = isUser ? backupRef(`myRecipes[${index}]`) : legacyRef(`L${input.catalog.lineNumber}/DATA.recipes[${index}]`);
        if (!isUser && (r['tested'] !== undefined || r['tag'] !== undefined)) {
            claims.push(makeClaim({
                claimType: 'legacy_tested_label', entityType: 'recipe', entityId: recipeId, property: 'tested', claimValue: { tested: r['tested'] ?? null, tag: r['tag'] ?? null },
                sourceType: 'LEGACY_UNVERIFIED', sourceRef: `${rBase}.tested`, reviewerOrProcess: PROCESS_ID, usage: 'descriptive_only',
                validityNotes: ['Book label only: no test record, version or date behind it (EVIDENCE: bundled ≠ tested).'],
            }));
        }
        if (typeof r['desc'] === 'string' && r['desc']) {
            const hits = findForbiddenClaims(r['desc']);
            claims.push(makeClaim({
                claimType: 'legacy_recipe_description', entityType: 'recipe', entityId: recipeId, property: 'desc', claimValue: r['desc'],
                sourceType: 'LEGACY_UNVERIFIED', sourceRef: `${rBase}.desc`, reviewerOrProcess: PROCESS_ID, usage: 'descriptive_only',
                validityNotes: hits.length ? [`Contains certainty language (${hits.map((h) => h.id).join(', ')}); show only with an "unverified" badge.`] : [],
            }));
        }
        for (const p of ['setup', 'bowl', 'minLo', 'minHi']) {
            if (r[p] === undefined || r[p] === null)
                continue;
            claims.push(makeClaim({
                claimType: 'legacy_setup_instruction', entityType: 'recipe', entityId: recipeId, property: p, claimValue: r[p],
                sourceType: 'LEGACY_UNVERIFIED', sourceRef: `${rBase}.${p}`, reviewerOrProcess: PROCESS_ID, usage: 'excluded',
                safetySensitive: p === 'setup' || isSafetySensitive(r[p]),
                validityNotes: ['Equipment/heat/time context from v1. Not a recommendation (rule 12, CORE §11).'],
            }));
        }
    };
    catalog.recipes.forEach((r, i) => addRecipe(r, 'catalog.recipes', i));
    backup.myRecipes.forEach((r, i) => addRecipe(r, 'backup.myRecipes', i));
    const orphanEdits = {};
    for (const k of Object.keys(editsObj)) {
        if (!keysSeen.has(k)) {
            orphanEdits[k] = editsObj[k];
            review.push({ code: 'orphan_edit', severity: 'decision', detail: k });
        }
    }
    /* ---------- sessions ---------- */
    const sessionsRaw = backup.sessions;
    const startCounts = new Map();
    for (const s of sessionsRaw)
        if (isValidTs(s?.start))
            startCounts.set(s.start, (startCounts.get(s.start) ?? 0) + 1);
    const capMin = typeof backup.settings['sessionCapMin'] === 'number' ? backup.settings['sessionCapMin'] : 90;
    const sessions = sessionsRaw.map((s, i) => {
        const key = typeof s?.key === 'string' ? s.key : null;
        const tl = key ? timelines.get(key) ?? null : null;
        if (key && !tl)
            review.push({ code: 'session_orphan_key', severity: 'decision', detail: `sessions[${i}] key=${key}` });
        const att = attributeByTime(s?.start, tl);
        const anomalies = [];
        const manual = s?.manual === true;
        if (manual && s.minutes === capMin && s.start === s.end)
            anomalies.push('manual_default_duration');
        else if (manual)
            anomalies.push('manual_entry');
        if (s?.minutes === 0)
            anomalies.push('zero_duration');
        if (typeof s?.minutes === 'number' && s.minutes > OUTLIER_SESSION_MINUTES)
            anomalies.push(`outlier_long_duration:${s.minutes}min`);
        if (!manual && isValidTs(s?.end) && isValidTs(s?.start) && Math.abs(s.minutes - (s.end - s.start) / 60000) > 1.5)
            anomalies.push('minutes_mismatch');
        if (isValidTs(s?.start) && (startCounts.get(s.start) ?? 0) > 1)
            anomalies.push('duplicate_start_timestamp');
        if (isValidTs(s?.end) && isValidTs(s?.start) && s.end < s.start)
            anomalies.push('end_before_start');
        if (!key || !tl)
            anomalies.push('unknown_recipe_key');
        return {
            schemaVersion: SCHEMA_VERSION,
            sessionId: `ss_v1_${i}`,
            recipeId: key && tl ? recipeIdFromLegacyKey(key) : null,
            legacyKey: key,
            candidateVersionIds: att.candidates,
            versionAttributionStatus: att.status,
            versionAttributionBasis: att.basis,
            startedAt: iso(s?.start),
            endedAt: iso(s?.end),
            recordedMinutes: typeof s?.minutes === 'number' ? s.minutes : null,
            durationSource: manual ? 'legacy_manual_entry' : 'timer',
            timestampPrecision: isValidTs(s?.start) ? timestampPrecision(s.start) : 'ms',
            anomalies,
            contextNote: 'Coal, rotation and phase marks are descriptive context only; not evidence of quality or safety (CORE §11).',
            legacyRaw: s,
            legacyIndex: i,
        };
    });
    /* ---------- assessments ---------- */
    const assessments = [];
    const linkedSessions = new Set();
    for (const key of Object.keys(ratingsObj)) {
        const list = ratingsObj[key];
        if (!Array.isArray(list)) {
            review.push({ code: 'ratings_not_array', severity: 'blocking', detail: key });
            continue;
        }
        const tl = timelines.get(key) ?? null;
        if (!tl)
            review.push({ code: 'rating_orphan_key', severity: 'decision', detail: key });
        const tsCounts = new Map();
        for (const r of list)
            if (isValidTs(r?.ts))
                tsCounts.set(r.ts, (tsCounts.get(r.ts) ?? 0) + 1);
        list.forEach((r, idx) => {
            const att = attributeByTime(r?.['ts'], tl);
            const flags = [];
            const stars = r?.['stars'];
            const validStars = typeof stars === 'number' && Number.isInteger(stars) && stars >= 1 && stars <= 5;
            if (!validStars)
                flags.push('stars_out_of_range');
            const ts = r?.['ts'];
            const prec = isValidTs(ts) ? timestampPrecision(ts) : 'ms';
            if (prec === 'date_only_presumed')
                flags.push('date_only_presumed');
            if (isValidTs(ts) && (tsCounts.get(ts) ?? 0) > 1)
                flags.push(`same_timestamp_cluster:${tsCounts.get(ts)}`);
            const recipeCreated = recipes.find((x) => x.legacyKey === key)?.legacyRaw?.['created'];
            if (isValidTs(ts) && isValidTs(recipeCreated) && ts < recipeCreated && prec === 'ms')
                flags.push('before_recipe_created');
            const fix = typeof r?.['fix'] === 'string' ? r['fix'] : '';
            assessments.push({
                schemaVersion: SCHEMA_VERSION,
                assessmentId: `as_v1_${key}_${idx}`,
                recipeId: recipeIdFromLegacyKey(key),
                recipeVersionId: null,
                candidateVersionIds: att.candidates,
                legacyAttributionStatus: att.status,
                attributionBasis: att.basis,
                legacyKey: key,
                recordedAt: iso(ts),
                timestampPrecision: prec,
                provenance: 'legacy_import',
                rating: validStars ? stars : null,
                descriptors: Array.isArray(r?.['chips']) ? r['chips'].map(String) : [],
                note: typeof r?.['note'] === 'string' ? r['note'] : '',
                legacyAutoAdvice: fix ? { text: fix, sourceType: 'LEGACY_UNVERIFIED', safetySensitive: isSafetySensitive(fix), usage: 'excluded' } : null,
                sessionId: null,
                sessionLinkBasis: null,
                flags,
                legacyRaw: r,
                legacyIndex: idx,
            });
        });
    }
    // --- link ratings ↔ sessions (descriptive; never changes attribution) ---
    const sessionsByKey = new Map();
    for (const s of sessions)
        if (s.legacyKey)
            sessionsByKey.set(s.legacyKey, [...(sessionsByKey.get(s.legacyKey) ?? []), s]);
    for (const a of assessments) {
        const ts = a.legacyRaw?.['ts'] ?? NaN;
        const cand = sessionsByKey.get(a.legacyKey ?? '') ?? [];
        const sm = a.legacyRaw?.['sessionMin'];
        if (sm === undefined || sm === null) {
            const s = cand.find((x) => !linkedSessions.has(x.sessionId) && x.durationSource === 'legacy_manual_entry' && x.legacyRaw['start'] === ts);
            if (s) {
                a.sessionId = s.sessionId;
                a.sessionLinkBasis = 'manual_pair_same_timestamp';
                linkedSessions.add(s.sessionId);
            }
        }
        else {
            const options = cand
                .filter((x) => !linkedSessions.has(x.sessionId) && x.durationSource === 'timer' && x.recordedMinutes === sm)
                .filter((x) => { const end = x.legacyRaw['end']; return isValidTs(end) && end <= ts && ts - end <= TIMER_LINK_WINDOW_MS; })
                .sort((x, y) => y.legacyRaw['end'] - x.legacyRaw['end']);
            const s = options[0];
            if (s) {
                a.sessionId = s.sessionId;
                a.sessionLinkBasis = 'timer_session_followed_by_rating';
                linkedSessions.add(s.sessionId);
            }
        }
    }
    /* ---------- inventory: audited opening snapshots ---------- */
    const allTs = [];
    for (const s of sessionsRaw) {
        if (isValidTs(s?.start))
            allTs.push(s.start);
        if (isValidTs(s?.end))
            allTs.push(s.end);
    }
    for (const list of Object.values(ratingsObj))
        if (Array.isArray(list))
            for (const r of list)
                if (isValidTs(r?.ts))
                    allTs.push(r.ts);
    for (const e of Object.values(editsObj)) {
        const t = e?.['ts'];
        if (isValidTs(t))
            allTs.push(t);
    }
    const invObj = backup.inventory;
    for (const row of Object.values(invObj)) {
        if (isValidTs(row?.lastUsed))
            allTs.push(row.lastUsed);
        for (const p of Array.isArray(row?.purchases) ? row.purchases : [])
            if (isValidTs(p?.ts))
                allTs.push(p.ts);
    }
    const asOfTs = allTs.length ? Math.max(...allTs) : 0;
    const asOf = iso(asOfTs) ?? input.ranAt;
    const inventoryEvents = [];
    const inventoryAnomalies = [];
    Object.keys(invObj).forEach((fid, i) => {
        const row = invObj[fid];
        const rem = pctToMg(row?.remG);
        const pack = pctToMg(row?.packG);
        if (rem === null)
            review.push({ code: 'inventory_remaining_not_exact_mg', severity: 'blocking', detail: fid });
        if (!knownIds.has(fid))
            review.push({ code: 'inventory_for_unknown_flavor', severity: 'decision', detail: fid });
        const purchasesG = (Array.isArray(row?.purchases) ? row.purchases : []).reduce((s, p) => s + (typeof p?.g === 'number' ? p.g : 0), 0);
        if (typeof row?.remG === 'number' && typeof row?.usedG === 'number' && typeof row?.packG === 'number') {
            const observed = Math.round((row.remG + row.usedG) * 1000);
            const expected = Math.round((row.packG + purchasesG) * 1000);
            if (observed !== expected) {
                inventoryAnomalies.push({
                    flavorId: fid, anomaly: 'legacy_balance_does_not_reconcile',
                    detail: `remaining ${row.remG} g + used ${row.usedG} g = ${observed / 1000} g, but first pack ${row.packG} g + recorded purchases ${purchasesG} g = ${expected / 1000} g (difference ${(observed - expected) / 1000} g). Consistent with v1 refill()/correction behaviour (D-02, D-03) — an inference, not a measurement.`,
                });
            }
        }
        if (row && (row.price === undefined || row.price === null))
            inventoryAnomalies.push({ flavorId: fid, anomaly: 'price_unknown', detail: 'No price recorded; cost stays unknown (not 0).' });
        inventoryEvents.push({
            schemaVersion: SCHEMA_VERSION,
            eventId: `ie_v1_open_${fid}`,
            flavorId: fid,
            seq: i + 1,
            type: 'opening_snapshot',
            at: asOf,
            deltaMg: null,
            balanceMg: rem ?? 0,
            batchId: null,
            packMg: pack,
            cost: null,
            sessionId: null,
            recipeVersionId: null,
            note: 'Audited opening balance = v1 remaining grams as exported. Historic purchases/usage kept as legacy notes, not re-applied.',
            legacyRaw: row,
        });
    });
    for (const id of knownIds)
        if (!(id in invObj))
            inventoryAnomalies.push({ flavorId: id, anomaly: 'no_inventory_row', detail: 'No v1 inventory row: balance unknown, not assumed full.' });
    for (const a of inventoryAnomalies.filter((x) => x.anomaly === 'legacy_balance_does_not_reconcile')) {
        review.push({ code: 'inventory_reconciliation_decision', severity: 'decision', detail: `${a.flavorId}: ${a.detail}` });
    }
    /* ---------- settings ---------- */
    const st = backup.settings;
    const bowlMg = pctToMg(st['bowlG']) ?? 20_000;
    const overfill = typeof st['overfillPct'] === 'number' ? st['overfillPct'] : 0;
    const totalExact = (bowlMg * (100 + overfill)) / 100;
    if (!Number.isInteger(totalExact))
        review.push({ code: 'default_total_rounded', severity: 'info', detail: `${totalExact} mg rounded` });
    const settings = {
        schemaVersion: SCHEMA_VERSION,
        bowlCapacityMg: bowlMg,
        overfillPct: overfill,
        defaultGramsTotalMg: Math.round(totalExact),
        lowStockPct: typeof st['lowPct'] === 'number' ? st['lowPct'] : 15,
        defaultPackMg: pctToMg(st['defaultPackG']) ?? 200_000,
        sessionCapMin: capMin,
        legacyRaw: st,
    };
    /* ---------- layouts (for byte-exact rollback) ---------- */
    const passthroughTopLevel = {};
    for (const k of Object.keys(backup))
        if (!HANDLED_TOP_LEVEL.has(k))
            passthroughTopLevel[k] = backup[k];
    for (const k of Object.keys(passthroughTopLevel))
        if (k !== 'userFlavors' && k !== 'flavorEdits')
            review.push({ code: 'unknown_top_level_key_preserved', severity: 'info', detail: k });
    const legacyLayout = {
        topLevelOrder: Object.keys(backup),
        inventoryKeyOrder: Object.keys(invObj),
        ratingsKeyOrder: Object.keys(ratingsObj),
        editsKeyOrder: Object.keys(editsObj),
        raw: { schema: backup.schema, draft: backup.draft, meta: backup.meta, session: backup.session, passthroughTopLevel },
        orphanEdits,
    };
    if (backup.session)
        review.push({ code: 'active_session_in_backup', severity: 'info', detail: 'An unfinished v1 session is preserved verbatim; not converted.' });
    const catPassthrough = {};
    for (const k of Object.keys(catalog))
        if (!HANDLED_CATALOG.has(k))
            catPassthrough[k] = catalog[k];
    const catalogExtras = {
        families: catalog.families, familyMatrix: catalog.familyMatrix, bans: catalog.bans, banRules: catalog.banRules,
        duplicates: catalog.duplicates, laws: catalog.laws, topLevelOrder: Object.keys(catalog), passthroughTopLevel: catPassthrough,
    };
    /* ---------- markup scan (reported, never stripped) ---------- */
    const markup = findMarkupStrings(backup, '$backup');
    for (const p of markup)
        review.push({ code: 'suspicious_markup_in_text', severity: 'decision', detail: `${p} (stored verbatim; must be escaped on render)` });
    /* ---------- counts + log ---------- */
    const ratingRecords = Object.values(ratingsObj).reduce((s, v) => s + (Array.isArray(v) ? v.length : 0), 0);
    const preCounts = {
        catalogFlavors: catalog.flavors.length,
        userFlavors: userFlavors.length,
        bundledRecipes: catalog.recipes.length,
        userRecipes: backup.myRecipes.length,
        recipesTotal: catalog.recipes.length + backup.myRecipes.length,
        edits: Object.keys(editsObj).length,
        ratingKeys: Object.keys(ratingsObj).length,
        ratingRecords,
        sessions: sessionsRaw.length,
        inventoryRows: Object.keys(invObj).length,
        legacyPurchases: Object.values(invObj).reduce((s, r) => s + (Array.isArray(r?.purchases) ? r.purchases.length : 0), 0),
    };
    const postCounts = {
        flavors: flavors.length,
        recipes: recipes.length,
        recipeVersions: versions.length,
        assessments: assessments.length,
        sessions: sessions.length,
        inventoryEvents: inventoryEvents.length,
        claims: claims.length,
        sources: SEED_SOURCES.length,
        orphanEdits: Object.keys(orphanEdits).length,
    };
    const resolvedReview = applyOwnerDecisions(review, input.ownerDecisions ?? null);
    review.splice(0, review.length, ...resolvedReview);
    const blocking = review.filter((r) => r.severity === 'blocking');
    const migrationLog = {
        schemaVersion: SCHEMA_VERSION,
        migrationId: contentId('mig', { backupSha256, catalogSha256: input.catalog.htmlSha256, engine: ENGINE_VERSION }),
        engineVersion: ENGINE_VERSION,
        fromSchema: 1,
        toSchema: 2,
        ranAt: input.ranAt,
        inputs: { backupSha256, catalogSha256: input.catalog.htmlSha256, backupFileName: input.backupFileName },
        preCounts,
        postCounts,
        droppedFields: [], // filled by verifyRoundTrip(); a non-empty list makes the outcome `failed`
        outcome: blocking.length ? 'needs_review' : 'ready',
        reviewItems: review.filter((r) => r.severity !== 'info').map((r) => `${r.code}: ${r.detail}`),
        resolvedReviewItems: review.filter((r) => r.resolvedBy).map((r) => `${r.code}: ${r.detail.split(':')[0]} → ${r.resolvedBy.decisionId}:${r.resolvedBy.value}`),
    };
    // dedupe claim ids (must be unique — a collision means two sources mapped to one pointer)
    const claimIds = new Set();
    for (const c of claims) {
        if (claimIds.has(c.claimId))
            throw new Error(`claim id collision: ${c.claimId}`);
        claimIds.add(c.claimId);
    }
    const bundle = {
        format: 'mizaj-v2-bundle',
        schemaVersion: SCHEMA_VERSION,
        engineVersion: ENGINE_VERSION,
        createdAt: input.ranAt,
        source: { kind: 'v1_import', backupSha256, catalogSha256: input.catalog.htmlSha256, backupFileName: input.backupFileName },
        flavors,
        claims,
        sources: [...SEED_SOURCES],
        recipes,
        recipeVersions: versions,
        assessments,
        sessions,
        inventoryEvents,
        settings,
        legacyLayout,
        catalogExtras,
        migrationLog,
    };
    const stats = {
        asOf,
        asOfBasis: 'max timestamp found in sessions, ratings, edits, purchases and lastUsed (meta.lastBackup is written after export by v1 and is stale)',
        inventoryAnomalies,
        linkedSessions: linkedSessions.size,
        headItems: Object.fromEntries(headItems),
    };
    return { bundle, review, stats };
}
/** v1 stores grams with ≤1 decimal; convert to integer mg exactly, or null. */
function pctToMg(g) {
    if (typeof g !== 'number' || !Number.isFinite(g))
        return null;
    const mg = Math.round(g * 1000);
    return Math.abs(g * 1000 - mg) < 1e-6 ? mg : null;
}
