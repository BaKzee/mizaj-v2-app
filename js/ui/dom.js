/**
 * Tiny DOM helpers for the v2 UI (P3). Security rule (08_SECURITY §5, R4): no
 * innerHTML anywhere — every string becomes a text node, links accept only
 * http(s), relative and in-app (#) targets, and styles go through the CSSOM so a
 * strict Content-Security-Policy (no inline style/script) holds.
 */
const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'required', 'selected', 'multiple', 'readOnly']);
export function safeHref(url) {
    const u = url.trim();
    if (u.startsWith('#') || u.startsWith('./') || u.startsWith('../'))
        return u;
    try {
        const p = new URL(u, 'https://x.invalid/');
        if (p.protocol === 'https:' || p.protocol === 'http:')
            return /^[a-z]+:/i.test(u) ? p.href : u;
    }
    catch { /* fall through */ }
    return null;
}
/**
 * Names inside «…» are often Latin product names in an Arabic sentence; without isolation the
 * bidi algorithm reorders the guillemets and the words around them. FSI…PDI isolates each one.
 */
export function isolateQuoted(text) {
    return text.includes('«') ? text.replace(/«([^»\u2068]+)»/g, '«\u2068$1\u2069»') : text;
}
export function append(parent, ...children) {
    for (const c of children) {
        if (c === null || c === undefined || c === false)
            continue;
        if (Array.isArray(c))
            append(parent, ...c);
        else if (c instanceof Node)
            parent.appendChild(c);
        else
            parent.appendChild(document.createTextNode(isolateQuoted(String(c))));
    }
}
export function h(tag, attrs = null, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null || v === false)
                continue;
            if (k === 'class')
                el.className = String(v);
            else if (k === 'on')
                for (const [ev, fn] of Object.entries(v))
                    el.addEventListener(ev, fn);
            else if (k === 'data')
                for (const [dk, dv] of Object.entries(v))
                    el.dataset[dk] = dv;
            else if (k === 'href') {
                const s = safeHref(String(v));
                if (s)
                    el.setAttribute('href', s);
            }
            else if (k === 'style')
                throw new Error('use CSS classes or setStyle(); inline style attributes break the CSP');
            else if (k.startsWith('on'))
                throw new Error(`use attrs.on for ${k}`);
            else if (PROPS.has(k))
                el[k] = v;
            else if (k === 'for')
                el.setAttribute('for', String(v));
            else
                el.setAttribute(k, v === true ? '' : String(v));
        }
    }
    append(el, ...children);
    return el;
}
/** CSSOM only (allowed by `style-src 'self'`). */
export function setStyle(el, prop, value) {
    el.style.setProperty(prop, value);
}
export function clear(el) {
    while (el.firstChild)
        el.removeChild(el.firstChild);
}
/* ---------------------------- icons (no external assets) ---------------------------- */
const ICONS = {
    home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    library: 'M4 4h5v16H4zM10 4h4v16h-4zM15.5 4.6l3.9-1 4.1 15.5-3.9 1z',
    create: 'M12 2l2.2 6.3L21 9l-5.2 4.2L17.6 20 12 16.3 6.4 20l1.8-6.8L3 9l6.8-.7z',
    recipes: 'M5 3h11l3 3v15H5zM8 9h8M8 13h8M8 17h5',
    inventory: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
    data: 'M12 3c4.4 0 8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6c0-1.7 3.6-3 8-3zM4 6c0 1.7 3.6 3 8 3s8-1.3 8-3M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    close: 'M6 6l12 12M18 6 6 18',
    back: 'M9 5l7 7-7 7',
    info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v6M12 7.5v.5',
    swap: 'M7 7h12l-3-3M17 17H5l3 3',
    compare: 'M4 5h7v14H4zM13 5h7v14h-7z',
    save: 'M5 3h12l3 3v15H4V3zM8 3v6h8V3M8 21v-7h8v7',
    check: 'M5 12l5 5 9-10',
    warn: 'M12 3l10 18H2zM12 10v5M12 18v.5',
};
export function icon(name, label) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    if (label) {
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', label);
    }
    else
        svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', ICONS[name] ?? ICONS['info']);
    svg.appendChild(path);
    return svg;
}
/* ---------------------------- live region + toasts ---------------------------- */
export function announce(text) {
    const r = document.getElementById('live');
    if (!r)
        return;
    r.textContent = '';
    // a new text node is announced even if the text did not change
    window.setTimeout(() => { r.textContent = text; }, 30);
}
export function toast(text, kind = 'ok') {
    const host = document.getElementById('toasts');
    if (!host)
        return;
    const t = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
    host.appendChild(t);
    window.setTimeout(() => t.remove(), kind === 'error' ? 7000 : 2500);
}
/* ---------------------------- bottom sheet (thumb zone) ---------------------------- */
let openCount = 0;
const openSheets = new Set();
/** Route changes close every open sheet (a dialog never outlives its screen). */
export function closeAllSheets() {
    for (const c of [...openSheets])
        c();
}
export function openSheet(title, build, opts = {}) {
    const opener = document.activeElement;
    const titleId = `sheet-title-${++openCount}`;
    const backdrop = h('div', { class: 'sheet-backdrop' });
    const body = h('div', { class: 'sheet-body' });
    const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إغلاق' }, icon('close'));
    const sheet = h('div', { class: `sheet${opts.wide ? ' sheet-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, h('div', { class: 'sheet-head' }, h('h2', { id: titleId, class: 'sheet-title' }, title), closeBtn), body);
    let closed = false;
    const close = () => {
        if (closed)
            return;
        closed = true;
        openSheets.delete(close);
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        sheet.remove();
        document.body.classList.remove('sheet-open');
        opener?.focus?.();
    };
    const focusables = () => [...sheet.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null);
    const onKey = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
            return;
        }
        if (e.key !== 'Tab')
            return;
        const f = focusables();
        if (!f.length)
            return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        }
        else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    append(body, build(close));
    document.body.append(backdrop, sheet);
    document.body.classList.add('sheet-open');
    document.addEventListener('keydown', onKey, true);
    openSheets.add(close);
    (focusables()[1] ?? closeBtn).focus();
    return { close, root: sheet };
}
/** Download a text file (backup export). */
export function downloadText(filename, text, type = 'application/octet-stream') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: '#', download: filename });
    a.setAttribute('href', url);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function readFileText(file, maxBytes = 150 * 1024 * 1024) {
    if (file.size > maxBytes)
        return Promise.reject(new Error('الملف أكبر من المسموح'));
    return file.text();
}
