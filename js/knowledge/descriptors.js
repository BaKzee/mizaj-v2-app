/**
 * Sourced sensory descriptors (P1 "family + subfamily + identity descriptors").
 *
 * Descriptors are extracted ONLY from a captured product-description excerpt, by a
 * fixed, versioned lexicon: a term either occurs in the excerpt or it does not. No
 * model guesses, no translation, no taste scores. The output is a MODEL_INFERENCE
 * derived from a sourced text and is labelled as such; it never becomes "verified"
 * by itself.
 */
export const DESCRIPTOR_LEXICON_VERSION = 'desc-lex@3';
export const DESCRIPTOR_GROUPS = [
    'fruit', 'berry', 'citrus', 'tropical', 'floral', 'creamy_dessert', 'confection', 'nut', 'herbal', 'spice', 'tea', 'beverage', 'alcohol_flavor', 'cooling', 'other',
    'taste_attribute', 'style', 'mix_marker',
];
/** Arabic display labels for groups. */
export const GROUP_LABEL_AR = {
    fruit: 'فواكه', berry: 'توتيات', citrus: 'حمضيات', tropical: 'استوائي', floral: 'زهري', creamy_dessert: 'كريمي/حلويات', confection: 'سكاكر/علكة', nut: 'مكسرات', herbal: 'عشبي',
    spice: 'توابل', tea: 'شاي', beverage: 'مشروبات', alcohol_flavor: 'نكهة مشروب كحولي', cooling: 'برودة', other: 'أخرى',
    taste_attribute: 'صفة طعم', style: 'أسلوب', mix_marker: 'إشارة مزيج',
};
/**
 * The lexicon. Russian stems are chosen to avoid known collisions, e.g. cream
 * (сливк-/сливоч-) vs plum (слива/сливы), flowers (цветы/цветок) vs colour (цвет).
 */
export const LEXICON = [
    { id: 'grape', group: 'fruit', ar: 'عنب', stems: ['виноград'], words: ['grape', 'grapes'] },
    { id: 'peach', group: 'fruit', ar: 'خوخ', stems: ['персик', 'peach'], words: ['אפרסק'] },
    { id: 'cherry', group: 'fruit', ar: 'كرز', stems: ['вишн', 'вишен', 'cherr'] },
    { id: 'watermelon', group: 'fruit', ar: 'بطيخ', stems: ['арбуз', 'watermelon'] },
    { id: 'kiwi', group: 'fruit', ar: 'كيوي', words: ['киви', 'kiwi'] },
    { id: 'apple', group: 'fruit', ar: 'تفاح', stems: ['яблок', 'яблоч', 'apple'] },
    { id: 'pear', group: 'fruit', ar: 'إجاص', stems: ['груш'], words: ['pear', 'pears'] },
    { id: 'plum', group: 'fruit', ar: 'برقوق', words: ['слива', 'сливы', 'сливу', 'сливой', 'plum'], stems: ['сливов'] },
    { id: 'melon', group: 'fruit', ar: 'شمام', stems: ['дын', 'melon'] },
    { id: 'cactus', group: 'other', ar: 'صبار', stems: ['кактус', 'cactus'] },
    { id: 'berry', group: 'berry', ar: 'توت', stems: ['ягод', 'berr'] },
    { id: 'strawberry', group: 'berry', ar: 'فراولة', stems: ['клубни', 'земляник', 'strawberr'] },
    { id: 'blackberry', group: 'berry', ar: 'توت أسود', stems: ['ежевик', 'blackberr'] },
    { id: 'cranberry', group: 'berry', ar: 'توت بري', stems: ['клюкв', 'cranberr'] },
    { id: 'lingonberry', group: 'berry', ar: 'عنب الثور', stems: ['брусник', 'lingonberr'] },
    { id: 'raspberry', group: 'berry', ar: 'توت العليق', stems: ['малин', 'raspberr'] },
    { id: 'blueberry', group: 'berry', ar: 'توت أزرق', stems: ['черник', 'голубик', 'blueberr'] },
    { id: 'barberry', group: 'berry', ar: 'زرشك', stems: ['барбарис', 'barberr'] },
    { id: 'citrus', group: 'citrus', ar: 'حمضيات', stems: ['цитрус', 'citrus'], words: ['הדרים', 'הדר'] },
    { id: 'lime', group: 'citrus', ar: 'ليم', stems: ['лайм', 'lime'], words: ['ליים'] },
    { id: 'lemon', group: 'citrus', ar: 'ليمون', stems: ['лимон', 'lemon'], words: ['לימון'] },
    { id: 'orange', group: 'citrus', ar: 'برتقال', stems: ['апельсин', 'orange'] },
    { id: 'mandarin', group: 'citrus', ar: 'يوسفي', stems: ['мандарин', 'tangerin', 'mandarin'] },
    { id: 'grapefruit', group: 'citrus', ar: 'جريب فروت', stems: ['грейпфрут', 'grapefruit'] },
    { id: 'pomelo', group: 'citrus', ar: 'بوملي', stems: ['помело', 'pomel'] },
    { id: 'mango', group: 'tropical', ar: 'مانجو', stems: ['манго', 'mango'] },
    { id: 'passion_fruit', group: 'tropical', ar: 'فاكهة العاطفة', stems: ['маракуй', 'passion'] },
    { id: 'pineapple', group: 'tropical', ar: 'أناناس', stems: ['ананас', 'pineapp'] },
    { id: 'coconut', group: 'tropical', ar: 'جوز الهند', stems: ['кокос', 'coconut'] },
    { id: 'lychee', group: 'tropical', ar: 'ليتشي', words: ['личи', 'lychee', 'litchi'] },
    { id: 'guava', group: 'tropical', ar: 'جوافة', stems: ['гуав', 'guav'] },
    { id: 'kiwano', group: 'tropical', ar: 'كيوانو', stems: ['кивано', 'kiwano'] },
    { id: 'tropical', group: 'tropical', ar: 'استوائي', stems: ['тропич', 'tropic'] },
    { id: 'peony', group: 'floral', ar: 'فاوانيا', stems: ['пион', 'peon'] },
    { id: 'violet', group: 'floral', ar: 'بنفسج', stems: ['фиалк', 'violet'] },
    { id: 'jasmine', group: 'floral', ar: 'ياسمين', stems: ['жасмин', 'jasmin'] },
    { id: 'rose', group: 'floral', ar: 'ورد', stems: ['розов'], words: ['роза', 'розы', 'rose', 'roses'] },
    { id: 'chamomile', group: 'floral', ar: 'بابونج', stems: ['ромашк', 'chamomile', 'camomile'] },
    { id: 'floral', group: 'floral', ar: 'زهري', stems: ['цветоч', 'цветы', 'цветок', 'цветк', 'floral', 'flower'] },
    { id: 'vanilla', group: 'creamy_dessert', ar: 'فانيليا', stems: ['ванил', 'vanill'] },
    { id: 'cream', group: 'creamy_dessert', ar: 'كريمة', stems: ['сливк', 'сливоч', 'cream'] },
    { id: 'ice_cream', group: 'creamy_dessert', ar: 'آيس كريم', stems: ['морожен', 'icecream'] },
    { id: 'marshmallow', group: 'creamy_dessert', ar: 'مارشملو', stems: ['зефир', 'marshmallow'] },
    { id: 'milkshake', group: 'creamy_dessert', ar: 'ميلك شيك', stems: ['шейк', 'milkshake'] },
    { id: 'caramel', group: 'creamy_dessert', ar: 'كراميل', stems: ['карамел', 'caramel'] },
    { id: 'chocolate', group: 'creamy_dessert', ar: 'شوكولاتة', stems: ['шоколад', 'chocolat'] },
    { id: 'yogurt', group: 'creamy_dessert', ar: 'زبادي', stems: ['йогурт', 'yogurt', 'yoghurt'] },
    { id: 'pastry', group: 'creamy_dessert', ar: 'معجنات/كيك', stems: ['пирог', 'бисквит', 'вафл', 'суфле', 'торт', 'waffle', 'pastry', 'cake'] },
    { id: 'honey', group: 'creamy_dessert', ar: 'عسل', stems: ['медов', 'honey'], words: ['мед', 'меда', 'медом'] },
    { id: 'candy', group: 'confection', ar: 'سكاكر', stems: ['леденц', 'конфет', 'чупа', 'candy', 'lollipop'] },
    { id: 'chewing_gum', group: 'confection', ar: 'علكة', stems: ['жвачк', 'жеватель', 'bubblegum'], words: ['gum'] },
    { id: 'almond', group: 'nut', ar: 'لوز', stems: ['миндал', 'almond'] },
    { id: 'nut', group: 'nut', ar: 'مكسرات', stems: ['орех', 'фундук', 'hazelnut'], words: ['nut', 'nuts'] },
    { id: 'popcorn', group: 'other', ar: 'فشار', stems: ['попкорн', 'popcorn'] },
    { id: 'saffron', group: 'spice', ar: 'زعفران', stems: ['шафран', 'saffron'] },
    { id: 'masala', group: 'spice', ar: 'مسالا', stems: ['масал', 'masala'] },
    { id: 'cardamom', group: 'spice', ar: 'هيل', stems: ['кардамон', 'cardamo'] },
    { id: 'cinnamon', group: 'spice', ar: 'قرفة', stems: ['кориц', 'cinnamon'] },
    { id: 'spice', group: 'spice', ar: 'توابل', stems: ['пряност', 'пряны', 'пряна', 'пряно', 'spic'] },
    { id: 'tea', group: 'tea', ar: 'شاي', words: ['чай', 'чая', 'чаем', 'чаю', 'tea', 'תה'] },
    { id: 'oolong', group: 'tea', ar: 'أولونغ', stems: ['улун', 'oolong'] },
    { id: 'coffee', group: 'beverage', ar: 'قهوة', stems: ['кофе', 'coffee'] },
    { id: 'cola', group: 'beverage', ar: 'كولا', words: ['кола', 'колы', 'колой', 'cola'] },
    { id: 'soda', group: 'beverage', ar: 'صودا', stems: ['газиров'], words: ['soda'] },
    { id: 'energy_drink', group: 'beverage', ar: 'مشروب طاقة', stems: ['энергетич'], words: ['energy'] },
    { id: 'juice', group: 'style', ar: 'عصير', words: ['сок', 'сока', 'соком', 'juice'] },
    { id: 'lemonade', group: 'beverage', ar: 'ليموناضة', stems: ['лимонад', 'lemonade'] },
    { id: 'cocktail', group: 'style', ar: 'كوكتيل', stems: ['коктейл', 'cocktail'] },
    { id: 'liqueur', group: 'alcohol_flavor', ar: 'ليكيور', stems: ['ликер', 'liqueur'] },
    { id: 'gin', group: 'alcohol_flavor', ar: 'جن', words: ['джин', 'джина', 'джином', 'gin'] },
    { id: 'whisky', group: 'alcohol_flavor', ar: 'ويسكي', stems: ['виски', 'whisk'] },
    { id: 'wine', group: 'alcohol_flavor', ar: 'نبيذ', words: ['вино', 'вина', 'вином', 'винный', 'винная', 'винное', 'винного', 'винной', 'wine'] },
    { id: 'mint', group: 'herbal', ar: 'نعناع', stems: ['мят', 'mint'] },
    { id: 'basil', group: 'herbal', ar: 'ريحان', stems: ['базилик', 'basil'] },
    { id: 'fir', group: 'herbal', ar: 'صنوبريات', stems: ['елк', 'елов', 'хвой'], words: ['fir', 'pine'] },
    { id: 'eucalyptus', group: 'herbal', ar: 'أوكالبتوس', stems: ['эвкалипт', 'eucalypt'] },
    { id: 'cooling', group: 'cooling', ar: 'برودة', stems: ['холод', 'cool', 'ледян', 'ментол', 'menthol', 'frost', 'arctic'], words: ['лед', 'льда', 'льдом', 'ice', 'iced', 'icy', 'cold', 'frozen'] },
    { id: 'sweet', group: 'taste_attribute', ar: 'حلو', stems: ['сладк', 'sweet'] },
    { id: 'sour', group: 'taste_attribute', ar: 'حامض', stems: ['кисл', 'sour'] },
    { id: 'astringent', group: 'taste_attribute', ar: 'قابض', stems: ['вяжущ', 'astring'] },
    { id: 'tart', group: 'taste_attribute', ar: 'لاذع', stems: ['терпк', 'tart'] },
    { id: 'bitter', group: 'taste_attribute', ar: 'مرارة', stems: ['горчинк', 'гореч', 'горьк', 'bitter'] },
    { id: 'refreshing', group: 'taste_attribute', ar: 'منعش', stems: ['освеж', 'refresh'] },
    { id: 'mix', group: 'mix_marker', ar: 'مزيج', stems: ['микс', 'смес', 'сочетан', 'blend'], words: ['mix', 'תערובת'] },
];
export function tokenize(text) {
    const t = text.toLowerCase().replace(/ё/g, 'е').replace(/\bice[\s-]+cream/g, 'icecream');
    return t.match(/\p{L}+/gu) ?? [];
}
/** Deterministic: same excerpt → same hits, ordered by lexicon order. One hit per descriptor. */
export function extractDescriptors(excerpt) {
    const tokens = tokenize(excerpt);
    const hits = [];
    for (const e of LEXICON) {
        const tok = tokens.find((t) => (e.words ?? []).includes(t) || (e.stems ?? []).some((s) => t.startsWith(s)));
        if (tok)
            hits.push({ id: e.id, group: e.group, ar: e.ar, matchedToken: tok });
    }
    return hits;
}
/** Groups that carry a flavor component (excludes taste attributes, style words, cooling and mix markers). */
const COMPONENT_GROUPS = new Set(['fruit', 'berry', 'citrus', 'tropical', 'floral', 'creamy_dessert', 'confection', 'nut', 'herbal', 'spice', 'tea', 'beverage', 'alcohol_flavor', 'other']);
/**
 * Does the description name more than one flavor component (a hint that the product
 * is itself a blend)? An explicit "mix/blend" word counts as several. This is a
 * reading of the text only — it says nothing about how the product tastes.
 */
export function multiNoteSignal(hits) {
    if (hits.some((h) => h.group === 'mix_marker'))
        return 'description_names_several_components';
    const components = new Set(hits.filter((h) => COMPONENT_GROUPS.has(h.group)).map((h) => h.id));
    // A generic "tropical"/"berry"/"floral" word next to a specific one of the same group is one component.
    for (const [generic, group] of [['tropical', 'tropical'], ['berry', 'berry'], ['floral', 'floral'], ['citrus', 'citrus'], ['spice', 'spice']]) {
        if (components.has(generic) && hits.some((h) => h.group === group && h.id !== generic))
            components.delete(generic);
    }
    // "creamy ice cream" is one component; so is "lemon(ade)" (the lemon stem also matches lemonade).
    if (components.has('ice_cream'))
        components.delete('cream');
    if (components.has('lemonade'))
        components.delete('lemon');
    if (components.size >= 2)
        return 'description_names_several_components';
    if (components.size === 1)
        return 'description_names_one_component';
    return 'no_component_named';
}
