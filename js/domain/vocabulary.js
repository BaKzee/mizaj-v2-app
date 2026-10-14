/**
 * Language guards (CORE §13, SECURITY "Health + language").
 *
 * 1. `findForbiddenClaims` — v2-authored text must not promise taste or safety.
 * 2. `isSafetySensitive` — legacy text that talks about heat / coal / temperature
 *    is tagged so it can be stored for audit but never presented as advice.
 */
/** Decision vocabulary allowed for v2 outputs (CORE §13). */
export const ALLOWED_DECISIONS = [
    'valid',
    'invalid',
    'reference_supported',
    'adapted_with_uncertainty',
    'exploratory',
    'insufficient_evidence',
    'unknown',
];
const FORBIDDEN = [
    { id: 'guarantee_en', re: /\bguarantee(d|s)?\b/i },
    { id: 'guarantee_ar', re: /مضمون|مضمونة|نضمن|ضمان\s+(?:الطعم|النجاح|المذاق)/ },
    { id: 'scientifically_perfect', re: /scientifically[-\s]?perfect/i },
    { id: 'success_percent_en', re: /\d+(?:\.\d+)?\s*%\s*(?:success|chance of success|probability of success)/i },
    { id: 'success_percent_ar', re: /(?:نسبة|احتمال)\s+(?:ال)?نجاح|نجاح\s*\d+\s*%|\d+\s*%\s*نجاح/ },
    { id: 'safe_heat_en', re: /\bsafe[-\s]?(?:temperature|heat|smoking|coal|charcoal)\b/i },
    { id: 'safe_heat_ar', re: /حرارة\s+آمنة|تدخين\s+آمن|فحم\s+آمن|آمن\s+صحياً/ },
    { id: 'compat_percent', re: /توافق\s*\d+\s*%|\d+\s*%\s*(?:compatib|توافق)/i },
];
/**
 * Scan v2-authored text. Negations are not parsed — authors should phrase limits
 * without the forbidden token (e.g. "no taste promise" rather than "not guaranteed")
 * so the guard stays simple and strict.
 */
export function findForbiddenClaims(text) {
    const hits = [];
    for (const p of FORBIDDEN) {
        const m = text.match(p.re);
        if (m)
            hits.push({ id: p.id, match: m[0] });
    }
    return hits;
}
const SAFETY_KEYWORDS = /حرار|فحم|فحمة|فحمات|فحمتان|سقف\s*حراري|تسخين|احتراق|\bheat\b|\bcoals?\b|charcoal|temperature/i;
/**
 * Russian and Hebrew heat/coal wording (research excerpts are mostly Russian). JS `\b`
 * is ASCII-only, so word edges use Unicode letter look-arounds. Over-matching only
 * hides a text from advice (safe direction); under-matching is the risk.
 */
const SAFETY_KEYWORDS_RU_HE = /(?<!\p{L})(?:жар(?:а|у|ом|е|ко|кий|кая|кое)?|нагрев\p{L}*|перегрев\p{L}*|температур\p{L}*|угл(?:и|ей|я|ем|ям|ями|ях)|угол(?:ь|ек|ька|ьки)|уголь\p{L}*|калауд\p{L}*|גחלים|גחלת|פחם|טמפרטור\p{L}*)(?!\p{L})/iu;
export function isSafetySensitive(text) {
    return typeof text === 'string' && (SAFETY_KEYWORDS.test(text) || SAFETY_KEYWORDS_RU_HE.test(text));
}
