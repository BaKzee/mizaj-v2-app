/**
 * Where the app runs.
 *  - hosted: the multi-file build in `v2/` next to the legacy `index.html` (same site);
 *  - single: ONE self-contained HTML file opened directly on the phone (file://), next to
 *    the legacy `index.html` file. No service worker, no fetch; data comes from files or from
 *    data embedded in a PRIVATE build.
 */
export function isSingleFile() {
    return typeof document !== 'undefined' && document.documentElement.dataset['mode'] === 'single';
}
/** The legacy app: same folder for the single file, parent folder for the hosted `v2/`. */
export function legacyHref() {
    return isSingleFile() ? 'index.html' : '../index.html';
}
let cached;
/** Data embedded by the private single-file build, or null. Read once, lazily. */
export function readEmbedded() {
    if (cached !== undefined)
        return cached;
    cached = null;
    if (typeof document === 'undefined')
        return cached;
    const el = document.getElementById('mizaj-embedded');
    if (!el?.textContent)
        return cached;
    try {
        const v = JSON.parse(el.textContent);
        cached = {
            backupText: typeof v.backupText === 'string' ? v.backupText : null,
            legacyHtml: typeof v.legacyHtml === 'string' ? v.legacyHtml : null,
            ownerDecisionsText: typeof v.ownerDecisionsText === 'string' ? v.ownerDecisionsText : null,
            preparedAt: typeof v.preparedAt === 'string' ? v.preparedAt : '',
        };
    }
    catch {
        cached = null;
    }
    return cached;
}
