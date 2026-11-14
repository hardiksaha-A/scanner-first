// Personalised advice: who should avoid it, advice for the user's mode and conditions, and daily-use effects.
// Rule-based, no AI. General guidance only.
(function (root) {
  'use strict';
  const GROUPS = { kids: 'Children', pregnancy: 'Pregnant women', older: 'Older adults', diabetes: 'People with diabetes',
    bp: 'People with high blood pressure', heart: 'People with heart disease or high cholesterol', kidney: 'People with kidney disease',
    weight: 'People trying to lose weight', adult: 'Healthy adults' };
  const ORDER = ['kids', 'pregnancy', 'older', 'diabetes', 'bp', 'heart', 'kidney', 'weight', 'adult'];
  const DYES = ['tartrazine', 'sunset yellow', 'allura red', 'carmoisine', 'ponceau 4r', 'quinoline yellow', 'brilliant blue', 'artificial colour'];
  const SWEET = ['aspartame', 'acesulfame potassium', 'sucralose', 'saccharin'];
  const SODIUM = ['sodium benzoate', 'monosodium glutamate', 'sodium nitrite', 'sodium nitrate', 'disodium inosinate', 'sodium metabisulphite'];
  const ADDED = ['sugar', 'glucose syrup', 'high fructose corn syrup', 'dextrose', 'maltodextrin', 'invert sugar'];
  const REC = ['Fine every day as part of a varied diet.', 'Better as an occasional food: a few times a week at most.',
    'Keep to about once a week or less, in a small portion.', 'Best avoided. If you eat it, make it a rare treat.'];
  const j = a => a.join(', ');

  // [group, level, test(f), text or text(f)]
  const RULES = [
    ['diabetes', 'avoid', f => f.sugarHigh, 'High in sugar, which can spike blood glucose.'],
    ['diabetes', 'limit', f => f.sugarMed, 'Moderate sugar: watch the portion and count the carbohydrates.'],
    ['diabetes', 'limit', f => !f.hasNut && f.addedSugars.length > 0, f => 'Contains added sugars (' + j(f.addedSugars) + '); nutrition amounts are not available.'],
    ['bp', 'avoid', f => f.saltHigh, 'High in salt, which raises blood pressure.'],
    ['bp', 'limit', f => f.saltMed, 'Moderate salt: count it towards your daily limit.'],
    ['bp', 'limit', f => f.sodiumAdd.length > 0, f => 'Contains sodium-based additives (' + j(f.sodiumAdd) + ').'],
    ['bp', 'limit', f => f.caffeine, 'Caffeine can raise blood pressure.'],
    ['bp', 'avoid', f => f.liquorice, 'Liquorice can raise blood pressure.'],
    ['heart', 'avoid', f => f.trans, 'Contains hydrogenated fat (trans fat), which raises heart-disease risk.'],
    ['heart', 'avoid', f => f.satHigh, 'High in saturated fat, which raises LDL ("bad") cholesterol.'],
    ['heart', 'limit', f => f.satMed, 'Moderate saturated fat.'],
    ['heart', 'limit', f => f.nitr.length > 0, 'Contains nitrites, linked to heart and cancer risk in processed meat.'],
    ['heart', 'limit', f => f.saltHigh, 'High in salt.'],
    ['kidney', 'avoid', f => f.saltHigh, 'High in salt: weak kidneys struggle to clear extra sodium.'],
    ['kidney', 'limit', f => f.sodiumAdd.length > 0, 'Contains sodium-based additives.'],
    ['kidney', 'limit', f => f.protein !== null && f.protein >= 15, 'High in protein: some kidney conditions need protein limits. Ask your doctor.'],
    ['weight', 'limit', f => f.kcalHigh, 'Energy-dense: easy to overeat.'],
    ['weight', 'limit', f => f.sugarHigh, 'High in sugar, which adds calories without filling you up.'],
    ['weight', 'limit', f => f.fatHigh, 'High in fat, which is calorie-dense.'],
    ['kids', 'avoid', f => f.dyes.length > 0, f => 'Contains artificial colours (' + j(f.dyes) + '), linked to hyperactivity in some children.'],
    ['kids', 'avoid', f => f.benz, 'Contains sodium benzoate, linked to hyperactivity in children.'],
    ['kids', 'avoid', f => f.caffeine, 'Contains caffeine, which is not suitable for young children.'],
    ['kids', 'avoid', f => f.alcohol, 'Contains alcohol.'],
    ['kids', 'limit', f => f.sweet.length > 0, 'Artificial sweeteners are not recommended routinely for children.'],
    ['kids', 'limit', f => f.sugarHigh, 'High in sugar: tooth decay and weight gain.'],
    ['kids', 'limit', f => f.saltHigh, 'High in salt for a child.'],
    ['kids', 'limit', f => f.trans, 'Contains trans fat.'],
    ['kids', 'limit', f => f.otherHigh.length > 0, f => 'Contains high-hazard additives (' + j(f.otherHigh) + ').'],
    ['pregnancy', 'avoid', f => f.alcohol, 'Contains alcohol, which should be avoided in pregnancy.'],
    ['pregnancy', 'avoid', f => f.sweet.includes('saccharin'), 'Saccharin crosses the placenta; best avoided in pregnancy.'],
    ['pregnancy', 'limit', f => f.caffeine, 'Contains caffeine; keep the daily total under about 200 mg in pregnancy.'],
    ['pregnancy', 'limit', f => f.liquorice, 'Large amounts of liquorice are best avoided in pregnancy.'],
    ['pregnancy', 'limit', f => f.nitr.length > 0, 'Contains nitrites (cured meat): limit it and cook thoroughly.'],
    ['pregnancy', 'limit', f => f.dyes.length > 0, 'Contains synthetic colours: limit as a precaution.'],
    ['pregnancy', 'limit', f => f.otherHigh.length > 0, f => 'Contains high-hazard additives (' + j(f.otherHigh) + ').'],
    ['pregnancy', 'limit', f => f.sugarHigh, 'High in sugar: watch blood sugar and weight gain in pregnancy.'],
    ['pregnancy', 'limit', f => f.saltHigh, 'High in salt, which can add to swelling and blood pressure.'],
    ['older', 'limit', f => f.saltHigh, 'High in salt, which matters more for blood pressure with age.'],
    ['older', 'limit', f => f.sugarHigh, 'High in sugar.'],
    ['older', 'limit', f => f.satHigh, 'High in saturated fat.'],
    ['older', 'limit', f => f.trans, 'Contains trans fat.'],
    ['older', 'limit', f => f.caffeine, 'Caffeine can disturb sleep and raise blood pressure.'],
    ['older', 'limit', f => f.sorbitol, 'Sugar alcohols can cause bloating and diarrhoea.'],
    ['adult', 'limit', f => [f.sugarHigh, f.satHigh, f.saltHigh].filter(Boolean).length >= 2, 'High in several of sugar, saturated fat and salt: fine as an occasional treat.'],
    ['adult', 'limit', f => f.highHaz.length >= 2, f => 'Contains several high-hazard additives (' + j(f.highHaz) + ').']
  ];

  function facts(ctx) {
    const found = ctx.ing ? ctx.ing.found : [], nut = ctx.nut;
    const pick = list => found.filter(x => list.includes(x.name)).map(x => x.name);
    const row = k => nut ? nut.rows.find(r => r.key === k) : null;
    const lv = k => { const r = row(k); return r ? r.level : null; };
    const val = k => { const r = row(k); return r ? r.value : null; };
    const drink = !!nut && nut.unit === 'ml';
    const sugarHigh = lv('sugars') === 'high' || (drink && val('sugars') !== null && val('sugars') >= 5);
    return {
      hasNut: !!nut, hasIng: found.length > 0, drink,
      sugarHigh, sugarMed: lv('sugars') === 'medium' && !sugarHigh,
      saltHigh: lv('salt') === 'high', saltMed: lv('salt') === 'medium',
      satHigh: lv('sat') === 'high', satMed: lv('sat') === 'medium', fatHigh: lv('fat') === 'high',
      kcalHigh: !!nut && nut.kcal !== null && nut.kcal > 400, protein: val('protein'),
      dyes: pick(DYES), benz: pick(['sodium benzoate']).length > 0, sweet: pick(SWEET), nitr: pick(['sodium nitrite', 'sodium nitrate']),
      trans: pick(['hydrogenated palm oil']).length > 0, caffeine: pick(['caffeine']).length > 0, liquorice: pick(['liquorice']).length > 0,
      alcohol: pick(['alcohol']).length > 0, sorbitol: pick(['sorbitol']).length > 0,
      addedSugars: pick(ADDED), sodiumAdd: pick(SODIUM),
      highHaz: found.filter(x => x.hazard === 'high').map(x => x.name),
      otherHigh: found.filter(x => x.hazard === 'high' && !DYES.includes(x.name) && x.name !== 'sodium benzoate').map(x => x.name)
    };
  }

  function servingFactor(s) { const m = /(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i.exec(String(s || '')); return m ? parseFloat(m[1].replace(',', '.')) / 100 : null; }

  function daily(f, ctx) {
    const nut = ctx.nut, out = [], sv = ctx.serving || (ctx.product && ctx.product.serving) || '', fac = servingFactor(sv);
    const mode = (ctx.profile && ctx.profile.mode) || 'adult', ref = mode === 'kids' ? 1600 : 2000;
    const row = k => nut ? nut.rows.find(r => r.key === k) : null;
    const per = v => (fac === null || v === null || v === undefined) ? null : v * fac;
    const kc = nut ? per(nut.kcal) : null;
    if (kc !== null) out.push('One serving (' + sv + ') is about ' + Math.round(kc) + ' kcal, ' + Math.round(100 * kc / ref) + '% of a typical ' + ref + ' kcal day.');
    const line = (k, lim, what, limText, long, force) => {
      const r = row(k); if (!r || !(r.level === 'medium' || r.level === 'high' || force)) return;
      const v = per(r.value);
      out.push([v !== null ? 'One serving has about ' + Math.round(v * 10) / 10 + ' g ' + what + ', ' + Math.round(100 * v / lim) + '% of the ' + lim + ' g daily ' + limText + '.' : null, long].filter(Boolean).join(' '));
    };
    line('sugars', 25, 'of sugar', 'limit suggested by WHO', 'Every day this builds up: weight gain, tooth decay and a higher type 2 diabetes risk.', f.sugarHigh);
    line('salt', 5, 'of salt', 'limit suggested by WHO', 'Daily excess salt raises blood pressure over time.');
    line('sat', 20, 'of saturated fat', 'reference', 'Daily excess saturated fat raises LDL cholesterol over time.');
    if (f.dyes.length) out.push('Daily artificial colours (' + j(f.dyes) + ') are best avoided, especially for children.');
    if (f.benz) out.push('Daily sodium benzoate intake is best avoided, especially for children.');
    if (f.nitr.length) out.push('Eating processed meat with nitrites every day is linked to a higher bowel-cancer risk.');
    if (f.trans) out.push('Daily trans fat raises heart-disease risk, and there is no safe level.');
    if (f.sweet.length) out.push('Daily artificial sweeteners (' + j(f.sweet) + '): long-term effects are still debated.');
    if (f.caffeine) out.push('Daily caffeine can cause dependence, poor sleep and higher blood pressure.');
    if (!out.length || (out.length === 1 && kc !== null)) out.push('No major long-term concern from nutrition or additives at normal portions.');
    return out;
  }

  function evaluate(ctx) {
    const ing = ctx.ing, nut = ctx.nut;
    if (!nut && !(ing && ing.found.length)) return null;
    const f = facts(ctx);
    const groups = ORDER.map(id => {
      let status = 'ok'; const reasons = [];
      RULES.filter(r => r[0] === id).forEach(([, lvl, test, text]) => {
        if (!test(f)) return;
        reasons.push(typeof text === 'function' ? text(f) : text);
        if (lvl === 'avoid') status = 'avoid'; else if (status === 'ok') status = 'limit';
      });
      return { id, label: GROUPS[id], status, reasons };
    });
    const p = ctx.profile || {}, mode = p.mode || 'adult';
    const ids = [GROUPS[mode] ? mode : 'adult'].concat((p.conditions || []).filter(c => GROUPS[c]));
    const mine = groups.filter(g => ids.includes(g.id));
    const rank = { ok: 0, limit: 1, avoid: 2 }, worst = gs => gs.reduce((m, g) => rank[g.status] > rank[m] ? g.status : m, 'ok');
    const status = worst(mine), tierStatus = worst(mine.filter(g => g.id !== 'adult'));
    const o = ctx.overall;
    let tier = (o === null || o === undefined) ? 1 : o >= 75 ? 0 : o >= 50 ? 1 : o >= 25 ? 2 : 3;
    if (ctx.hazard === 'high') tier = Math.max(tier, 2);
    if (tierStatus === 'avoid') tier = 3; else if (tierStatus === 'limit') tier = Math.min(3, tier + 1);
    const notes = [];
    if (!f.hasNut) notes.push('Nutrition amounts are not available, so this advice relies on ingredients only.');
    if (!f.hasIng) notes.push('No ingredient list is available, so this advice relies on nutrition only.');
    return { groups, mine, status, tier, rec: REC[tier], daily: daily(f, ctx), notes };
  }

  // choice: 0 = every day, 1 = a few times a week, 2 = once a week or less
  function frequency(tier, choice) {
    const ok = choice >= Math.min(tier, 2);
    const text = ok ? (tier === 3 ? 'As a rare treat this is acceptable. Best not to make it a habit.' : 'That frequency is reasonable for this product.')
      : 'That is more often than advisable for this product.';
    return { ok, text };
  }

  const api = { evaluate, frequency, REC, GROUPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Advice = api;
})(typeof window !== 'undefined' ? window : globalThis);
