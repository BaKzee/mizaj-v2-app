/** «أسئلة الثواني العشر»: one tap per question about a product; display-only, never asks for a rating. */
import { clear, h, toast } from "../dom.js";
import { PROVENANCE_AR } from "../../engine/assist.js";
import { NOTE_LABEL_AR, nextQuestions, noteFor, noteStatusAr, questionKey } from "../../engine/notes.js";
import { recordProductNote, refusalAr } from "../actions.js";
const SKIP_KEY = 'skippedQuestions';
const skipped = (app) => {
    const v = app.prefs()[SKIP_KEY];
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
};
export const NOTE_CAPTION_AR = 'ملاحظة شخصية على المنتج (بلا رقم دفعة) — لا تغيّر أي درجة أو دليل.';
/** Home card: the single most useful unanswered question, then the next one. */
export function quickQuestionCard(app) {
    const box = h('section', { class: 'section quick-q', 'aria-live': 'polite' });
    const draw = () => {
        clear(box);
        const q = nextQuestions(app.ctx, app.productNotes, { skipped: skipped(app), limit: 1 })[0];
        if (!q) {
            box.hidden = true;
            return;
        }
        box.hidden = false;
        const answer = async (a) => {
            try {
                await recordProductNote(app, { flavorId: q.flavorId, descriptorId: q.descriptorId, answer: a });
                toast('سُجّلت ملاحظتك.');
                draw();
            }
            catch (x) {
                toast(refusalAr(x));
            }
        };
        box.append(h('h2', { class: 'section-title' }, 'سؤال سريع'), h('p', null, 'هل تجد نكهة «', h('strong', null, q.descriptorAr), '» في ', h('bdi', null, q.productName), ' (', h('bdi', null, q.brand), ')؟'), h('p', { class: 'muted small' }, `${PROVENANCE_AR[q.provenance]}${q.usedInRecorded ? ` · في ${q.usedInRecorded} من وصفاتك المسجّلة` : ''}`), h('div', { class: 'seg-row' }, h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => void answer('yes') } }, NOTE_LABEL_AR.yes), h('button', { type: 'button', class: 'btn', on: { click: () => void answer('no') } }, NOTE_LABEL_AR.no), h('button', { type: 'button', class: 'btn', on: { click: () => void answer('unsure') } }, NOTE_LABEL_AR.unsure), h('button', { type: 'button', class: 'btn btn-quiet', on: { click: () => { app.setPref(SKIP_KEY, [...skipped(app), questionKey(q)].slice(-500)); draw(); } } }, 'تخطَّ')), h('p', { class: 'hint' }, NOTE_CAPTION_AR));
    };
    draw();
    return box;
}
/** One descriptor in the passport: its provenance, the owner's answer, and the three buttons to (re)answer. */
export function descriptorRow(app, flavorId, d, label) {
    const li = h('li', null);
    const draw = () => {
        clear(li);
        const cur = noteFor(app.productNotes, flavorId, d.id);
        const status = noteStatusAr(d, cur);
        li.append(label, h('span', { class: `prov prov-${d.provenance}` }, PROVENANCE_AR[d.provenance]));
        if (status)
            li.append(h('span', { class: 'muted small' }, ` · ${status}`));
        li.append(h('span', { class: 'seg-row', role: 'group', 'aria-label': `ملاحظتك عن ${label}` }, ...['yes', 'no', 'unsure'].map((a) => h('button', { type: 'button', class: `chip${cur === a ? ' chip-on' : ''}`, 'aria-pressed': String(cur === a), on: { click: async () => {
                    try {
                        await recordProductNote(app, { flavorId, descriptorId: d.id, answer: a });
                        draw();
                    }
                    catch (x) {
                        toast(refusalAr(x));
                    }
                } } }, NOTE_LABEL_AR[a]))));
    };
    draw();
    return li;
}
