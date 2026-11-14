// Nutrition assessment per 100 g / 100 ml. Rule-based (UK front-of-pack thresholds). No AI.
(function (root) {
  'use strict';
  const FOOD = { fat: [3, 17.5], sat: [1.5, 5], sugars: [5, 22.5], salt: [0.3, 1.5] };
  const DRINK = { fat: [1.5, 8.75], sat: [0.75, 2.5], sugars: [2.5, 11.25], salt: [0.3, 1.5] };
  const PEN = { high: { fat: 10, sat: 25, sugars: 30, salt: 25 }, medium: { fat: 4, sat: 8, sugars: 10, salt: 10 } };
  const RANK = { low: 1, moderate: 2, high: 3 };
  const has = v => typeof v === 'number' && isFinite(v);
  const isDrink = q => /\b\d+([.,]\d+)?\s*(ml|cl|l|litres?|liters?|fl\.?\s?oz)\b/i.test(String(q || ''));
  function level(th, k, v) { if (!has(v) || !th[k]) return null; return v <= th[k][0] ? 'low' : v > th[k][1] ? 'high' : 'medium'; }

  function assess(n, opts) {
    n = n || {};
    const drink = !!(opts && opts.drink), th = drink ? DRINK : FOOD, unit = drink ? 'ml' : 'g';
    const keys = ['fat', 'sat', 'sugars', 'salt'];
    if (!has(n.kcal) && keys.every(k => !has(n[k]))) return null;
    const defs = [['fat', 'Fat'], ['sat', 'Saturated fat'], ['sugars', 'Sugars'], ['salt', 'Salt'], ['carbs', 'Carbohydrates'], ['fibre', 'Fibre'], ['protein', 'Protein']];
    const rows = [];
    defs.forEach(([k, label]) => { if (has(n[k])) rows.push({ key: k, label, value: Math.round(n[k] * 10) / 10, level: level(th, k, n[k]) }); });
    let s = 100;
    keys.forEach(k => { const lv = level(th, k, n[k]); if (lv === 'high' || lv === 'medium') s -= PEN[lv][k]; });
    if (drink && has(n.sugars) && n.sugars >= 5) s -= 40 - PEN[level(th, 'sugars', n.sugars)].sugars;
    if (has(n.kcal)) s -= n.kcal > 400 ? 10 : n.kcal > 250 ? 4 : 0;
    if (has(n.fibre)) s += n.fibre >= 6 ? 8 : n.fibre >= 3 ? 4 : 0;
    if (has(n.protein) && n.protein >= 10) s += 6;
    s = Math.max(0, Math.min(100, Math.round(s)));

    const per = '100 ' + unit, fx = [];
    if (level(th, 'sat', n.sat) === 'high') fx.push('High in saturated fat: regular intake can raise LDL ("bad") cholesterol and heart-disease risk.');
    if (level(th, 'sugars', n.sugars) === 'high') fx.push('High in sugar: can spike blood sugar and, eaten often, adds to weight gain, tooth decay and diabetes risk.');
    else if (drink && has(n.sugars) && n.sugars >= 5) fx.push('Sugary drink: liquid sugar is easy to over-consume and is linked to weight gain and diabetes.');
    if (level(th, 'salt', n.salt) === 'high') fx.push('High in salt: regular excess can raise blood pressure.');
    if (level(th, 'fat', n.fat) === 'high' && level(th, 'sat', n.sat) !== 'high') fx.push('High in total fat, so it is energy-dense.');
    if (has(n.kcal) && n.kcal > 400) fx.push('Energy-dense (' + Math.round(n.kcal) + ' kcal per ' + per + '): easy to overeat, so keep portions small.');
    if (has(n.fibre) && n.fibre >= 6) fx.push('Good fibre content: helps digestion and keeps you fuller.');
    if (has(n.protein) && n.protein >= 10) fx.push('Good protein source.');
    if (!fx.length) fx.push('No major nutrition concerns per ' + per + '.');
    return { score: s, level: s < 35 ? 'high' : s < 65 ? 'moderate' : 'low', rows, kcal: has(n.kcal) ? Math.round(n.kcal) : null, unit, effects: fx };
  }
  function overall(ing, nut) {
    const a = has(ing), b = has(nut);
    return a && b ? Math.round(0.6 * ing + 0.4 * nut) : a ? ing : b ? nut : null;
  }
  function worst(a, b) {
    const x = RANK[a] || 0, y = RANK[b] || 0, m = Math.max(x, y);
    return m === 3 ? 'high' : m === 2 ? 'moderate' : m === 1 ? 'low' : 'unknown';
  }
  function verdict(s) { return !has(s) ? 'No data' : s >= 75 ? 'Good' : s >= 50 ? 'Okay' : s >= 25 ? 'Poor' : 'Avoid'; }
  function perServing(kcal, serving) {
    const m = /(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i.exec(String(serving || ''));
    return has(kcal) && m ? Math.round(kcal * parseFloat(m[1].replace(',', '.')) / 100) : null;
  }
  // Reads a nutrition table from OCR or pasted text. Assumes the first number on each line is per 100 g.
  function parseNutrition(text) {
    const o = { kcal: null, fat: null, sat: null, carbs: null, sugars: null, fibre: null, protein: null, salt: null };
    let sodium = null, count = 0;
    const first = s => { const m = /(\d+(?:[.,]\d+)?)/.exec(s || ''); return m ? parseFloat(m[1].replace(',', '.')) : null; };
    const set = (k, v, max) => { if (v !== null && v >= 0 && v <= max && o[k] === null) { o[k] = Math.round(v * 100) / 100; count++; } };
    String(text || '').split(/\r?\n/).forEach(raw => {
      const l = raw.toLowerCase().replace(/\s+/g, ' ');
      if (/^\s*ingredients?/.test(l) || (l.match(/,/g) || []).length >= 3) return;
      const l2 = l.replace(/\([^)]*\)/g, ' ');
      const tail = re => { const m = re.exec(l2); return m ? l2.slice(m.index + m[0].length) : null; };
      if (/energy|calorie|kcal/.test(l)) {
        const kc = /(\d+(?:[.,]\d+)?)\s*kcal/.exec(l), kj = /(\d+(?:[.,]\d+)?)\s*kj/.exec(l);
        if (kc) set('kcal', parseFloat(kc[1].replace(',', '.')), 900);
        else if (kj) set('kcal', Math.round(parseFloat(kj[1].replace(',', '.')) / 4.184), 900);
        else { const v = first(tail(/energy|calories?/)); if (v !== null) set('kcal', /\bkj\b/.test(l) && !/kcal/.test(l) ? Math.round(v / 4.184) : v, 900); }
      }
      if (/unsaturat/.test(l)) { /* ignore mono/poly-unsaturated lines */ }
      else if (/saturat|sat\.? fat/.test(l)) set('sat', first(tail(/saturat\w*( fat(ty acids)?)?|sat\.? fat/)), 100);
      else if (/trans/.test(l)) { /* ignore trans fat */ }
      else if (/(^|\s)(total )?fat\b/.test(l2) && !/low fat|fat free/.test(l)) set('fat', first(tail(/(total )?fat\b/)), 100);
      if (/carbohydrate|carbs/.test(l)) { const t = tail(/carbohydrates?|carbs/); if (t !== null) set('carbs', first(t.split(/of which|sugar/)[0]), 100); }
      if (/sugar/.test(l) && !/added|no sugar|sugar free|sugar-free/.test(l)) set('sugars', first(tail(/sugars?/)), 100);
      if (/fib(re|er)/.test(l)) set('fibre', first(tail(/(dietary )?fib(re|er)/)), 100);
      if (/protein/.test(l)) set('protein', first(tail(/proteins?/)), 100);
      if (/salt/.test(l) && !/salted|saltin/.test(l)) { const v = first(tail(/salt/)); if (v !== null) set('salt', /\bmg\b/.test(l) ? v / 1000 : v, 30); }
      if (/sodium/.test(l) && sodium === null) { const v = first(tail(/sodium/)); if (v !== null) sodium = (/\bmg\b/.test(l) || v > 20) ? v / 1000 : v; }
    });
    if (o.salt === null && sodium !== null) set('salt', sodium * 2.5, 30);
    return Object.assign(o, { count });
  }
  const api = { parseNutrition, assess, overall, worst, verdict, perServing, isDrink };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Nutrition = api;
})(typeof window !== 'undefined' ? window : globalThis);
