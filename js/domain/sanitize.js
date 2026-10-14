/**
 * Input hardening (SECURITY §3–§5).
 *
 * Policy: store user text VERBATIM (no data loss), escape on OUTPUT. Imports are
 * parsed with JSON.parse only (never eval / Function), with a size limit and a
 * rejection of prototype-pollution keys anywhere in the tree.
 */
export const DEFAULT_MAX_IMPORT_BYTES = 20 * 1024 * 1024; // 20 MB: the real backup is ~174 KB
export const MAX_DEPTH = 64;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export class UnsafeInputError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'UnsafeInputError';
        this.code = code;
    }
}
/** Escape for HTML text and double/single-quoted attribute contexts. */
export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/`/g, '&#96;');
}
function byteLength(text) {
    return new TextEncoder().encode(text).length;
}
function assertSafeTree(value, depth, path) {
    if (depth > MAX_DEPTH)
        throw new UnsafeInputError('too_deep', `JSON nesting exceeds ${MAX_DEPTH} at ${path}`);
    if (value === null || typeof value !== 'object')
        return;
    if (Array.isArray(value)) {
        value.forEach((v, i) => assertSafeTree(v, depth + 1, `${path}[${i}]`));
        return;
    }
    for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key))
            throw new UnsafeInputError('forbidden_key', `forbidden key "${key}" at ${path}`);
        assertSafeTree(value[key], depth + 1, `${path}.${key}`);
    }
}
/** JSON.parse with size limit, BOM tolerance and prototype-pollution rejection. */
export function safeJsonParse(text, opts = {}) {
    if (typeof text !== 'string')
        throw new UnsafeInputError('not_text', 'input is not text');
    const max = opts.maxBytes ?? DEFAULT_MAX_IMPORT_BYTES;
    if (byteLength(text) > max)
        throw new UnsafeInputError('too_large', `input exceeds ${max} bytes`);
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch (e) {
        throw new UnsafeInputError('invalid_json', `not valid JSON: ${e.message}`);
    }
    assertSafeTree(parsed, 0, '$');
    return parsed;
}
const MARKUP_PATTERNS = [/<\s*\/?\s*[a-z!]/i, /\bon[a-z]+\s*=/i, /javascript\s*:/i, /data\s*:\s*text\/html/i];
/** True when a string looks like it carries HTML/script. Reported, never silently stripped. */
export function containsMarkup(text) {
    if (typeof text !== 'string')
        return false;
    return MARKUP_PATTERNS.some((re) => re.test(text));
}
/** Walk a parsed object and list JSON paths of strings that contain markup. */
export function findMarkupStrings(value, path = '$', out = []) {
    if (typeof value === 'string') {
        if (containsMarkup(value))
            out.push(path);
    }
    else if (Array.isArray(value)) {
        value.forEach((v, i) => findMarkupStrings(v, `${path}[${i}]`, out));
    }
    else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value))
            findMarkupStrings(v, `${path}.${k}`, out);
    }
    return out;
}
