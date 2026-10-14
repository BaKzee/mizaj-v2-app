/**
 * Intent parser (ENGINE §3) — deterministic, offline, no language model.
 * Turns a short Arabic/English request ("مانجو بارد بدون نعناع من مخزوني") into a
 * GenerateRequest and reports exactly which words it understood, so the user can see
 * (and fix) the interpretation. Words it does not know are listed, never guessed.
 */
import { extractDescriptors, LEXICON } from "../knowledge/descriptors.js";
import { normalizeName } from "../knowledge/ingest.js";
import { defaultRequest } from "./api.js";
/** Arabic (and common Gulf/Levant spellings) → lexicon descriptor id or group. */
const AR_TERMS = [
    ['جوز الهند', 'coconut'], ['ايس كريم', 'ice_cream'], ['ايسكريم', 'ice_cream'], ['جريب فروت', 'grapefruit'], ['كريب فروت', 'grapefruit'],
    ['باشن فروت', 'passion_fruit'], ['فاكهه العاطفه', 'passion_fruit'], ['توت ازرق', 'blueberry'], ['توت اسود', 'blackberry'], ['توت بري', 'cranberry'],
    ['توت العليق', 'raspberry'], ['ميلك شيك', 'milkshake'], ['مشروب طاقه', 'energy_drink'], ['بوب كورن', 'popcorn'],
    ['عنب', 'grape'], ['خوخ', 'peach'], ['دراق', 'peach'], ['كرز', 'cherry'], ['بطيخ', 'watermelon'], ['رقي', 'watermelon'], ['كيوي', 'kiwi'],
    ['تفاح', 'apple'], ['اجاص', 'pear'], ['كمثري', 'pear'], ['انجاص', 'pear'], ['برقوق', 'plum'], ['شمام', 'melon'], ['صبار', 'cactus'],
    ['توت', 'berry'], ['فراوله', 'strawberry'], ['فريز', 'strawberry'], ['فرامبواز', 'raspberry'], ['راسبيري', 'raspberry'], ['بلوبيري', 'blueberry'],
    ['زرشك', 'barberry'], ['كرانبيري', 'cranberry'], ['حمضيات', 'citrus'], ['لايم', 'lime'], ['ليم', 'lime'], ['ليمون', 'lemon'],
    ['برتقال', 'orange'], ['يوسفي', 'mandarin'], ['مندلينا', 'mandarin'], ['بوملي', 'pomelo'], ['مانجو', 'mango'], ['منجا', 'mango'],
    ['مانغو', 'mango'], ['مانجا', 'mango'], ['باشن', 'passion_fruit'], ['ماراكويا', 'passion_fruit'], ['اناناس', 'pineapple'],
    ['كوكو', 'coconut'], ['كوكونات', 'coconut'], ['ليتشي', 'lychee'], ['جوافه', 'guava'], ['كيوانو', 'kiwano'], ['استوائي', 'tropical'],
    ['تروبيكال', 'tropical'], ['فاوانيا', 'peony'], ['بيوني', 'peony'], ['بنفسج', 'violet'], ['ياسمين', 'jasmine'], ['ورد', 'rose'],
    ['ورده', 'rose'], ['بابونج', 'chamomile'], ['زهري', 'floral'], ['زهور', 'floral'], ['ورود', 'floral'], ['فانيلا', 'vanilla'],
    ['فانيليا', 'vanilla'], ['كريمه', 'cream'], ['كريمي', 'cream'], ['قشطه', 'cream'], ['حليب', 'cream'], ['بوظه', 'ice_cream'],
    ['مارشملو', 'marshmallow'], ['كراميل', 'caramel'], ['شوكولاته', 'chocolate'], ['شوكولا', 'chocolate'], ['زبادي', 'yogurt'],
    ['كيك', 'pastry'], ['وافل', 'pastry'], ['بسكويت', 'pastry'], ['عسل', 'honey'], ['حلوي', 'candy'], ['سكاكر', 'candy'], ['علكه', 'chewing_gum'],
    ['علك', 'chewing_gum'], ['لوز', 'almond'], ['مكسرات', 'nut'], ['بندق', 'nut'], ['فشار', 'popcorn'], ['زعفران', 'saffron'], ['مسالا', 'masala'],
    ['هيل', 'cardamom'], ['حبهان', 'cardamom'], ['قرفه', 'cinnamon'], ['بهارات', 'spice'], ['توابل', 'spice'], ['شاي', 'tea'], ['شاهي', 'tea'],
    ['اولونغ', 'oolong'], ['قهوه', 'coffee'], ['كولا', 'cola'], ['صودا', 'soda'], ['ليموناضه', 'lemonade'], ['ليموناده', 'lemonade'],
    ['ليكيور', 'liqueur'], ['بايليز', 'liqueur'], ['جن', 'gin'], ['ويسكي', 'whisky'], ['نبيذ', 'wine'], ['نعناع', 'mint'], ['نعنع', 'mint'],
    ['ريحان', 'basil'], ['صنوبر', 'fir'], ['اوكالبتوس', 'eucalyptus'], ['فواكه', 'fruit'], ['فاكهه', 'fruit'],
    ['بارد', 'cooling'], ['بارده', 'cooling'], ['برود', 'cooling'], ['بروده', 'cooling'], ['ثلج', 'cooling'], ['ثلجي', 'cooling'], ['مثلج', 'cooling'],
    ['ساقع', 'cooling'], ['تبريد', 'cooling'], ['حلو', 'sweet'], ['حلوه', 'sweet'], ['حامض', 'sour'], ['حامضه', 'sour'], ['حموضه', 'sour'],
    ['منعش', 'refreshing'], ['منعشه', 'refreshing'],
];
const NEGATORS = ['بدون', 'بلا', 'من غير', 'غير', 'مش', 'بدي بلا', 'without', 'no', 'not'];
const STOCK_WORDS = ['مخزوني', 'مخزون', 'عندي', 'الموجود', 'الموجوده', 'المتوفر', 'متوفر', 'stock'];
const DISCOVERY_WORDS = ['جديد', 'جديده', 'ابتكار', 'استكشاف', 'جرب', 'غريب', 'غريبه', 'discover', 'new'];
/** Arabic normalisation: diacritics, alef forms, taa marbuta, alef maqsura, tatweel. */
export function normalizeArabic(s) {
    return s.toLowerCase()
        .replace(/[ً-ْٰـ]/g, '')
        .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
        .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}
const ARABIC_NUMBERS = { 'اثنين': 2, 'اثنتين': 2, 'ثلاث': 3, 'ثلاثه': 3, 'اربع': 4, 'اربعه': 4, 'خمس': 5, 'خمسه': 5 };
export function parseIntent(text, ctx, base = {}) {
    const req = defaultRequest(base);
    const understood = [];
    const targets = new Set(req.targetDescriptors);
    const negatives = new Set(req.negativeDescriptors);
    const preferred = new Set(req.preferredFlavorIds);
    const excluded = new Set(req.excludedFlavorIds);
    const raw = text.slice(0, 500);
    // tokens: words with their normalized form; strip common one-letter prefixes (و، ب، ل) and "ال"
    const tokens = raw.split(/[\s،,.;:!?؟()\-]+/).filter(Boolean).map((t) => ({ raw: t, norm: normalizeArabic(t) }));
    const used = new Array(tokens.length).fill(false);
    const bare = (w) => w.replace(/^(و|ب|ل|ف)(?=ال)/, '').replace(/^ال/, '');
    // Negation covers only the word right after the negator ("بدون نعناع وبارد" → mint unwanted, cold wanted).
    const negatedAt = (i) => {
        const w = tokens[i - 1]?.norm;
        return !!w && (NEGATORS.includes(w) || NEGATORS.includes(bare(w)));
    };
    // forms: as written, without "ال"/one-letter prefix, and without a feminine ending (استوائية → استوائي)
    const forms = (w) => {
        const s = w.replace(/^[وبلف](?=..)/, '');
        const base = [w, bare(w), s, bare(s)];
        return [...base, ...base.map((x) => x.replace(/يه$/, 'ي').replace(/([^ي])ه$/, '$1'))];
    };
    const mark = (i, n) => { for (let k = i; k < i + n; k++)
        used[k] = true; };
    // product names (Latin) — the user's own library names, aliases and confirmed maker names
    const lowered = ` ${normalizeName(raw)} `;
    for (const p of [...ctx.products.values()].sort((a, b) => b.name.length - a.name.length)) {
        for (const n of p.names) {
            const key = normalizeName(n);
            if (key.length < 4 || !lowered.includes(key))
                continue;
            const idx = tokens.findIndex((t) => normalizeName(t.raw) && key.startsWith(normalizeName(t.raw)));
            const neg = idx >= 0 && negatedAt(idx);
            if (neg)
                excluded.add(p.id);
            else
                preferred.add(p.id);
            if (idx >= 0)
                mark(idx, n.split(/\s+/).length);
            understood.push({ text: n, meaning: `${neg ? 'استبعاد' : 'تفضيل'} المنتج «${p.name}»` });
            break;
        }
    }
    // Arabic phrases (longest first), then single words
    const phrases = AR_TERMS.map(([a, t]) => [normalizeArabic(a), t]).sort((a, b) => b[0].split(' ').length - a[0].split(' ').length || b[0].length - a[0].length);
    for (let i = 0; i < tokens.length; i++) {
        if (used[i])
            continue;
        for (const [phrase, term] of phrases) {
            const parts = phrase.split(' ');
            const window = tokens.slice(i, i + parts.length);
            if (window.length !== parts.length || window.some((t, k) => !forms(t.norm).includes(parts[k])))
                continue;
            const neg = negatedAt(i);
            (neg ? negatives : targets).add(term);
            if (neg)
                targets.delete(term);
            mark(i, parts.length);
            understood.push({ text: tokens.slice(i, i + parts.length).map((t) => t.raw).join(' '), meaning: `${neg ? 'بدون' : 'مطلوب'}: ${LEXICON.find((e) => e.id === term)?.ar ?? term}` });
            break;
        }
    }
    // stock, mode, counts, grams
    for (let i = 0; i < tokens.length; i++) {
        const w = bare(tokens[i].norm.replace(/^[وبلف](?=ال)/, ''));
        if (STOCK_WORDS.includes(w) || STOCK_WORDS.includes(tokens[i].norm)) {
            req.stockOnly = true;
            used[i] = true;
            understood.push({ text: tokens[i].raw, meaning: 'من مخزونك فقط' });
        }
        if (DISCOVERY_WORDS.includes(w)) {
            req.mode = 'DISCOVERY';
            used[i] = true;
            understood.push({ text: tokens[i].raw, meaning: 'وضع الاستكشاف (فرضيات غير مختبرة مسموحة)' });
        }
        if (['منتجين', 'نكهتين', 'مكونين'].includes(w)) {
            req.maxProducts = 2;
            used[i] = true;
            understood.push({ text: tokens[i].raw, meaning: 'حد أقصى منتجان' });
        }
        const num = /^\d+$/.test(w) ? Number(w) : ARABIC_NUMBERS[w];
        const next = tokens[i + 1] ? bare(tokens[i + 1].norm) : '';
        if (num !== undefined && /^(نكهات|منتجات|مكونات|نكهه|products|flavors)$/.test(next) && num >= 1 && num <= 8) {
            req.maxProducts = num;
            used[i] = used[i + 1] = true;
            understood.push({ text: `${tokens[i].raw} ${tokens[i + 1].raw}`, meaning: `حد أقصى ${num} منتجات` });
        }
        if (num !== undefined && /^(غ|غم|غرام|جرام|جم|g|gr|gram|grams)$/.test(next) && num >= 1 && num <= 1000) {
            req.gramsTotalMg = num * 1000;
            used[i] = used[i + 1] = true;
            understood.push({ text: `${tokens[i].raw} ${tokens[i + 1].raw}`, meaning: `الكمية ${num} غ` });
        }
        const m = /^(\d+)(g|gr|غ|غم|جم)$/.exec(w);
        if (m) {
            req.gramsTotalMg = Number(m[1]) * 1000;
            used[i] = true;
            understood.push({ text: tokens[i].raw, meaning: `الكمية ${m[1]} غ` });
        }
        if (NEGATORS.includes(w) || NEGATORS.includes(tokens[i].norm) || w === 'من' || ['بدي', 'ابي', 'اريد', 'ابغي', 'ابغى', 'خلطه', 'وصفه', 'مع', 'و', 'اعطني', 'اقترح', 'لي', 'شي', 'شيء'].includes(w))
            used[i] = true;
    }
    // English / Russian descriptor words via the lexicon (only for words not consumed yet)
    for (let i = 0; i < tokens.length; i++) {
        if (used[i])
            continue;
        const hits = extractDescriptors(tokens[i].raw);
        if (!hits.length)
            continue;
        const neg = negatedAt(i);
        for (const h of hits) {
            if (h.group === 'mix_marker' || h.group === 'style')
                continue;
            (neg ? negatives : targets).add(h.id);
            understood.push({ text: tokens[i].raw, meaning: `${neg ? 'بدون' : 'مطلوب'}: ${h.ar}` });
        }
        used[i] = true;
    }
    for (const t of targets)
        if (negatives.has(t))
            targets.delete(t);
    for (const p of excluded)
        preferred.delete(p);
    req.targetDescriptors = [...targets];
    req.negativeDescriptors = [...negatives];
    req.preferredFlavorIds = [...preferred].sort();
    req.excludedFlavorIds = [...excluded].sort();
    const ignored = tokens.filter((_, i) => !used[i]).map((t) => t.raw);
    return { request: req, understood, ignored };
}
