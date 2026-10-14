/** Inventory (05_UX "Inventory"): balances, purchases that ADD, corrections that re-base, shopping list. */
import { append, clear, h, openSheet, setStyle, toast } from "../dom.js";
import { countAr, grams, inventoryRows, packMgFor, PRODUCTS_AR, RECIPES_AR } from "../model.js";
import { recordMovement, refusalAr } from "../actions.js";
import { finishPack } from "../../engine/finish.js";
import { restockOptions, SHOPPING_MAX_SESSIONS_SHOWN, supportedStockStats } from "../../engine/shopping.js";
import { attributionAr } from "../model.js";
import { logSheet } from "./sheets.js";
import { fmtDate, list, needData, pageHead, section, tierBadge } from "./shared.js";
const SESSIONS_AR = { one: 'جلسة واحدة', two: 'جلستان', plural: 'جلسات', tamyiz: 'جلسة' };
const TYPE_AR = { opening_snapshot: 'رصيد افتتاحي من التطبيق القديم', purchase: 'شراء', consume: 'استهلاك', correction: 'تصحيح رصيد', waste: 'هدر', refund: 'إرجاع' };
function movementSheet(app, row) {
    openSheet(row.name, (close) => {
        let type = 'purchase';
        const amount = h('input', { id: 'mv-g', type: 'number', class: 'input input-num', inputmode: 'decimal', min: '0', max: '5000', step: '0.1', value: String(row.packMg / 1000) });
        const cost = h('input', { id: 'mv-cost', type: 'number', class: 'input input-num', inputmode: 'decimal', min: '0', step: '0.01', placeholder: 'اختياري' });
        const currency = h('input', { id: 'mv-cur', type: 'text', class: 'input input-short', maxlength: '8', placeholder: 'العملة', autocomplete: 'off' });
        const note = h('input', { id: 'mv-note', type: 'text', class: 'input', maxlength: '200', placeholder: 'ملاحظة (اختيارية)' });
        const help = h('p', { class: 'hint' });
        const costBox = h('div', { class: 'field-row' }, h('div', { class: 'field' }, h('label', { for: 'mv-cost', class: 'field-label' }, 'السعر'), cost), h('div', { class: 'field' }, h('label', { for: 'mv-cur', class: 'field-label' }, 'العملة'), currency));
        const err = h('p', { class: 'error-text', role: 'alert' });
        const seg = h('div', { class: 'seg-row', role: 'radiogroup', 'aria-label': 'نوع الحركة' });
        const drawSeg = () => {
            clear(seg);
            for (const [t, l] of [['purchase', 'شراء'], ['correction', 'تصحيح الرصيد'], ['waste', 'هدر']]) {
                seg.append(h('button', { type: 'button', role: 'radio', class: `chip${type === t ? ' chip-on' : ''}`, 'aria-checked': String(type === t), on: { click: () => { type = t; drawSeg(); } } }, l));
            }
            help.textContent = type === 'purchase' ? 'الشراء يُضاف إلى الرصيد (لا يستبدله).' : type === 'correction' ? 'التصحيح يضبط الرصيد على ما تزنه الآن؛ سجل الاستهلاك لا يتغيّر.' : 'الهدر يُخصم من الرصيد، ولا يُقبل أكثر من المتاح.';
            costBox.hidden = type !== 'purchase';
            amount.value = type === 'purchase' ? String(row.packMg / 1000) : type === 'correction' ? String(row.availableMg / 1000) : '';
        };
        drawSeg();
        const events = app.bundle.inventoryEvents.filter((e) => e.flavorId === row.flavorId).slice(-6).reverse();
        return [
            h('p', null, `المتاح ${grams(row.availableMg)} · عبوة ${grams(row.packMg)} · استُهلك منذ الرصيد الافتتاحي ${grams(row.consumedSinceOpeningMg)}`),
            row.costPerGram ? h('p', { class: 'muted small' }, `متوسط التكلفة: ${(row.costPerGram.amountPerGram / 100).toFixed(2)} ${row.costPerGram.currency ?? ''} للغرام`) : null,
            row.availableMg > 0 ? h('button', { type: 'button', class: 'btn btn-quiet', on: { click: () => { close(); finishSheet(app, row); } } }, 'أنهِ العلبة') : null,
            seg, help,
            h('div', { class: 'field' }, h('label', { for: 'mv-g', class: 'field-label' }, 'الكمية (غ)'), amount),
            costBox,
            h('label', { for: 'mv-note', class: 'sr-only' }, 'ملاحظة'), note,
            err,
            h('div', { class: 'sheet-actions' }, h('button', { type: 'button', class: 'btn btn-primary', on: { click: async () => {
                        try {
                            const mg = Math.round(Number(amount.value) * 1000);
                            if (amount.value.trim() === '' || !Number.isSafeInteger(mg) || mg < 0)
                                throw new Error('أدخل كمية صحيحة.');
                            const c = type === 'purchase' && cost.value.trim() ? { amount: Math.round(Number(cost.value) * 100), currency: currency.value.trim() || null } : null;
                            if (c && (!Number.isSafeInteger(c.amount) || c.amount < 0))
                                throw new Error('السعر غير صالح.');
                            await recordMovement(app, { flavorId: row.flavorId, type, mg, note: note.value, cost: c });
                            close();
                            toast('سُجّلت الحركة.');
                            window.dispatchEvent(new HashChangeEvent('hashchange'));
                        }
                        catch (x) {
                            err.textContent = refusalAr(x);
                        }
                    } } }, 'سجّل'), h('button', { type: 'button', class: 'btn btn-quiet', on: { click: close } }, 'إلغاء')),
            h('h3', { class: 'sub-title' }, 'آخر الحركات'),
            list(events.map((e) => `${TYPE_AR[e.type] ?? e.type} · ${e.deltaMg !== null ? grams(Math.abs(e.deltaMg)) : e.balanceMg !== null ? `الرصيد ${grams(e.balanceMg)}` : ''} · ${fmtDate(e.at)}${e.note ? ` — ${e.note}` : ''}`)),
        ];
    });
}
/** «أنهِ العلبة»: recorded/published formulas that use up what is left of this pack, exact to the milligram. */
function finishSheet(app, row) {
    openSheet(`أنهِ العلبة — ${row.name}`, () => {
        const r = finishPack(app.ctx, row.flavorId, { batchMg: app.bundle.settings.defaultGramsTotalMg });
        const cards = r.plans.map((p) => {
            const link = p.recipeId
                ? h('a', { href: `#/recipe/${encodeURIComponent(p.recipeId)}` }, 'افتح الوصفة')
                : p.url ? h('a', { href: p.url, rel: 'noopener noreferrer', target: '_blank' }, 'المصدر') : null;
            return h('li', { class: 'card' }, h('div', { class: 'row-main' }, h('bdi', null, p.name)), tierBadge(p.tier, attributionAr(p.attribution)), h('p', null, p.summaryAr), h('ol', { class: 'bullets' }, ...p.sessions.map((s, i) => h('li', null, `الجلسة ${i + 1} (${grams(s.totalMg)}): `, s.lines.map((l) => `${l.name} ${grams(l.mg)}`).join(' · '), p.recipeId && p.versionId
                ? [' ', h('button', { type: 'button', class: 'btn btn-quiet btn-small', on: { click: () => logSheet(app, p.recipeId, p.versionId, `${p.name} — جلسة ${i + 1}`, { totalMg: s.totalMg, note: 'جلسة من خطة «أنهِ العلبة»' }) } }, 'سجّل هذه الجلسة')]
                : null))), link);
        });
        return [
            h('p', null, `المتاح ${grams(r.availableMg)}. خطط من وصفات سجّلتها (أو منشورة بنسب كاملة) تستهلك هذه العلبة بأوزان دقيقة وتخصم من مخزونك فقط ما هو متوفر.`),
            h('p', { class: 'hint' }, 'هذا ترتيب للكميات وليس وعداً بالطعم؛ لا توصية بدرجة حرارة أو فحم.'),
            cards.length ? h('ul', { class: 'rows' }, ...cards) : h('p', { class: 'muted' }, r.messages[0] ?? 'لا خطة متاحة.'),
            ...(cards.length ? r.messages : r.messages.slice(1)).map((m) => h('p', { class: 'muted small' }, m)),
        ];
    });
}
/** «ماذا أشتري؟»: the recipes one more pack of this product would make possible. */
function restockSheet(app, o) {
    openSheet(`${o.name} — ماذا تُعيد؟`, () => [
        h('p', null, o.summaryAr),
        h('p', { class: 'hint' }, 'عدّ للوصفات المدعومة فقط (سجلاتك أو منشورة بنسب كاملة) التي ينقصها هذا المنتج وحده؛ ليس رأياً في الطعم.'),
        h('ul', { class: 'rows' }, ...o.unlocks.map((u) => h('li', { class: 'card' }, h('div', { class: 'row-main' }, h('bdi', null, u.name)), tierBadge(u.tier, attributionAr(u.attribution)), h('p', { class: 'muted small' }, `تكفي ${u.sessions >= SHOPPING_MAX_SESSIONS_SHOWN ? `${SHOPPING_MAX_SESSIONS_SHOWN} جلسة أو أكثر` : countAr(u.sessions, SESSIONS_AR)} بعد الشراء`), u.recipeId ? h('a', { href: `#/recipe/${encodeURIComponent(u.recipeId)}` }, 'افتح الوصفة') : u.url ? h('a', { href: u.url, rel: 'noopener noreferrer', target: '_blank' }, 'المصدر') : null))),
    ]);
}
export const inventoryView = (app, root, params) => {
    if (!app.ctx || !app.bundle) {
        needData(root);
        return;
    }
    const rows = inventoryRows(app.bundle, app.ctx);
    const low = rows.filter((r) => r.low);
    const q = h('input', { id: 'inv-q', type: 'search', class: 'input', placeholder: 'ابحث في المخزون', autocomplete: 'off' });
    const listEl = h('ul', { class: 'rows', 'aria-live': 'polite' });
    const draw = () => {
        clear(listEl);
        const s = q.value.trim().toLowerCase();
        for (const r of rows.filter((x) => !s || x.name.toLowerCase().includes(s) || x.brand.toLowerCase().includes(s))) {
            const fill = h('span', { class: `bar-fill${r.low ? ' bar-low' : ''}`, 'aria-hidden': 'true' });
            setStyle(fill, 'inline-size', `${Math.min(100, Math.max(0, r.pctOfPack))}%`);
            listEl.append(h('li', null, h('button', { type: 'button', class: 'row row-btn', on: { click: () => movementSheet(app, r) } }, h('span', { class: 'row-main' }, h('bdi', null, r.name), h('span', { class: 'brand' }, ` · ${r.brand}`)), h('span', { class: 'row-sub' }, h('span', { class: 'bar-track' }, fill), ` ${grams(r.availableMg)} (${r.pctOfPack}%)`, r.low ? h('span', { class: 'warn-text' }, ' · منخفض') : null))));
        }
    };
    q.addEventListener('input', draw);
    const restock = restockOptions(app.ctx, { batchMg: app.bundle.settings.defaultGramsTotalMg, packMgOf: (id) => packMgFor(app.bundle.inventoryEvents, id, app.bundle.settings.defaultPackMg) });
    const stats = supportedStockStats(app.ctx, app.bundle.settings.defaultGramsTotalMg);
    const suggestions = app.pack?.productSuggestions?.filter((s) => s.unlocks.length).slice(0, 5) ?? [];
    append(root, pageHead('المخزون', `${countAr(low.length, PRODUCTS_AR)} تحت ${app.bundle.settings.lowStockPct}% من العبوة`), section('ماذا أشتري؟', restock.length ? [h('p', { class: 'hint' }, 'منتجاتك التي تعيد عبوة جديدة منها أكبر عدد من الوصفات المدعومة. اضغط لترى الوصفات.'),
        h('ul', { class: 'rows' }, ...restock.map((o) => h('li', null, h('button', { type: 'button', class: 'row row-btn', on: { click: () => restockSheet(app, o) } }, h('span', { class: 'row-main' }, h('bdi', null, o.name), h('span', { class: 'brand' }, ` · ${o.brand}`)), h('span', { class: 'row-sub' }, `تُعيد ${countAr(o.unlocks.length, RECIPES_AR)} (${o.withEvidence} بسجلاتك)`)))))]
        : h('p', { class: 'muted' }, stats.makeableNow === stats.supported
            ? `كل وصفاتك المدعومة (${stats.supported}) ممكنة الآن بمخزونك لدفعة كاملة؛ لا شيء ينقصك. تظهر هنا المنتجات عندما ينقص منتج واحد وصفات مدعومة.`
            : `${stats.makeableNow} من ${stats.supported} وصفة مدعومة ممكنة الآن؛ الباقي ينقصه أكثر من منتج، فلا تحلّه عبوة واحدة.`)), section('قائمة التسوق', low.length ? list(low.map((r) => {
        const same = (app.ctx.products.get(r.flavorId)?.sameAs ?? []).map((id) => rows.find((x) => x.flavorId === id)).filter((x) => !!x && x.availableMg > 0);
        return [`${r.name} (${r.brand}) — ${grams(r.availableMg)} `, r.availableMg > 0 ? h('button', { type: 'button', class: 'btn btn-quiet btn-small', on: { click: () => finishSheet(app, r) } }, 'أنهِ العلبة') : null, same.length ? h('span', { class: 'muted' }, ` · لديك المنتج نفسه باسم ${same.map((x) => `${x.name}: ${grams(x.availableMg)}`).join('، ')} (قرارك)`) : null];
    })) : h('p', { class: 'muted' }, 'لا شيء تحت حد التنبيه.'), suggestions.length ? [h('h3', { class: 'sub-title' }, 'منتجات غير موجودة تُكمل وصفات منشورة'),
        h('p', { class: 'hint' }, 'عدد وصفات منشورة بنسب كاملة تُكملها مع منتجاتك — ليس رأياً في الطعم.'),
        list(suggestions.map((s) => `${s.productName} (${s.brand}) — ${countAr(s.unlocks.length, RECIPES_AR)}`))] : null), h('label', { for: 'inv-q', class: 'sr-only' }, 'بحث'), q, listEl);
    draw();
    const focus = params.get('p');
    if (focus) {
        // open once: drop the parameter so a re-render after saving does not reopen the sheet
        history.replaceState(null, '', '#/inventory');
        const r = rows.find((x) => x.flavorId === focus);
        if (r)
            movementSheet(app, r);
    }
};
