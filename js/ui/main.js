/** v2 app entry: boot, hash router, bottom navigation (thumb zone), service worker. */
import { App } from "./app.js";
import { append, clear, closeAllSheets, h, icon, toast } from "./dom.js";
import { homeView } from "./views/home.js";
import { createView } from "./views/create.js";
import { resultsView } from "./views/results.js";
import { libraryView, productView } from "./views/library.js";
import { recipesView, recipeView } from "./views/recipes.js";
import { inventoryView } from "./views/inventory.js";
import { applyTheme, dataView } from "./views/data.js";
import { errorText } from "./views/shared.js";
import { isSingleFile } from "./env.js";
const ROUTES = {
    '': { view: homeView, tab: 'home', title: 'الرئيسية' },
    create: { view: createView, tab: 'create', title: 'ولّد' },
    results: { view: resultsView, tab: 'create', title: 'الاقتراحات' },
    library: { view: libraryView, tab: 'library', title: 'المكتبة' },
    product: { view: productView, tab: 'library', title: 'منتج' },
    recipes: { view: recipesView, tab: 'recipes', title: 'وصفاتي' },
    recipe: { view: recipeView, tab: 'recipes', title: 'وصفة' },
    inventory: { view: inventoryView, tab: 'inventory', title: 'المخزون' },
    data: { view: dataView, tab: 'data', title: 'البيانات' },
};
const TABS = [
    ['home', '#/', 'الرئيسية'], ['library', '#/library', 'المكتبة'], ['create', '#/create?new=1', 'ولّد'], ['recipes', '#/recipes', 'وصفاتي'], ['inventory', '#/inventory', 'المخزون'],
];
async function boot() {
    const app = new App();
    applyTheme(app.prefs()['theme'] ?? 'auto');
    const main = document.getElementById('main');
    const nav = document.getElementById('tabs');
    const dataBtn = document.getElementById('data-link');
    document.getElementById('skip')?.addEventListener('click', (e) => { e.preventDefault(); main.focus(); });
    main.setAttribute('aria-busy', 'true');
    let embeddedLoaded = false;
    try {
        await app.open();
        embeddedLoaded = await app.loadEmbeddedIfEmpty();
    }
    catch (e) {
        append(main, h('p', { class: 'error-text', role: 'alert' }, `تعذّر فتح التخزين: ${errorText(e)}`));
        return;
    }
    let renders = 0;
    const render = async () => {
        const [rawPath, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
        const path = (rawPath ?? '').split('/').filter(Boolean);
        const route = ROUTES[path[0] ?? ''] ?? ROUTES[''];
        const go = app.hasData ? route : ROUTES['data'];
        closeAllSheets();
        clear(main);
        main.setAttribute('aria-busy', 'true');
        try {
            await go.view(app, main, new URLSearchParams(query), path);
        }
        catch (e) {
            append(main, h('p', { class: 'error-text', role: 'alert' }, `حدث خطأ: ${errorText(e)}`));
        }
        main.setAttribute('aria-busy', 'false');
        main.dataset['render'] = String(++renders); // lets tests (and assistive tech hooks) know a screen finished rendering
        document.title = `${go.title} · مِزاج v2`;
        for (const a of nav.querySelectorAll('a')) {
            if (a.dataset['tab'] === go.tab)
                a.setAttribute('aria-current', 'page');
            else
                a.removeAttribute('aria-current');
        }
        if (go.tab === 'data')
            dataBtn.setAttribute('aria-current', 'page');
        else
            dataBtn.removeAttribute('aria-current');
        (main.querySelector('h1') ?? main).focus({ preventScroll: true });
        window.scrollTo(0, 0);
    };
    clear(nav);
    for (const [tab, href, label] of TABS) {
        nav.append(h('a', { href, class: `tab${tab === 'create' ? ' tab-primary' : ''}`, data: { tab } }, icon(tab), h('span', { class: 'tab-label' }, label)));
    }
    window.addEventListener('hashchange', () => { void render(); });
    await render();
    if (embeddedLoaded)
        toast('حُمّلت بياناتك المضمّنة في هذا الملف.');
    if (!isSingleFile() && 'serviceWorker' in navigator && location.protocol !== 'file:') {
        navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
            reg.addEventListener('updatefound', () => {
                const w = reg.installing;
                w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller)
                    toast('نسخة أحدث جاهزة؛ أعد فتح التطبيق لاستخدامها.'); });
            });
        }).catch(() => toast('العمل بلا اتصال غير متاح في هذا المتصفح.', 'warn'));
    }
    if (!app.persistent) {
        toast(isSingleFile() && embeddedLoaded
            ? 'هذا المتصفح لا يسمح بالحفظ لهذا الملف: الاقتراحات تعمل من البيانات المضمّنة، لكن ما تحفظه يضيع عند الإغلاق. صدّر نسخة احتياطية قبل الإغلاق.'
            : 'التخزين الدائم غير متاح في هذا المتصفح؛ لن تُحفظ البيانات.', 'warn');
    }
    window.__mizajApp = app;
}
void boot();
