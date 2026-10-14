/**
 * Read-only access to the legacy files. Data is parsed with JSON.parse (via
 * safeJsonParse) — the legacy HTML is NEVER executed.
 */
import { safeJsonParse, UnsafeInputError } from "../domain/sanitize.js";
import { sha256Hex } from "../domain/hash.js";
const DATA_PREFIX = 'const DATA = ';
export function extractCatalog(html) {
    const lines = html.split('\n');
    const idx = lines.findIndex((l) => l.startsWith(DATA_PREFIX));
    if (idx < 0)
        throw new UnsafeInputError('catalog_not_found', 'cannot find `const DATA = ` line in legacy HTML');
    const line = lines[idx].replace(/\r$/, '');
    let body = line.slice(DATA_PREFIX.length);
    if (body.endsWith(';'))
        body = body.slice(0, -1);
    const parsed = safeJsonParse(body, { maxBytes: 50 * 1024 * 1024 });
    assertCatalogShape(parsed);
    return { catalog: parsed, lineNumber: idx + 1, lineSha256: sha256Hex(line), htmlSha256: sha256Hex(html) };
}
function assertCatalogShape(x) {
    const o = x;
    if (!o || typeof o !== 'object')
        throw new UnsafeInputError('bad_catalog', 'catalog is not an object');
    for (const k of ['flavors', 'recipes', 'families', 'bans', 'banRules', 'duplicates', 'laws']) {
        if (!Array.isArray(o[k]))
            throw new UnsafeInputError('bad_catalog', `catalog.${k} must be an array`);
    }
    if (!o['familyMatrix'] || typeof o['familyMatrix'] !== 'object')
        throw new UnsafeInputError('bad_catalog', 'catalog.familyMatrix missing');
    for (const f of o['flavors']) {
        const ff = f;
        if (typeof ff?.['id'] !== 'string' || typeof ff['name'] !== 'string')
            throw new UnsafeInputError('bad_catalog', 'flavor without id/name');
    }
}
export function parseBackup(text) {
    const parsed = safeJsonParse(text);
    assertBackupShape(parsed);
    return parsed;
}
function assertBackupShape(x) {
    const o = x;
    if (!o || typeof o !== 'object' || Array.isArray(o))
        throw new UnsafeInputError('bad_backup', 'backup is not an object');
    if (o['schema'] !== 1)
        throw new UnsafeInputError('unsupported_schema', `expected v1 backup (schema 1), got ${JSON.stringify(o['schema'])}`);
    const req = [
        ['settings', 'object'], ['inventory', 'object'], ['sessions', 'array'], ['myRecipes', 'array'], ['meta', 'object'],
    ];
    for (const [k, t] of req) {
        const v = o[k];
        const ok = t === 'array' ? Array.isArray(v) : v !== null && typeof v === 'object' && !Array.isArray(v);
        if (!ok)
            throw new UnsafeInputError('bad_backup', `backup.${k} must be ${t}`);
    }
    for (const k of ['ratings', 'edits']) {
        const v = o[k];
        if (v !== undefined && (v === null || typeof v !== 'object' || Array.isArray(v)))
            throw new UnsafeInputError('bad_backup', `backup.${k} must be an object`);
    }
}
/** v1 RKEY (index.html L1861): user recipes by id; bundled by `bs<special>` or `b<no>`. */
export function legacyRecipeKey(r) {
    if (r.source === 'mine') {
        if (typeof r.id !== 'string' || !r.id)
            throw new UnsafeInputError('bad_recipe', 'user recipe without id');
        return r.id;
    }
    if (r.special)
        return `bs${r.special}`;
    if (typeof r.no !== 'number')
        throw new UnsafeInputError('bad_recipe', `bundled recipe "${r.name}" without number`);
    return `b${r.no}`;
}
export function recipeIdFromLegacyKey(key) {
    return `rcp_${key}`;
}
