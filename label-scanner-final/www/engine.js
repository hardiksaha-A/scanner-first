// Rule-based ingredient analysis. No AI, no network. Works in browser and Node.
(function (root) {
  'use strict';
  const rows = (typeof module !== 'undefined' && module.exports) ? require('./ingredients.js') : root.INGREDIENT_ROWS;
  const HAZ = { L: 'low', M: 'moderate', H: 'high' };
  const IGNORE = new Set(['preservative', 'preservatives', 'colour', 'colours', 'color', 'colors', 'emulsifier', 'emulsifiers',
    'antioxidant', 'antioxidants', 'stabiliser', 'stabilizer', 'stabilisers', 'stabilizers', 'acidity regulator', 'acidity regulators',
    'thickener', 'thickeners', 'sweetener', 'sweeteners', 'and', 'contains', 'ingredients', 'class ii preservative']);

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function norm(s) {
    return String(s).toLowerCase()
      .replace(/\b(e|ins)[\s-]?(\d{3,4}[a-z]?)\b/g, 'e$2')
      .replace(/[^a-z0-9\s'&.-]/g, ' ').replace(/\s+/g, ' ')
      .replace(/^[\s.\-]+|[\s.\-]+$/g, '');
  }

  const DB = rows.map(r => {
    const [name, al, score, h, note, alg] = r.split('|');
    return { name, aliases: [name].concat(al ? al.split(';') : []), score: +score, hazard: HAZ[h], note: note || '', allergens: alg ? alg.split(',') : [] };
  });
  const INDEX = new Map(), LIST = [];
  DB.forEach(e => e.aliases.forEach(a => {
    a = norm(a); if (!a) return;
    INDEX.set(a, e); LIST.push([a, e, new RegExp('(^| )' + esc(a) + '( |$)')]);
  }));
  LIST.sort((x, y) => y[0].length - x[0].length);

  function extractSection(text) {
    let t = String(text || '').replace(/\r/g, ' ').replace(/\n+/g, ' ');
    const m = t.search(/ingredients?\s*[:\-]/i);
    if (m >= 0) t = t.slice(m).replace(/^ingredients?\s*[:\-]/i, '');
    const e = t.search(/(may contain|contains\s*:|allergen|nutrition|manufactured|marketed|best before|storage|mfd)/i);
    if (e > 0) t = t.slice(0, e);
    // claims such as "gluten free" or "does not contain milk" are not ingredients
    return t.replace(/\b(\w+[\s-]free\b|free (from|of) [\w\s]+?(?=[.,;]|$)|(does not|doesn.t) contain [\w\s]+?(?=[.,;]|$)|without [\w\s]+?(?=[.,;]|$))/gi, ' ');
  }
  function split(t) {
    return t.replace(/\d+(\.\d+)?\s*%/g, ' ').split(/[,;()\[\]{}:\u2022]|\.(?!\d)|\s[-\u2013]\s/).map(norm).filter(x => x && x.length > 1);
  }
  function lev(a, b, max) { // edit distance, gives up above max
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) { const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < best) best = cur[j]; }
      if (best > max) return max + 1; prev = cur; }
    return prev[b.length];
  }
  function fuzzyKeys(tok, keys) { // closest key allowing for OCR slips; null if none or ambiguous
    if (tok.length < 6) return null; const max = tok.length <= 8 ? 1 : 2; let best = null, bd = max + 1, tie = false;
    for (const k of keys) { const d = lev(tok, k, max); if (d < bd) { bd = d; best = k; tie = false; } else if (d === bd && k !== best) tie = true; }
    return bd <= max && !tie ? best : null;
  }
  const KEYS = Array.from(INDEX.keys()).filter(k => k.length >= 6), IGN = Array.from(IGNORE).filter(k => k.length >= 6);
  function matchToken(tok) {
    if (INDEX.has(tok)) return INDEX.get(tok);
    if (/^\d{3,4}[a-i]?$/.test(tok) && INDEX.has('e' + tok)) return INDEX.get('e' + tok); // bare INS/E number, e.g. "319"
    const f = fuzzyKeys(tok, KEYS); if (f) return INDEX.get(f); // OCR slips first, so "edible vegetable oi" is not read as "vegetable"
    for (const [, e, re] of LIST) if (re.test(tok)) return e;
    return null;
  }

  // ---- allergy knowledge: what a user's word means when it appears on a label ----
  const TREE = ['almond', 'cashew', 'hazelnut', 'walnut', 'pistachio', 'pecan', 'macadamia', 'brazil nut', 'pine nut'];
  const GENERIC_NUTS = ['nuts', 'tree nut', 'tree nuts', 'mixed nuts'];
  const ALLERGY_TERMS = {
    milk: ['milk', 'dairy', 'lactose', 'casein', 'caseinate', 'whey', 'butter', 'cream', 'cheese', 'ghee', 'curd', 'yogurt', 'yoghurt', 'paneer', 'milk solids', 'skimmed milk'],
    peanut: ['peanut', 'peanuts', 'groundnut', 'groundnuts', 'arachis', 'monkey nut', 'nuts', 'mixed nuts'],
    nut: TREE.concat(GENERIC_NUTS, ['marzipan', 'nut']),
    gluten: ['gluten', 'wheat', 'barley', 'rye', 'malt', 'semolina', 'spelt', 'triticale', 'maida'],
    wheat: ['wheat', 'semolina', 'maida', 'spelt', 'durum'],
    egg: ['egg', 'eggs', 'albumen', 'albumin', 'mayonnaise', 'ovalbumin'],
    soy: ['soy', 'soya', 'soybean', 'soybeans', 'tofu', 'edamame'],
    sesame: ['sesame', 'tahini', 'gingelly'],
    fish: ['fish', 'anchovy', 'anchovies', 'salmon', 'tuna', 'cod'],
    shellfish: ['shellfish', 'shrimp', 'prawn', 'prawns', 'crab', 'lobster', 'crustacean', 'crustaceans', 'mollusc', 'molluscs', 'squid', 'oyster', 'clam', 'mussel'],
    mustard: ['mustard'], celery: ['celery'], lupin: ['lupin', 'lupine'],
    sulphite: ['sulphite', 'sulphites', 'sulfite', 'sulfites', 'sulphur dioxide', 'sulfur dioxide', 'metabisulphite']
  };
  TREE.forEach(n => { ALLERGY_TERMS[n] = [n, n + 's'].concat(GENERIC_NUTS); });
  const ALLERGY_ALIAS = { dairy: 'milk', lactose: 'milk', 'milk allergy': 'milk', groundnut: 'peanut', groundnuts: 'peanut', peanuts: 'peanut', nuts: 'nut', 'tree nut': 'nut', 'tree nuts': 'nut',
    eggs: 'egg', soya: 'soy', soybean: 'soy', sulphites: 'sulphite', sulfite: 'sulphite', sulfites: 'sulphite', 'shell fish': 'shellfish', seafood: 'shellfish', 'celiac': 'gluten', coeliac: 'gluten' };
  const FUZZY_OK = new Set(['peanut', 'sesame', 'cashew', 'almond', 'gluten', 'casein', 'shrimp', 'walnut', 'pecan', 'lupin', 'celery', 'hazelnut']);
  function termsFor(a) {
    a = String(a).toLowerCase().trim(); let k = ALLERGY_ALIAS[a] || a;
    if (!ALLERGY_TERMS[k] && /s$/.test(k) && ALLERGY_TERMS[k.slice(0, -1)]) k = k.slice(0, -1);
    return Array.from(new Set((ALLERGY_TERMS[k] || []).concat([a, a.replace(/s$/, '')]))).filter(t => t.length >= 3);
  }
  const MAY = /(may contain|might contain|can contain|could contain|traces? of|trace amounts?|manufactured (in|on|at)|made (in|on)|produced (in|on)|processed (in|on)|packed (in|on)|same (facility|factory|line|equipment)|shared (facility|equipment))/;
  function allergyScan(text, algs, found) {
    const hits = [], seen = new Set();
    const put = (allergy, kind, what, fuzzy) => { const k = allergy + '|' + kind; if (seen.has(k)) return; seen.add(k); hits.push({ allergy, kind, ingredient: what, fuzzy: !!fuzzy }); };
    const sentences = String(text || '').toLowerCase().split(/[.\n;|]+/);
    for (const a of algs) {
      const terms = termsFor(a);
      for (const x of found) if (x.allergens.some(t => terms.includes(t) || t.includes(a) || a.includes(t)) || terms.includes(x.name) || x.name.includes(a)) put(a, 'contains', x.name);
      for (const s of sentences) {
        if (!s.trim()) continue; const may = MAY.test(s), kind = may ? 'may' : 'contains';
        for (const t of terms) {
          const re = new RegExp('(^|[^a-z])' + esc(t) + '(s|es)?(?![a-z])', 'g'); let m;
          while ((m = re.exec(s))) {
            const start = m.index + m[1].length, before = s.slice(Math.max(0, start - 28), start), after = s.slice(m.index + m[0].length, m.index + m[0].length + 10);
            if (/(free from|free of|without|does not contain|doesn.t contain|no|not)\s+(\w+\s+){0,2}$/.test(before) || /^[\s-]*free/.test(after)) continue;
            put(a, kind, t);
          }
        }
        for (const w of s.match(/[a-z]{6,}/g) || []) for (const t of terms) {
          if (!(t.length >= 7 || FUZZY_OK.has(t)) || w === t) continue; const mx = t.length <= 8 ? 1 : 2;
          if (lev(w, t, mx) <= mx) put(a, kind, t + ' (possible misread: "' + w + '")', true);
        }
      }
    }
    return hits;
  }
  const SUGARS = new Set(['sugar', 'glucose syrup', 'high fructose corn syrup', 'dextrose', 'invert sugar', 'jaggery', 'fructose', 'brown sugar', 'maple syrup']);

  function analyze(text, profile) {
    const toks = split(extractSection(text));
    const seen = new Set(), found = [], unknown = [], order = [];
    for (const tok of toks) {
      if (IGNORE.has(tok) || fuzzyKeys(tok, IGN)) continue;
      let ents = [];
      const e = matchToken(tok);
      if (e) ents = [e];
      else if (/ and | & /.test(tok)) ents = tok.split(/ and | & /).map(p => matchToken(norm(p))).filter(Boolean);
      if (!ents.length) { if (!unknown.includes(tok)) { unknown.push(tok); order.push({ name: tok, s: 55, known: false }); } continue; }
      for (const x of ents) if (!seen.has(x.name)) { seen.add(x.name); found.push(Object.assign({}, x, { matched: tok })); order.push({ name: x.name, s: x.score, known: true }); }
    }
    const high = found.filter(x => x.hazard === 'high').length;
    const mod = found.filter(x => x.hazard === 'moderate').length;
    const total = found.length + unknown.length, coverage = total ? found.length / total : 0;
    let score = null, verdict = 'Not enough recognised ingredients to score', hazard = 'unknown', confidence = 'none';
    if (found.length && coverage >= 0.34) {
      // earlier ingredients weigh more (labels list the largest first); unrecognised ones count as neutral but less
      let sw = 0, sv = 0; order.forEach((o, i) => { const w = (1 / (1 + 0.2 * i)) * (o.known ? 1 : 0.6); sw += w; sv += w * o.s; });
      let sc = sv / sw - high * 8 - Math.min(mod, 5) * 2;
      const sp = order.map((o, i) => SUGARS.has(o.name) ? i : -1).filter(i => i >= 0);
      if (sp.length >= 3) sc -= 8;                                   // sugar hidden under several names
      if (sp.length && sp[0] === 0) sc = Math.min(sc, 39); else if (sp.length && sp[0] <= 2) sc = Math.min(sc, 49); // sugar is a main ingredient
      confidence = coverage >= 0.8 ? 'high' : coverage >= 0.5 ? 'medium' : 'low';
      if (confidence === 'low') sc = Math.min(sc, 69);               // never "Good" on thin evidence
      score = Math.round(Math.max(0, Math.min(100, sc)));
      verdict = score >= 75 ? 'Good' : score >= 50 ? 'Okay' : score >= 25 ? 'Poor' : 'Avoid';
      hazard = (high >= 1 || score < 35) ? 'high' : (score < 65 || mod >= 2) ? 'moderate' : 'low';
    }
    const algs = ((profile && profile.allergies) || []).map(a => String(a).toLowerCase().trim()).filter(a => a.length >= 3);
    const warnings = algs.length ? allergyScan(text, algs, found) : [];
    const readable = String(text || '').trim().length >= 15 && total >= 2 && coverage >= 0.6;
    const allergyStatus = !algs.length ? 'none' : warnings.some(w => w.kind === 'contains') ? 'match' : warnings.length ? 'traces' : readable ? 'clear' : 'unverified';
    return { found, unknown, score, verdict, hazard, high, moderate: mod, warnings, coverage, confidence, allergyStatus };
  }

  const api = { analyze, termsFor, extractSection, split, norm, DB_SIZE: DB.length };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
