// Language support. English text in the page is the key; a language pack maps English -> translation.
// To add a language: copy lang/_example.js to lang/xx.js, translate the strings (see lang/TEMPLATE.json), then add
// <script src="lang/xx.js"></script> next to the other language packs in index.html. No other code changes needed.
(function (root) {
  'use strict';
  const KEY = 'labelscanner.lang', ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  const packs = { en: { native: 'English', dir: 'ltr', strings: {} } };
  const SOON = [['hi', 'हिन्दी (Hindi)'], ['es', 'Español (Spanish)'], ['fr', 'Français (French)'], ['ar', 'العربية (Arabic)'], ['pt', 'Português (Portuguese)'], ['bn', 'বাংলা (Bengali)'], ['de', 'Deutsch (German)'], ['zh', '中文 (Chinese)']];
  let cur = 'en'; const seen = new WeakMap();
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const t = s => { const p = packs[cur]; return (p && p.strings && has(p.strings, s) && p.strings[s]) || s; };
  const clean = s => String(s).replace(/\s+/g, ' ').trim();
  function nodes(el) {
    const out = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => /\S/.test(n.nodeValue) && !/^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
    while (w.nextNode()) out.push(w.currentNode); return out;
  }
  function applyTo(el) {
    if (!el || (el.nodeType !== 1 && el.nodeType !== 11)) return;
    nodes(el).forEach(n => {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(n.nodeValue); let o = seen.get(n);
      if (!o || o.shown !== n.nodeValue) o = { key: clean(m[2]), shown: n.nodeValue }; // new or changed by the app = English source
      const shown = m[1] + t(o.key) + m[3]; if (n.nodeValue !== shown) n.nodeValue = shown; o.shown = n.nodeValue; seen.set(n, o);
    });
    const all = el.querySelectorAll ? Array.from(el.querySelectorAll('*')) : [];
    if (el.nodeType === 1) all.push(el);
    all.forEach(e => ATTRS.forEach(a => {
      if (!e.hasAttribute(a)) return; const st = e.__i18n || (e.__i18n = {}), now = e.getAttribute(a);
      if (!st[a] || st[a].shown !== now) st[a] = { key: clean(now), shown: now };
      const v = t(st[a].key); if (v !== now) e.setAttribute(a, v); st[a].shown = e.getAttribute(a);
    }));
  }
  const fire = n => { try { document.dispatchEvent(new CustomEvent(n)); } catch (e) { /* ignore */ } };
  function setLang(code) {
    if (!has(packs, code)) code = 'en'; cur = code;
    const p = packs[code]; document.documentElement.lang = code; document.documentElement.dir = p.dir || 'ltr';
    try { localStorage.setItem(KEY, code); } catch (e) { /* storage unavailable */ }
    applyTo(document.body); fire('i18n:change'); return code;
  }
  function register(code, pack) { packs[code] = { native: pack.native || code, dir: pack.dir || 'ltr', strings: pack.strings || {} }; fire('i18n:packs'); }
  function list() {
    const out = Object.keys(packs).map(c => ({ code: c, native: packs[c].native, available: true }));
    SOON.forEach(s => { if (!has(packs, s[0])) out.push({ code: s[0], native: s[1], available: false }); }); return out;
  }
  function init() {
    let saved = 'en'; try { saved = localStorage.getItem(KEY) || 'en'; } catch (e) { /* ignore */ }
    setLang(saved);
    new MutationObserver(recs => { if (cur === 'en') return;
      recs.forEach(r => { if (r.type === 'characterData') applyTo(r.target.parentNode); else r.addedNodes.forEach(n => applyTo(n.nodeType === 3 ? n.parentNode : n)); });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  root.I18N = { t, setLang, register, list, init, getLang: () => cur };
})(typeof window !== 'undefined' ? window : globalThis);
