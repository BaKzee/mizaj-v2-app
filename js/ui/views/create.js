/** 3-step generator (05_UX): 1 goal → 2 preferences → 3 output mode → 1–3 candidates. */
import { append, clear, h } from "../dom.js";
import { defaultWizard, GOAL_GROUPS, MODE_AR, QUALITY_AR, requestSummaryAr, specificGoalChips, wizardToRequest } from "../model.js";
import { generate } from "../../engine/generate.js";
import { GENERATION_MODES } from "../../engine/api.js";
import { mgToGramString } from "../../domain/grams.js";
import { needData, pageHead } from "./shared.js";
let step = 1;
export const createView = (app, root, params) => {
    if (!app.ctx || !app.bundle) {
        needData(root);
        return;
    }
    const ctx = app.ctx;
    const saved = (app.prefs()['wizard'] ?? {});
    const ws = { ...defaultWizard(ctx, app.bundle.settings.defaultGramsTotalMg), ...saved };
    ws.excludedIds = (ws.excludedIds ?? []).filter((id) => ctx.products.has(id));
    if (params.get('stock') === '1')
        ws.stockOnly = true;
    if (params.get('new') === '1')
        step = 1;
    const persist = () => app.setPref('wizard', { ...ws, freeText: '' });
    const body = h('div', { class: 'wizard-body' });
    const bar = h('div', { class: 'actionbar' });
    const steps = h('ol', { class: 'steps', 'aria-label': 'خطوات التوليد' });
    const chip = (label, pressed, onToggle, extra) => h('button', { type: 'button', class: `chip${pressed ? ' chip-on' : ''}`, 'aria-pressed': String(pressed), on: { click: () => { onToggle(); render(); } } }, label, extra ? h('span', { class: 'chip-count' }, extra) : null);
    const segmented = (name, label, options, value, set) => h('fieldset', { class: 'seg' }, h('legend', null, label), h('div', { class: 'seg-row' }, options.map(([v, l], i) => {
        const id = `${name}-${i}`;
        return h('span', { class: 'seg-opt' }, h('input', { type: 'radio', name, id, checked: v === value, on: { change: () => { set(v); render(); } } }), h('label', { for: id }, l));
    })));
    function step1() {
        const free = h('textarea', { id: 'free', class: 'input', rows: '2', maxlength: '200', placeholder: 'صِف بكلماتك (اختياري): مثلاً «خوخ وتوت بدون نعناع»' });
        free.value = ws.freeText;
        const preview = h('div', { class: 'interp', 'aria-live': 'polite' });
        const showPreview = () => {
            clear(preview);
            if (!ws.freeText.trim())
                return;
            const p = wizardToRequest(ws, ctx);
            append(preview, p.understood.length ? h('p', null, 'فهمتُ: ', p.understood.map((u, i) => [i ? '، ' : '', h('bdi', null, `«${u.text}»`), ` → ${u.meaning}`])) : null, p.ignored.length ? h('p', { class: 'warn-text' }, 'لم أفهم: ', p.ignored.map((w, i) => [i ? '، ' : '', h('bdi', null, w)]), ' — لن أخمّن معناها.') : null);
        };
        free.addEventListener('input', () => { ws.freeText = free.value; showPreview(); });
        showPreview();
        const toggleGoal = (id) => { ws.goals = ws.goals.includes(id) ? ws.goals.filter((x) => x !== id) : [...ws.goals, id]; persist(); };
        return [
            h('h2', { class: 'section-title' }, 'الهدف'),
            h('div', { class: 'chips', role: 'group', 'aria-label': 'الطابع العام' }, GOAL_GROUPS.map((g) => chip(g.ar, ws.goals.includes(g.id), () => toggleGoal(g.id))), chip('مبتكر', ws.novel, () => { ws.novel = !ws.novel; persist(); })),
            h('h3', { class: 'sub-title' }, 'نكهات محددة من منتجاتك'),
            h('div', { class: 'chips', role: 'group', 'aria-label': 'نكهات محددة' }, specificGoalChips(ctx).map((c) => chip(c.ar, ws.goals.includes(c.id), () => toggleGoal(c.id), String(c.products)))),
            h('label', { for: 'free', class: 'field-label' }, 'وصف حر'),
            free, preview,
            ws.novel ? h('p', { class: 'hint' }, '«مبتكر» يسمح بفرضية جديدة موسومة «غير مجرّبة» إن لم يكفِ الدليل.') : null,
        ];
    }
    function step2() {
        const search = h('input', { id: 'excl', type: 'search', class: 'input', placeholder: 'ابحث عن منتج لاستبعاده', autocomplete: 'off' });
        const results = h('div', { class: 'pick-list' });
        const showResults = () => {
            clear(results);
            const q = search.value.trim().toLowerCase();
            if (!q)
                return;
            const hits = [...ctx.products.values()].filter((p) => !ws.excludedIds.includes(p.id) && (p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q))).slice(0, 8);
            results.append(...hits.map((p) => h('button', { type: 'button', class: 'pick', on: { click: () => { ws.excludedIds = [...ws.excludedIds, p.id]; persist(); render(); } } }, h('bdi', null, p.name), h('span', { class: 'brand' }, ` · ${p.brand}`))));
            if (!hits.length)
                results.append(h('p', { class: 'muted' }, 'لا نتائج'));
        };
        search.addEventListener('input', showResults);
        const gramsInput = h('input', { id: 'grams', type: 'number', class: 'input input-num', inputmode: 'decimal', min: '1', max: '200', step: '0.1', value: mgToGramString(ws.gramsTotalMg, 1) });
        gramsInput.addEventListener('change', () => {
            const mg = Math.round(Number(gramsInput.value) * 1000);
            if (Number.isSafeInteger(mg) && mg >= 1000 && mg <= 200_000) {
                ws.gramsTotalMg = mg;
                persist();
            }
            else
                gramsInput.value = mgToGramString(ws.gramsTotalMg, 1);
        });
        return [
            h('h2', { class: 'section-title' }, 'التفضيل'),
            segmented('cooling', 'التبريد', [[null, 'لا يهم'], ['wanted', 'أريده'], ['none', 'بدون']], ws.cooling, (v) => { ws.cooling = v; persist(); }),
            h('div', { class: 'switch-row' }, h('input', { type: 'checkbox', id: 'sweet', class: 'switch', checked: ws.sweetWanted, on: { change: (e) => { ws.sweetWanted = e.target.checked; persist(); } } }), h('label', { for: 'sweet' }, 'أريد حلاوة واضحة'), h('p', { class: 'hint' }, 'يعتمد على ذكر «حلو» في نصوص المصنّعين، وليس قياساً للحلاوة.')),
            h('div', { class: 'switch-row' }, h('input', { type: 'checkbox', id: 'stock', class: 'switch', checked: ws.stockOnly, on: { change: (e) => { ws.stockOnly = e.target.checked; persist(); } } }), h('label', { for: 'stock' }, 'من مخزوني فقط'), h('p', { class: 'hint' }, 'لا يقترح كمية أكبر من رصيدك المسجّل.')),
            h('div', { class: 'field-row' }, h('div', { class: 'field' }, h('label', { for: 'maxp', class: 'field-label' }, 'أقصى عدد منتجات'), h('div', { class: 'stepper' }, h('button', { type: 'button', class: 'btn btn-quiet', 'aria-label': 'أقل', disabled: ws.maxProducts <= 2, on: { click: () => { ws.maxProducts--; persist(); render(); } } }, '−'), h('output', { id: 'maxp', class: 'stepper-value', 'aria-live': 'polite' }, String(ws.maxProducts)), h('button', { type: 'button', class: 'btn btn-quiet', 'aria-label': 'أكثر', disabled: ws.maxProducts >= 6, on: { click: () => { ws.maxProducts++; persist(); render(); } } }, '+'))), h('div', { class: 'field' }, h('label', { for: 'grams', class: 'field-label' }, 'الكمية (غ)'), gramsInput)),
            h('label', { for: 'excl', class: 'field-label' }, 'استبعاد منتج'),
            ws.excludedIds.length ? h('div', { class: 'chips' }, ws.excludedIds.map((id) => h('button', { type: 'button', class: 'chip chip-on', 'aria-label': `إلغاء استبعاد ${ctx.products.get(id)?.name ?? id}`, on: { click: () => { ws.excludedIds = ws.excludedIds.filter((x) => x !== id); persist(); render(); } } }, h('bdi', null, ctx.products.get(id)?.name ?? id), ' ✕'))) : null,
            search, results,
        ];
    }
    function step3() {
        const preview = wizardToRequest(ws, ctx);
        return [
            h('h2', { class: 'section-title' }, 'النمط'),
            h('fieldset', { class: 'modes' }, h('legend', { class: 'sr-only' }, 'نمط المخرجات'), GENERATION_MODES.slice().sort((a, b) => (a === 'PRECISION' ? -1 : b === 'PRECISION' ? 1 : 0)).map((m) => {
                const id = `mode-${m}`;
                return h('div', { class: 'mode-opt' }, h('input', { type: 'radio', name: 'mode', id, checked: ws.mode === m, on: { change: () => { ws.mode = m; persist(); render(); } } }), h('label', { for: id }, h('span', { class: 'mode-name' }, MODE_AR[m].name), h('span', { class: 'mode-help' }, MODE_AR[m].help)));
            })),
            h('details', { class: 'more' }, h('summary', null, 'مصدر الوصفات المرجعية'), segmented('quality', 'أقل مستوى دليل مقبول', ['recorded', 'published', 'verified', 'any'].map((q) => [q, QUALITY_AR[q]]), ws.sourceQualityMin, (v) => { ws.sourceQualityMin = v; persist(); })),
            h('p', { class: 'summary-line' }, requestSummaryAr(preview.request, ctx)),
        ];
    }
    function run() {
        const parsed = wizardToRequest(ws, ctx);
        const t0 = performance.now();
        const response = generate(parsed.request, ctx);
        app.setPref('lastGenerateMs', Math.round((performance.now() - t0) * 10) / 10);
        app.last = { wizard: { ...ws }, parsed, response, at: app.now() };
        persist();
        step = 1;
        location.hash = '#/results';
    }
    function render() {
        const focusId = document.activeElement?.id;
        clear(steps);
        ['الهدف', 'التفضيل', 'النمط'].forEach((s, i) => steps.append(h('li', { class: i + 1 === step ? 'step-on' : i + 1 < step ? 'step-done' : '', 'aria-current': i + 1 === step ? 'step' : null }, s)));
        clear(body);
        append(body, step === 1 ? step1() : step === 2 ? step2() : step3());
        clear(bar);
        bar.append(step > 1 ? h('button', { type: 'button', class: 'btn btn-quiet', on: { click: () => { step--; render(); } } }, 'السابق') : h('span'), step < 3
            ? h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => { step++; render(); } } }, 'التالي')
            : h('button', { type: 'button', class: 'btn btn-primary', id: 'generate', on: { click: run } }, 'ولّد'));
        if (step === 1 || step === 2)
            bar.append(h('button', { type: 'button', class: 'btn btn-quiet', on: { click: run } }, 'ولّد الآن'));
        if (focusId)
            document.getElementById(focusId)?.focus();
    }
    root.append(pageHead('ولّد مكس', 'اختر ما تريد؛ يعرض المولّد 1–3 اقتراحات مع الدليل، أو يقول إن الدليل لا يكفي.'), steps, body, bar);
    render();
};
