/** Home (05_UX "Default Home"): generate, from my stock, my supported recipes, draft, latest notes. */
import { h, icon } from "../dom.js";
import { countAr, defaultWizard, grams, inventoryRows, PRODUCTS_AR, recipeRows, RECIPES_AR, SUGGESTIONS_AR, wizardToRequest } from "../model.js";
import { generate } from "../../engine/generate.js";
import { DIAGNOSTIC_AR } from "../../storage/journal.js";
import { quickQuestionCard } from "./questions.js";
import { fmtDate, needData, safetyNote } from "./shared.js";
export const homeView = (app, root) => {
    if (!app.ctx || !app.bundle) {
        needData(root);
        return;
    }
    const ctx = app.ctx;
    const b = app.bundle;
    const input = h('input', { id: 'quick', type: 'text', class: 'input', placeholder: 'مثلاً: مانجو بارد بدون نعناع', autocomplete: 'off', maxlength: '200', enterkeyhint: 'go' });
    const quick = h('form', { class: 'quick', role: 'search', on: { submit: (e) => {
                e.preventDefault();
                // the quick box is self-contained: only the text decides the flavor; the wizard's last choices (cooling, sweetness, exclusions) are not carried over
                const saved = (app.prefs()['wizard'] ?? {});
                const ws = { ...defaultWizard(ctx, b.settings.defaultGramsTotalMg), stockOnly: saved.stockOnly ?? true, freeText: input.value };
                const parsed = wizardToRequest(ws, ctx);
                app.last = { wizard: ws, parsed, response: generate(parsed.request, ctx), at: app.now() };
                location.hash = '#/results';
            } } }, h('label', { for: 'quick', class: 'quick-label' }, 'اكتب ما تريد'), h('div', { class: 'quick-row' }, input, h('button', { type: 'submit', class: 'btn btn-primary' }, 'اقترح')), h('p', { class: 'hint' }, 'يُفهم الطلب بقاموس ثابت على جهازك؛ لا يحتاج اتصالاً ولا ذكاءً اصطناعياً.'));
    const supported = recipeRows(b, ctx).filter((r) => r.support > 0 && r.support >= r.caution).length;
    const low = inventoryRows(b, ctx).filter((r) => r.low).length;
    const notes = b.assessments.filter((a) => a.provenance === 'user_observation').sort((x, y) => String(y.recordedAt).localeCompare(String(x.recordedAt))).slice(0, 3);
    const draft = app.last;
    const card = (href, title, sub, ic, primary = false) => h('a', { class: `home-card${primary ? ' home-card-primary' : ''}`, href }, icon(ic), h('span', { class: 'home-card-title' }, title), h('span', { class: 'home-card-sub' }, sub));
    root.append(h('div', { class: 'page-head' }, h('h1', { class: 'page-title', tabindex: '-1' }, 'ماذا تريد اليوم؟')), quick, h('div', { class: 'home-grid' }, card('#/create', 'ولّد مكس', 'ثلاث خطوات: الهدف، التفضيل، النمط', 'create', true), card('#/create?stock=1', 'من الموجود عندي', 'اقتراحات من مخزونك فقط', 'inventory'), card('#/recipes?f=supported', 'وصفاتي المسجّلة', `${countAr(supported, RECIPES_AR)} تقييماتها المرتفعة أكثر من المنخفضة`, 'recipes'), draft ? card('#/results', 'آخر اقتراحات', `${countAr(draft.response.candidates.length, SUGGESTIONS_AR)} · ${fmtDate(draft.at)}`, 'compare') : null, low ? card('#/inventory', 'مخزون منخفض', `${countAr(low, PRODUCTS_AR)} تحت حد التنبيه`, 'warn') : null, app.pack ? null : card('#/data', 'أضف حزمة المعرفة', 'لعرض مصادر أوصاف المنتجات', 'info')), quickQuestionCard(app), h('section', { class: 'section' }, h('h2', { class: 'section-title' }, 'آخر ملاحظاتك في v2'), notes.length
        ? h('ul', { class: 'notes' }, notes.map((a) => {
            const r = b.recipes.find((x) => x.recipeId === a.recipeId);
            return h('li', null, h('a', { href: `#/recipe/${encodeURIComponent(a.recipeId)}` }, h('bdi', null, r?.name ?? a.recipeId)), ' · ', a.rating !== null ? `${a.rating}/5` : 'بلا تقييم', a.descriptors.length ? ` · ${a.descriptors.map((d) => DIAGNOSTIC_AR[d] ?? d).join('، ')}` : '', a.note ? h('span', { class: 'note-text' }, ' — ', h('bdi', null, a.note)) : null, h('span', { class: 'muted' }, ` · ${fmtDate(a.recordedAt)}`));
        }))
        : h('p', { class: 'muted' }, 'لم تسجّل ملاحظات في v2 بعد. التقييم اختياري؛ الاقتراحات تعمل بدونه.')), h('p', { class: 'muted small' }, `الكمية الافتراضية للحجر: ${grams(b.settings.defaultGramsTotalMg)} (من إعداداتك القديمة).`), safetyNote());
};
