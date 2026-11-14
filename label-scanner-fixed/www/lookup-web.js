(function(){
// Barcode -> product data from Open Food Facts (runs in the Electron main process).
const isValidGtin = c => window.Barcode.isValidGtin(c);
const FIELDS = ['code', 'product_name', 'generic_name', 'brands', 'quantity', 'serving_size', 'ingredients_text',
  'ingredients_text_en', 'allergens_tags', 'traces_tags', 'nutriments', 'nutriscore_grade', 'nova_group', 'categories_tags'].join(',');
const within = (p, ms) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })]).finally(() => clearTimeout(t)); };
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

function normalizeProduct(p, code) {
  const n = p.nutriments || {};
  let salt = num(n.salt_100g);
  if (salt === null && num(n.sodium_100g) !== null) salt = Math.round(num(n.sodium_100g) * 2.5 * 100) / 100;
  let kcal = num(n['energy-kcal_100g']);
  if (kcal === null && num(n.energy_100g) !== null) kcal = Math.round(num(n.energy_100g) / 4.184);
  return {
    barcode: String(code || p.code || ''),
    name: p.product_name || p.generic_name || 'Unnamed product',
    brand: (p.brands || '').split(',')[0].trim(),
    quantity: p.quantity || '', serving: p.serving_size || '',
    ingredients: p.ingredients_text_en || p.ingredients_text || '',
    allergens: (p.allergens_tags || []).map(t => String(t).replace(/^[a-z]{2}:/, '')),
    traces: (p.traces_tags || []).map(t => String(t).replace(/^[a-z]{2}:/, '')),
    nutrition: { kcal, fat: num(n.fat_100g), sat: num(n['saturated-fat_100g']), carbs: num(n.carbohydrates_100g),
      sugars: num(n.sugars_100g), fibre: num(n.fiber_100g), protein: num(n.proteins_100g), salt },
    nutriscore: p.nutriscore_grade || '', nova: p.nova_group || null,
    categories: (p.categories_tags || []).filter(t => /^[a-z]{2}:[a-z0-9-]+$/.test(t)).slice(-3)
  };
}
function normalize(json) {
  if (!json || json.status !== 1 || !json.product) return null;
  return normalizeProduct(json.product, json.code);
}

async function fetchProduct(code, fetchImpl) {
  code = String(code || '').trim();
  if (!isValidGtin(code)) return { ok: false, reason: 'invalid' };
  const f = fetchImpl || fetch, ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await within(f('https://world.openfoodfacts.org/api/v2/product/' + code + '.json?fields=' + FIELDS,
      { headers: { 'User-Agent': 'LabelScanner/0.8 (Android app)' }, signal: ctl.signal }), 10000);
    if (res.status === 404) return { ok: false, reason: 'not_found' };
    if (!res.ok) return { ok: false, reason: 'network' };
    const product = normalize(await within(res.json(), 10000));
    return product ? { ok: true, product } : { ok: false, reason: 'not_found' };
  } catch (e) { return { ok: false, reason: 'network' }; }
  finally { clearTimeout(timer); }
}
// Products of the same type (most specific category first), from Open Food Facts.
async function findSimilar(tags, fetchImpl) {
  tags = (tags || []).filter(t => /^[a-z]{2}:[a-z0-9-]+$/.test(t)).slice(-2).reverse();
  if (!tags.length) return { ok: false, reason: 'none' };
  const f = fetchImpl || fetch, out = [], seen = new Set();
  let threw = 0;
  for (const tag of tags) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await within(f('https://world.openfoodfacts.org/api/v2/search?categories_tags=' + encodeURIComponent(tag) + '&fields=' + FIELDS + '&page_size=40&sort_by=popularity_key',
        { headers: { 'User-Agent': 'LabelScanner/0.8 (Android app)' }, signal: ctl.signal }), 12000);
      if (!res.ok) { threw++; continue; }
      for (const p of ((await within(res.json(), 12000)).products || [])) {
        const n = normalizeProduct(p, p.code);
        if (!n.name || n.name === 'Unnamed product' || !isValidGtin(n.barcode) || seen.has(n.barcode)) continue;
        if (!n.ingredients && n.nutrition.kcal === null) continue;
        seen.add(n.barcode); out.push(n);
      }
    } catch (e) { threw++; } finally { clearTimeout(timer); }
    if (out.length >= 15) break;
  }
  if (out.length) return { ok: true, products: out.slice(0, 40) };
  return { ok: false, reason: threw === tags.length ? 'network' : 'none' };
}
window.__lookup = { fetchProduct, normalize, findSimilar };

})();
