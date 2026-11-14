// Phase 4 logic: local storage (history, favorites, feedback), expectation check, comparison, spoken summary. No AI.
(function (root) {
  'use strict';
  const has = v => typeof v === 'number' && isFinite(v);
  function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  function createStore(ls) {
    const rd = (k, d) => { try { const v = JSON.parse(ls.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
    const wr = (k, v) => { try { ls.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
    return {
      history: () => rd('ls.history', []),
      addHistory(e) { const h = rd('ls.history', []).filter(x => x.key !== e.key); h.unshift(Object.assign({ time: Date.now() }, e)); wr('ls.history', h.slice(0, 50)); },
      clearHistory() { wr('ls.history', []); },
      favorites: () => rd('ls.fav', []),
      isFav: key => rd('ls.fav', []).some(x => x.key === key),
      toggleFav(e) {
        let f = rd('ls.fav', []); const had = f.some(x => x.key === e.key);
        f = had ? f.filter(x => x.key !== e.key) : [Object.assign({ time: Date.now() }, e)].concat(f);
        wr('ls.fav', f.slice(0, 100)); return !had;
      },
      addFeedback(r) { const a = rd('ls.feedback', []); a.push(Object.assign({ time: Date.now() }, r)); wr('ls.feedback', a); return a.length; },
      feedback: () => rd('ls.feedback', []),
      exportFeedback() {
        return rd('ls.feedback', []).map(r => new Date(r.time).toISOString() + ' | ' + r.type + (r.rating ? ' | rating ' + r.rating + '/5' : '') +
          (r.product ? ' | product: ' + r.product : '') + (r.text ? '\n  ' + r.text.replace(/\n/g, '\n  ') : '')).join('\n\n');
      }
    };
  }

  function snapshot(c, score, hazard) {
    const { product, ing, nut } = c, rows = {};
    if (nut) nut.rows.forEach(r => { rows[r.key] = r.value; });
    const text = product ? '' : (c.text || '');
    const top = ing ? ing.found.slice(0, 3).map(x => x.name).join(', ') : '';
    const g = k => has(rows[k]) ? rows[k] : null;
    return {
      key: product && product.barcode ? product.barcode : 'text-' + hash(text.toLowerCase().replace(/\s+/g, ' ').trim()),
      name: product ? product.name : 'Scanned label' + (top ? ' (' + top + ')' : ''),
      product: product || null, text, score, hazard,
      ingScore: ing ? ing.score : null, nutScore: nut ? nut.score : null,
      high: ing ? ing.found.filter(x => x.hazard === 'high').length : null,
      n: { kcal: nut ? nut.kcal : null, sugars: g('sugars'), sat: g('sat'), salt: g('salt'), fibre: g('fibre'), protein: g('protein') }
    };
  }

  const METRICS = [['Overall score', s => s.score, 1], ['Ingredient score', s => s.ingScore, 1], ['Nutrition score', s => s.nutScore, 1],
    ['High-hazard ingredients', s => s.high, -1], ['Calories (kcal per 100 g)', s => s.n.kcal, -1], ['Sugars (g)', s => s.n.sugars, -1],
    ['Saturated fat (g)', s => s.n.sat, -1], ['Salt (g)', s => s.n.salt, -1], ['Fibre (g)', s => s.n.fibre, 1], ['Protein (g)', s => s.n.protein, 1]];
  function compare(a, b) {
    const rows = METRICS.map(([label, get, dir]) => {
      const x = get(a), y = get(b);
      return { label, a: has(x) ? x : null, b: has(y) ? y : null, better: has(x) && has(y) && x !== y ? ((x - y) * dir > 0 ? 'a' : 'b') : null };
    });
    let winner = 'tie', summary = 'The two products look similar overall.';
    if (has(a.score) && has(b.score) && Math.abs(a.score - b.score) >= 3) {
      winner = a.score > b.score ? 'a' : 'b';
      const w = winner === 'a' ? a : b, l = winner === 'a' ? b : a;
      summary = w.name + ' looks like the better choice (' + w.score + ' vs ' + l.score + ' out of 100).';
    }
    return { rows, winner, summary };
  }

  // ---- "Is this what you expected?" ----
  const ADDED = ['sugar', 'glucose syrup', 'high fructose corn syrup', 'dextrose', 'maltodextrin', 'invert sugar'];
  const PRES = ['sodium benzoate', 'potassium sorbate', 'calcium propionate', 'sodium nitrite', 'sodium nitrate', 'sulphur dioxide', 'sodium metabisulphite', 'bha', 'bht', 'tbhq'];
  const DYES = ['tartrazine', 'sunset yellow', 'allura red', 'carmoisine', 'ponceau 4r', 'quinoline yellow', 'brilliant blue', 'artificial colour'];
  const SWEET = ['aspartame', 'acesulfame potassium', 'sucralose', 'saccharin'];
  const NOING = [null, 'No ingredient list available to check'];
  const absent = (i, list) => { if (!i.hasIng) return NOING; const f = list.filter(n => i.names.has(n)); return f.length ? [false, 'Contains ' + f.join(', ')] : [true, 'None found in the ingredient list']; };
  const allergen = list => (i, c) => {
    if (!i.hasIng && !i.alg.size) return NOING;
    const f = Array.from(i.alg).filter(t => list.some(l => t.includes(l)));
    return f.length ? [false, 'Contains or declares: ' + f.join(', ')] : [true, 'Not found in the ingredients or declared allergens'];
  };
  const amount = (k, test, text) => i => { const v = i.row(k); return v === undefined ? [null, 'No ' + k + ' amount listed'] : [test(v), text(v)]; };
  const CLAIMS = [
    [/(no|without) added sugars?|unsweetened/, 'No added sugar', i => absent(i, ADDED)],
    [/sugar[- ]?free|zero sugar|no sugar|0 sugar/, 'Sugar free', i => { const v = i.row('sugars'); return v === undefined ? absent(i, ADDED) : [v <= 0.5, v + ' g sugars per 100 g']; }],
    [/low[- ]sugar/, 'Low sugar', amount('sugars', v => v <= 5, v => v + ' g sugars per 100 g (low is 5 g or less)')],
    [/low[- ](salt|sodium)/, 'Low salt', amount('salt', v => v <= 0.3, v => v + ' g salt per 100 g (low is 0.3 g or less)')],
    [/low[- ]fat/, 'Low fat', amount('fat', v => v <= 3, v => v + ' g fat per 100 g (low is 3 g or less)')],
    [/low[- ]cal(orie)?s?/, 'Low calorie', i => i.kcal === null ? [null, 'No calorie amount listed'] : [i.kcal <= 40, i.kcal + ' kcal per 100 g (low is 40 or less)']],
    [/high[- ]protein/, 'High protein', amount('protein', v => v >= 10, v => v + ' g protein per 100 g')],
    [/high[- ]fib(re|er)/, 'High fibre', amount('fibre', v => v >= 6, v => v + ' g fibre per 100 g (high is 6 g or more)')],
    [/vegan/, 'Vegan', i => absent(i, ['milk', 'milk solids', 'butter', 'cheese', 'egg', 'gelatin', 'honey'])],
    [/vegetarian/, 'Vegetarian', i => absent(i, ['gelatin'])],
    [/(dairy|lactose|milk)[- ]free|no (dairy|milk)/, 'Dairy free', allergen(['milk', 'lactose'])],
    [/gluten[- ]free|no gluten/, 'Gluten free', allergen(['gluten', 'wheat'])],
    [/peanut[- ]free|no peanuts?/, 'Peanut free', allergen(['peanut'])],
    [/nut[- ]free|no nuts/, 'Nut free', allergen(['nut'])],
    [/egg[- ]free|no eggs?/, 'Egg free', allergen(['egg'])],
    [/(soy|soya)[- ]free|no (soy|soya)/, 'Soy free', allergen(['soy'])],
    [/no palm( oil)?|palm[- ]oil[- ]free/, 'No palm oil', i => absent(i, ['palm oil', 'palm kernel oil', 'hydrogenated palm oil'])],
    [/no preservatives?|preservative[- ]free|without preservatives?/, 'No preservatives', i => absent(i, PRES)],
    [/no (artificial )?colou?r(ing)?s?|colou?r[- ]free|no dyes?/, 'No artificial colours', i => absent(i, DYES)],
    [/no (artificial )?sweeteners?/, 'No artificial sweeteners', i => absent(i, SWEET)],
    [/no artificial flavou?rs?/, 'No artificial flavours', i => absent(i, ['artificial flavour'])],
    [/no msg|msg[- ]free/, 'No MSG', i => absent(i, ['monosodium glutamate'])],
    [/(no|zero|free of) trans fats?|trans[- ]fat[- ]free/, 'No trans fat', i => absent(i, ['hydrogenated palm oil'])],
    [/whole ?(grain|wheat)|multi ?grain/, 'Whole grain', i => !i.hasIng ? NOING : (i.names.has('whole wheat flour') || i.names.has('oats')) ? [true, 'Whole grain ingredient found'] : [false, 'No whole grain ingredient found']],
    [/healthy|good for you/, 'Healthy', (i, c) => c.overall === null || c.overall === undefined ? [null, 'No score available'] : [c.overall >= 65, 'Overall score ' + c.overall + ' out of 100 (65 or more counts as healthy)']],
    [/organic|non[- ]?gmo|halal|kosher/, 'Certification', () => [null, 'Cannot be checked from ingredients; look for a certification mark on the pack']]
  ];
  const STOP = new Set(['with', 'without', 'that', 'this', 'from', 'have', 'product', 'which', 'should', 'would', 'expect', 'expected', 'made', 'like', 'free', 'very', 'some', 'more', 'less', 'only', 'just', 'real', 'natural', 'something', 'thing', 'item', 'food']);
  function expectation(text, c) {
    let s = ' ' + String(text || '').toLowerCase() + ' ';
    const found = c.ing ? c.ing.found : [], alg = new Set();
    found.forEach(x => x.allergens.forEach(a => alg.add(a))); ((c.product && c.product.allergens) || []).forEach(a => alg.add(a));
    const i = { names: new Set(found.map(x => x.name)), alg, hasIng: found.length > 0, kcal: c.nut ? c.nut.kcal : null,
      row: k => { const r = c.nut ? c.nut.rows.find(x => x.key === k) : null; return r ? r.value : undefined; } };
    const items = [];
    CLAIMS.forEach(([re, claim, fn]) => { if (re.test(s)) { const [status, why] = fn(i, c); items.push({ claim, status, why }); s = s.replace(re, ' '); } });
    const words = s.split(/[^a-z]+/).filter(w => w.length >= 4 && !STOP.has(w));
    if (words.length) {
      const nameHay = c.product ? (c.product.name + ' ' + c.product.brand).toLowerCase() : '';
      const hay = nameHay + ' ' + ((c.product && c.product.ingredients) || c.text || '').toLowerCase();
      const stem = w => w.replace(/s$/, '');
      const inName = words.every(w => nameHay.includes(stem(w))), inAny = words.every(w => hay.includes(stem(w)));
      items.push({ claim: words.join(' '), status: inName || inAny ? true : null,
        why: inName ? 'Matches the product name' : inAny ? 'Mentioned in the name or ingredients' : 'Not found in the name or ingredients, so it cannot be confirmed' });
    }
    const verdict = items.some(x => x.status === false) ? 'mismatch' : items.some(x => x.status === true) ? 'match' : 'unknown';
    return { verdict, items, unconfirmed: items.filter(x => x.status === null).length };
  }

  function speech(v) {
    const p = [], name = v.product ? v.product.name : 'This label';
    if (has(v.score)) p.push(name + '. Overall score ' + v.score + ' out of 100, ' + String(v.verdict).toLowerCase() + '. Hazard level ' + v.hazard + '.');
    (v.warnings || []).forEach(w => p.push('Allergy warning: this product ' + w.text + '.'));
    if (v.nut && v.nut.kcal !== null) p.push('It has ' + v.nut.kcal + ' kilocalories per 100 ' + (v.nut.unit === 'ml' ? 'millilitres' : 'grams') + '.');
    if (v.adv) {
      const st = { avoid: 'better to avoid', limit: 'limit it', ok: 'no concerns found' }[v.adv.status];
      p.push('For you: ' + st + '.');
      v.adv.mine.filter(g => g.status !== 'ok').slice(0, 2).forEach(g => p.push(g.label + ': ' + g.reasons[0]));
      p.push('Suggested: ' + v.adv.rec);
    }
    p.push('This is general guidance, not medical advice.');
    return p.join(' ');
  }

  function pickAlternatives(cur, snaps) {
    return snaps.filter(s => s.key !== cur.key && has(s.score)).sort((x, y) => y.score - x.score).slice(0, 6)
      .map(s => Object.assign({}, s, { better: has(cur.score) && s.score >= cur.score + 3 }));
  }
  const api = { createStore, snapshot, compare, expectation, speech, pickAlternatives };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Features = api;
})(typeof window !== 'undefined' ? window : globalThis);
