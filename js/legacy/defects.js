/**
 * Register of defects found by reading the legacy app source (index.html, sha256
 * 74545e09…). Every entry pins a line number AND a snippet that must appear on
 * that line; tests/regression/defects.test.ts fails if the reference drifts, so
 * the report can never cite a line that does not say what we claim.
 *
 * Legacy code is NOT modified (rule: do not break legacy UI). `v2Remedy` says
 * where the v2 core removes the defect by construction.
 */
export const LEGACY_DEFECTS = [
    {
        id: 'D-01', severity: 'critical', area: 'data_loss', line: 1078,
        snippet: 'if (s.schema !== SCHEMA) return freshState();',
        titleAr: 'استيراد أي ملف بـschema≠1 يُرجع حالة فارغة ثم يحفظها فوق بيانات المستخدم',
        impact: 'importBackup (L1225) assigns freshState() over STATE and saves → full loss of inventory, sessions and ratings if a non-v1 file is imported.',
        v2Remedy: 'v2 bundle is JSON Lines (not a single JSON value) so legacy JSON.parse throws and importBackup aborts without change (src/migration/bundle.ts; verified in tests/browser).',
    },
    {
        id: 'D-02', severity: 'high', area: 'inventory', line: 1204,
        snippet: 'i.remG = i.packG;',
        titleAr: 'شراء علبة جديدة يجعل المتبقي = حجم العبوة بدل إضافته',
        impact: 'Remaining grams before the purchase are discarded; 8 of 89 inventory rows no longer reconcile (rem+used ≠ pack+purchases).',
        v2Remedy: 'Ledger purchase event adds deltaMg (src/domain/inventory.ts recordPurchase).',
    },
    {
        id: 'D-03', severity: 'high', area: 'inventory', line: 4238,
        snippet: 'i.usedG = Math.max(0, pack - i.remG);',
        titleAr: 'التصحيح اليدوي للمخزون يعيد كتابة إجمالي الاستهلاك',
        impact: 'Historic consumption is overwritten by pack − remaining; usage statistics become fiction after any correction.',
        v2Remedy: 'Correction event re-bases availableMg only; consumedSinceOpeningMg untouched (applyEvent case "correction").',
    },
    {
        id: 'D-04', severity: 'medium', area: 'inventory', line: 1191,
        snippet: 'i.remG = Math.max(0, +(i.remG - grams).toFixed(1));',
        titleAr: 'الخصم يتوقف عند صفر بصمت ويُقرّب لعُشر غرام',
        impact: 'Overdraw is hidden; float rounding accumulates drift.',
        v2Remedy: 'Integer mg; overdraw rejected or recorded as an explicit shortfall anomaly.',
    },
    {
        id: 'D-05', severity: 'high', area: 'inventory', line: 2850,
        snippet: 'if (ses && r) consume(recipeItems(r).map(i => ({ flavorId: i.f.id, grams: gramsFor(i.pct) })));',
        titleAr: 'تقييم جلسة على وصفة معدّلة يخصم مكونات النسخة الأصلية لا المعدّلة',
        impact: 'recipeItems() ignores edits (liveItems() is used elsewhere, e.g. L4083) → wrong flavors deducted; skipping the rating deducts nothing.',
        v2Remedy: 'Consume events reference an exact recipe_version_id (InventoryEvent.recipeVersionId).',
    },
    {
        id: 'D-06', severity: 'high', area: 'versioning', line: 2992,
        snippet: 'STATE.edits[key] = { ts: Date.now(), reason, items: items.map(i => ({ id: i.f.id, pct: i.pct })) };',
        titleAr: 'التعديل يستبدل الوصفة في مكانها: آخر تعديل فقط يُحفظ والتقييمات مشتركة بين كل النسخ',
        impact: 'Intermediate versions are lost; all ratings stay on one key regardless of formula (rating leakage across versions).',
        v2Remedy: 'Immutable content-addressed recipe_versions with parentVersionId; ratings carry attribution status (src/migration/attribution.ts).',
    },
    {
        id: 'D-07', severity: 'medium', area: 'versioning', line: 2985,
        snippet: 'delete STATE.edits[key]; save(true); openRecipe(key); renderRecipes();',
        titleAr: '«أعدها للأصل» يحذف سجل التعديل نهائياً',
        impact: 'After a revert, v1 cannot tell that an edited period ever existed, so even un-edited recipes have uncertain rating attribution.',
        v2Remedy: 'Versions are never deleted; reverting = new head pointer to an existing version.',
    },
    {
        id: 'D-08', severity: 'medium', area: 'versioning', line: 4031,
        snippet: "x.ts = d ? new Date(d + 'T12:00:00').getTime() : x.ts;",
        titleAr: 'تاريخ التقييم قابل للتعديل ويُعاد ضبطه على الظهر بدقة يوم',
        impact: 'Timestamp ordering against edits is unreliable for edited ratings; detected as date_only_presumed precision.',
        v2Remedy: 'Native assessments bind to recipe_version_id at write time; legacy ones keep timestampPrecision.',
    },
    {
        id: 'D-09', severity: 'medium', area: 'data_loss', line: 4076,
        snippet: 'STATE.sessions.push({ key, name: r.name, start: ts, end: ts, minutes: 90,',
        titleAr: 'الجلسة اليدوية تُسجَّل بمدة ثابتة 90 دقيقة وبداية = نهاية',
        impact: '34 sessions carry an invented duration; duration statistics mix measured and default values.',
        v2Remedy: 'durationSource = legacy_manual_entry + anomaly flag; never treated as a measurement.',
    },
    {
        id: 'D-10', severity: 'medium', area: 'data_loss', line: 4024,
        snippet: 'if (si > -1) STATE.sessions.splice(si, 1);',
        titleAr: 'حذف تقييم يحذف معه الجلسة المقترنة',
        impact: 'Deleting a rating silently destroys a session record matched only by a ±60 s heuristic.',
        v2Remedy: 'v2 storage has no hard delete of observations in P0 (append-only records).',
    },
    {
        id: 'D-11', severity: 'high', area: 'rules', line: 1322,
        snippet: 'BUILD.picks.forEach(p => { score = Math.min(score, DATA.familyMatrix[p.f.family][cand.family]); });',
        titleAr: 'نتيجة التوافق تعتمد على ترتيب الاختيار لأن المصفوفة غير متناظرة',
        impact: 'cooling→floral = 2 but floral→cooling = 5: same two flavors score differently depending on which was picked first.',
        v2Remedy: 'RelationshipIndex looks up unordered pairs; the asymmetric legacy pair is stored as a conflicting, excluded claim.',
    },
    {
        id: 'D-12', severity: 'high', area: 'generator', line: 3751,
        snippet: 'let roll = Math.random() * w.reduce((a, b) => a + b, 0);',
        titleAr: 'المولّد القديم عشوائي غير قابل للإعادة',
        impact: 'Same request → different outputs; results cannot be tested or explained.',
        v2Remedy: 'P2 engine is deterministic (contract in src/engine/api.ts); P0 ships no generator.',
    },
    {
        id: 'D-13', severity: 'medium', area: 'generator', line: 3763,
        snippet: "add(best(f => f.roles.includes('main') || f.roles.includes('base')), 35);",
        titleAr: 'هيكل إجباري من أربعة أدوار بنسب ثابتة 35/25/15/15',
        impact: 'Every generated mix is forced into a 4-role skeleton regardless of evidence.',
        v2Remedy: 'No forced ingredient count (CORE §8); 2-product recipes are first-class.',
    },
    {
        id: 'D-14', severity: 'medium', area: 'generator', line: 3782,
        snippet: 'for (let tries = 0; sum() < 100 && tries < 4; tries++) {',
        titleAr: 'إكمال 100% بإضافة نكهات حشو',
        impact: 'Fills the remainder with whatever passes filters — the “arbitrary filler” the spec forbids.',
        v2Remedy: 'Basis-point apportionment over chosen ingredients only (src/domain/basisPoints.ts apportionBp).',
    },
    {
        id: 'D-15', severity: 'high', area: 'versioning', line: 3593,
        snippet: 'const items = liveItems(r);',
        titleAr: 'نموذج التعلّم يطبّق كل التقييمات (بما فيها السابقة للتعديل) على مكونات النسخة الحالية',
        impact: 'Pre-edit ratings are credited to the edited formula and to every pair inside it (L3601-3602).',
        v2Remedy: 'Evidence helpers only count assessments whose attribution matches the exact version.',
    },
    {
        id: 'D-16', severity: 'high', area: 'safety_language', line: 3717,
        snippet: "const coals = minC <= 1 ? 'فحمتان ونصف' : minC <= 2 ? 'ثلاث فحمات' : 'ثلاث فحمات ونصف';",
        titleAr: 'المولّد يوصي بعدد فحمات مشتق من «سقف حراري» غير موثق',
        impact: 'Coal counts presented as derived facts (rule 12 forbids heat/coal recommendations).',
        v2Remedy: 'Legacy setup/heat texts migrate as safetySensitive claims with usage=excluded.',
    },
    {
        id: 'D-17', severity: 'high', area: 'security', line: 2908,
        snippet: '<div class="sh-sub"><bdi>${base.name}</bdi><span class="sub-badge">تبقى نفس البطاقة</span></div>',
        titleAr: 'أسماء الوصفات والنكهات تُدرج في innerHTML بلا تهريب (XSS)',
        impact: 'A crafted recipe/flavor name inside an imported backup executes in the app origin. 44 innerHTML sinks, no escape helper.',
        v2Remedy: 'escapeHtml() for all v2 rendering; import reports strings containing markup (findMarkupStrings).',
    },
    {
        id: 'D-18', severity: 'medium', area: 'security', line: 1225,
        snippet: 'Object.assign(STATE, migrate(JSON.parse(r.result)));',
        titleAr: 'الاستيراد بلا تحقق من البنية أو الحجم أو مفاتيح __proto__',
        impact: 'Any JSON replaces all state; no preview, no size limit, prototype keys accepted.',
        v2Remedy: 'safeJsonParse (size limit, forbidden keys) + shape assertions + preview report before commit.',
    },
    {
        id: 'D-19', severity: 'medium', area: 'versioning', line: 2988,
        snippet: "document.getElementById('vSave').onclick = () => {",
        titleAr: 'حفظ التعديل لا يتحقق من أن المجموع 100%',
        impact: 'Edited and newly saved recipes (L1796 shows the same warning-only path) can be stored with sum ≠ 100.',
        v2Remedy: 'validateIngredients requires sum = 10 000 bp; legacy invalid formulas are quarantined as invalid_legacy, never normalised silently.',
    },
    {
        id: 'D-20', severity: 'low', area: 'pwa', line: 8,
        snippet: '<link rel="manifest" href="manifest.webmanifest">',
        titleAr: 'ملفا manifest.webmanifest و sw.js مستدعيان لكنهما غير موجودين في الحزمة',
        impact: 'Offline/PWA behaviour of the legacy app cannot be reproduced from the handoff package (sw.js registered at L4443).',
        v2Remedy: 'Documented; P3 must ship its own manifest + service worker and an offline e2e test.',
    },
];
