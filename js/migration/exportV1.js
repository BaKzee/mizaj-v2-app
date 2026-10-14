import { sha256Hex } from "../domain/hash.js";
export class ExportError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'ExportError';
        this.code = code;
    }
}
function sortedByIndex(xs) {
    return [...xs].sort((a, b) => (a.legacyIndex ?? 0) - (b.legacyIndex ?? 0));
}
export function buildBackupV1Object(bundle) {
    const native = bundle.assessments.filter((a) => a.provenance !== 'legacy_import').length
        + bundle.recipes.filter((r) => r.origin === 'v2_native').length
        + bundle.inventoryEvents.filter((e) => e.type !== 'opening_snapshot').length
        + bundle.sessions.filter((s) => !s.legacyRaw).length;
    if (native > 0) {
        throw new ExportError('native_records_present', `${native} v2-native record(s) have no v1 shape yet; write-back is scheduled for P3 (feature-flag coexistence).`);
    }
    const L = bundle.legacyLayout;
    const out = {};
    for (const key of L.topLevelOrder) {
        switch (key) {
            case 'schema':
                out[key] = L.raw.schema;
                break;
            case 'settings':
                out[key] = bundle.settings.legacyRaw;
                break;
            case 'inventory': {
                const byFlavor = new Map(bundle.inventoryEvents.filter((e) => e.type === 'opening_snapshot').map((e) => [e.flavorId, e.legacyRaw]));
                const inv = {};
                for (const fid of L.inventoryKeyOrder) {
                    if (!byFlavor.has(fid))
                        throw new ExportError('missing_inventory_row', fid);
                    inv[fid] = byFlavor.get(fid);
                }
                out[key] = inv;
                break;
            }
            case 'draft':
                out[key] = L.raw.draft;
                break;
            case 'sessions':
                out[key] = sortedByIndex(bundle.sessions).map((s) => s.legacyRaw);
                break;
            case 'myRecipes':
                out[key] = sortedByIndex(bundle.recipes.filter((r) => r.legacyCollection === 'backup.myRecipes')).map((r) => r.legacyRaw);
                break;
            case 'meta':
                out[key] = L.raw.meta;
                break;
            case 'ratings': {
                const r = {};
                for (const k of L.ratingsKeyOrder) {
                    r[k] = sortedByIndex(bundle.assessments.filter((a) => a.legacyKey === k)).map((a) => a.legacyRaw);
                }
                out[key] = r;
                break;
            }
            case 'edits': {
                const e = {};
                const byKey = new Map();
                const recipeByVersion = new Map();
                for (const rec of bundle.recipes)
                    for (const v of rec.versionIds)
                        recipeByVersion.set(v, rec.legacyKey);
                for (const v of bundle.recipeVersions)
                    if (v.legacyEditRaw)
                        byKey.set(recipeByVersion.get(v.versionId) ?? '', v.legacyEditRaw);
                for (const k of L.editsKeyOrder) {
                    if (byKey.has(k))
                        e[k] = byKey.get(k);
                    else if (k in L.orphanEdits)
                        e[k] = L.orphanEdits[k];
                    else
                        throw new ExportError('missing_edit', k);
                }
                out[key] = e;
                break;
            }
            case 'session':
                out[key] = L.raw.session;
                break;
            default:
                if (!(key in L.raw.passthroughTopLevel))
                    throw new ExportError('missing_section', key);
                out[key] = L.raw.passthroughTopLevel[key];
        }
    }
    return out;
}
/** Serialise exactly as v1 exportBackup() does. */
export function exportBackupV1Text(bundle) {
    return JSON.stringify(buildBackupV1Object(bundle), null, 1);
}
/** Rebuild the v1 catalog object (DATA) from v2 records; compared semantically (the HTML itself is never rewritten). */
export function buildCatalogV1Object(bundle) {
    const C = bundle.catalogExtras;
    const out = {};
    for (const key of C.topLevelOrder) {
        switch (key) {
            case 'flavors':
                out[key] = sortedByIndex(bundle.flavors.filter((f) => f.legacyCollection === 'catalog.flavors')).map((f) => f.legacy);
                break;
            case 'recipes':
                out[key] = sortedByIndex(bundle.recipes.filter((r) => r.legacyCollection === 'catalog.recipes')).map((r) => r.legacyRaw);
                break;
            case 'families':
                out[key] = C.families;
                break;
            case 'familyMatrix':
                out[key] = C.familyMatrix;
                break;
            case 'bans':
                out[key] = C.bans;
                break;
            case 'banRules':
                out[key] = C.banRules;
                break;
            case 'duplicates':
                out[key] = C.duplicates;
                break;
            case 'laws':
                out[key] = C.laws;
                break;
            default: out[key] = C.passthroughTopLevel[key];
        }
    }
    return out;
}
function deepDiffPaths(a, b, path, out, limit = 50) {
    if (out.length >= limit)
        return;
    if (a === b)
        return;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
        out.push(path);
        return;
    }
    if (Array.isArray(a) !== Array.isArray(b)) {
        out.push(path);
        return;
    }
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    for (const k of new Set([...ka, ...kb]))
        deepDiffPaths(a[k], b[k], `${path}.${k}`, out, limit);
}
export function verifyRoundTrip(bundle, originalBackupText, originalCatalog) {
    const exported = exportBackupV1Text(bundle);
    const dropped = [];
    const byteExact = exported === originalBackupText;
    if (!byteExact)
        deepDiffPaths(JSON.parse(originalBackupText), JSON.parse(exported), '$backup', dropped);
    const cat = buildCatalogV1Object(bundle);
    const catDiff = [];
    deepDiffPaths(originalCatalog, cat, '$catalog', catDiff);
    return {
        backupByteExact: byteExact,
        originalSha256: sha256Hex(originalBackupText),
        exportedSha256: sha256Hex(exported),
        catalogDeepEqual: catDiff.length === 0,
        droppedFields: [...dropped, ...catDiff],
    };
}
