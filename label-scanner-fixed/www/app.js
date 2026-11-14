(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'labelscanner.profile', CKEY = 'labelscanner.cache';
  let profile = null, stream = null, reader = null, looking = false;
  try { profile = JSON.parse(localStorage.getItem(KEY)); } catch (e) { profile = null; }
  if (profile) { profile.allergies = profile.allergies || []; profile.mode = profile.mode || 'adult'; profile.conditions = profile.conditions || []; }
  const MODES = { adult: 'Adult', kids: 'Child', pregnancy: 'Pregnancy', older: 'Older adult' };
  const CONDS = { diabetes: 'Diabetes', bp: 'High blood pressure', heart: 'Heart disease / cholesterol', kidney: 'Kidney disease', weight: 'Weight loss' };
  let toolsOpen = false, fresh = true, lastKey = null, last = null, freq = null, cur = null, view = null, expectText = '', expectRes = null, cmpKey = '', manual = null, similar = null;
  const servingOf = p => (p && p.serving) || (manual && manual.serving) || '';
  const Store = Features.createStore(window.localStorage);

  // ---- saved products (works offline for products looked up before) ----
  function cacheGet(code) { try { return (JSON.parse(localStorage.getItem(CKEY)) || {})[code] || null; } catch (e) { return null; } }
  function cacheSet(p) {
    try {
      const all = JSON.parse(localStorage.getItem(CKEY)) || {};
      delete all[p.barcode]; all[p.barcode] = p;
      const keys = Object.keys(all); while (keys.length > 100) delete all[keys.shift()];
      localStorage.setItem(CKEY, JSON.stringify(all));
    } catch (e) { /* storage unavailable */ }
  }

  // ---- profile ----
  function showProfile() {
    stopCamera(); $('mainView').hidden = true; $('profileView').hidden = false; $('pConsent').checked = !!profile; $('pCancel').hidden = !profile;
    $('pName').value = profile ? profile.name : ''; $('pAge').value = profile ? profile.age : '';
    $('pAllergies').value = profile ? profile.allergies.join(', ') : ''; $('pError').textContent = '';
    $('pMode').value = profile ? profile.mode : 'adult'; $('pCountry').value = (profile && profile.country) || (window.UI ? UI.guessCountry() : '');
    document.querySelectorAll('#conds input').forEach(i => { i.checked = !!profile && profile.conditions.includes(i.value); });
  }
  function showMain() { stopCamera(); $('profileView').hidden = true; $('mainView').hidden = false; if (window.UI) UI.go('scan'); $('hello').textContent = (window.I18N ? I18N.t('Hello') : 'Hello') + ', ' + profile.name;
    $('modeTag').textContent = [MODES[profile.mode] + ' mode'].concat(profile.conditions.map(c => CONDS[c])).join('  |  '); }
  $('pSave').onclick = () => {
    const name = $('pName').value.trim(), age = parseInt($('pAge').value, 10);
    if (!name) { $('pError').textContent = 'Enter your name.'; return; }
    if (!(age >= 1 && age <= 120)) { $('pError').textContent = 'Enter an age between 1 and 120.'; return; }
    if (!$('pConsent').checked) { $('pError').textContent = 'Please tick the box to confirm the notice.'; return; }
    profile = { name, age, allergies: $('pAllergies').value.split(',').map(s => s.trim()).filter(Boolean), mode: $('pMode').value, country: $('pCountry').value,
      conditions: Array.from(document.querySelectorAll('#conds input:checked')).map(i => i.value) };
    try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (e) { /* storage unavailable */ }
    showMain();
  };
  $('editProfile').onclick = showProfile;
  document.addEventListener('ls:country', e => { if (profile) { profile.country = e.detail; try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (err) { /* storage unavailable */ } } });
  $('pCancel').onclick = () => { showMain(); if (window.UI) UI.go('settings'); };

  const status = (m, busy) => { const el = $('status'); el.textContent = m; el.classList.toggle('busy', !!busy && !!m); };

  // Photos are cleaned up before OCR: small photos are enlarged, huge ones shrunk, then grey-scaled and contrast-stretched.
  function prep(dataUrl) {
    return new Promise(res => { const im = new Image(); im.onload = () => {
      const m = Math.max(im.width, im.height), k = m < 1100 ? Math.min(4, 1600 / m) : m > 1800 ? 1800 / m : 1;
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
      const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, c.width, c.height);
      try {
        const d = x.getImageData(0, 0, c.width, c.height), p = d.data, h = new Uint32Array(256), n = c.width * c.height;
        for (let q = 0; q < p.length; q += 4) { const g = (p[q] * 299 + p[q + 1] * 587 + p[q + 2] * 114) / 1000 | 0; p[q] = g; h[g]++; }
        let lo = 0, hi = 255, a = 0; while (lo < 255 && (a += h[lo]) < n * 0.02) lo++; a = 0; while (hi > 0 && (a += h[hi]) < n * 0.02) hi--;
        const sc = hi > lo ? 255 / (hi - lo) : 1;
        for (let q = 0; q < p.length; q += 4) { const v = Math.max(0, Math.min(255, (p[q] - lo) * sc)); p[q] = p[q + 1] = p[q + 2] = v; }
        x.putImageData(d, 0, 0);
      } catch (e) { /* keep unprocessed pixels */ }
      c.toBlob(b => res(b || dataUrl), 'image/png'); };
      im.onerror = () => res(dataUrl); im.src = dataUrl; });
  }
  const scan = async d => window.api.scanImage(await prep(d));

  // ---- ingredient text / image ----
  async function readImage(dataUrl) {
    if (!window.api) { status('Image scanning is not available right now.'); return; }
    status('Reading text from the image. The first scan can take a few seconds...', true);
    try {
      const r = await SmartScan.read(dataUrl, { ocr: d => window.api.scanImage(d), progress: m => status(m, true) });
      $('pasteText').value = r.text.trim(); runText(r.text); reveal();
      if (r.text.trim()) status(($('status').textContent ? $('status').textContent + ' ' : '') + (r.rot ? 'The photo was sideways, so we turned it. ' : '') + 'Check the text in the box for mistakes, especially allergens. Fix anything, then press Analyze text.');
    } catch (e) { status('Could not read the image' + (e && e.message ? ' (' + e.message + ')' : '') + '. Try a sharper, brighter photo, or paste the text.'); }
  }
  const reveal = () => setTimeout(() => { const r = $('result'); if (r.firstChild) r.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }, 60);
  function runText(text, init) {
    const ing = Engine.analyze(text, profile), parsed = Nutrition.parseNutrition(text);
    resetState();
    if (init && init.vals) manual = init; else if (parsed.count >= 3) manual = { vals: parsed, drink: false, serving: '', auto: true };
    const nut = manual ? Nutrition.assess(manual.vals, { drink: manual.drink }) : null;
    status(manual && manual.auto ? 'Nutrition values were read from the label text. Please check them below.'
      : (ing.found.length || nut) ? '' : 'No known ingredients found. Make sure the ingredient list is visible, or paste it as text.');
    render({ product: null, ing, nut, text }); record();
  }
  $('analyzeBtn').onclick = () => runText($('pasteText').value);

  function resetState() { toolsOpen = false; fresh = true; freq = null; expectRes = null; expectText = ''; cmpKey = ''; manual = null; similar = null; if (window.speechSynthesis) window.speechSynthesis.cancel(); }
  function record() { if (cur) { Store.addHistory(cur); renderLists(); } }
  function showProduct(p, init) {
    $('pasteText').value = p.ingredients || '';
    const ing = p.ingredients ? Engine.analyze(p.ingredients, profile) : null;
    let nut = Nutrition.assess(p.nutrition, { drink: Nutrition.isDrink(p.quantity) });
    resetState();
    if (!nut && init && init.vals) { manual = init; nut = Nutrition.assess(init.vals, { drink: init.drink }); }
    render({ product: p, ing, nut, text: '' }); record();
  }

  // ---- barcode ----
  async function lookup(raw) {
    if (looking) return false;
    const code = String(raw).replace(/\D/g, '');
    if (!Barcode.isValidGtin(code)) { status('That barcode number is not valid. Check the digits and try again.'); return false; }
    looking = true; stopCamera();
    try {
      let p = cacheGet(code), note = '';
      if (p) note = 'Loaded from the copy saved on this device.';
      else {
        if (!window.api) { status('Barcode lookup is not available right now.'); return false; }
        status('Looking up ' + code + '...');
        const r = await window.api.lookupBarcode(code);
        if (!r.ok) {
          status(r.reason === 'not_found' ? 'This barcode is not in Open Food Facts. Scan or paste its ingredient list instead.'
            : r.reason === 'network' ? 'Could not reach Open Food Facts. Check your internet connection. Products you looked up before still work offline.'
            : 'That barcode number is not valid.');
          return false;
        }
        p = r.product; cacheSet(p);
      }
      status(note); $('bcText').value = code; showProduct(p); reveal(); return true;
    } finally { looking = false; }
  }
  $('bcGo').onclick = () => lookup($('bcText').value);
  $('bcText').onkeydown = e => { if (e.key === 'Enter') lookup($('bcText').value); };

  // ---- camera and photos: barcodes are found automatically, text is read with OCR ----
  function barcodeHints(hard) { // TRY_HARDER only for still photos; live video is decoded many times a second
    const Z = window.ZXing, h = new Map();
    h.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
    if (hard) h.set(Z.DecodeHintType.TRY_HARDER, true);
    return h;
  }
  const CAM = { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } };
  function camUi(on) { $('camWrap').hidden = !on; $('camStart').hidden = on; $('camSnap').hidden = !on; $('camStop').hidden = !on; }
  function startCamera() {
    camUi(true); try { api.warmup(); } catch (e) { /* ignore */ }
    status('Point the camera at a barcode (read automatically) or at the ingredient list or nutrition table, then press "Read text from camera".');
    const fail = e => { status('Camera not available' + (e && e.name ? ' (' + e.name + ')' : '') + '. Use "Take photo of ingredients", Upload photo, or paste the text instead.'); stopCamera(); };
    if (!window.ZXing) {
      navigator.mediaDevices.getUserMedia(CAM).then(s => { stream = s; $('video').srcObject = s; }).catch(fail);
      return;
    }
    reader = new window.ZXing.BrowserMultiFormatReader(barcodeHints(false), 400);
    reader.decodeFromConstraints(CAM, $('video'), res => { if (res && Barcode.isValidGtin(res.getText())) lookup(res.getText()); }).catch(fail);
  }
  function stopCamera() {
    if (reader) { try { reader.reset(); } catch (e) { /* already stopped */ } reader = null; }
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; camUi(false);
  }
  $('camStart').onclick = startCamera; $('camStop').onclick = stopCamera;
  $('camSnap').onclick = () => { // read only what is inside the guide frame
    const v = $('video'), c = $('canvas'), W = v.videoWidth, H = v.videoHeight, sx = Math.round(W * 0.04), sy = Math.round(H * 0.15), sw = Math.round(W * 0.92), sh = Math.round(H * 0.7);
    c.width = sw; c.height = sh; c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
    c.toBlob(b => { if (!b) return status('Could not capture the camera image.'); const u = URL.createObjectURL(b); readImage(u).finally(() => URL.revokeObjectURL(u)); }, 'image/png');
  };
  async function photoBarcode(url) {
    const Z = window.ZXing; if (!Z) return null;
    try {
      const im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('img')); i.src = url; });
      const k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
      c.getContext('2d', { willReadFrequently: true }).drawImage(im, 0, 0, c.width, c.height);
      const mr = new Z.MultiFormatReader(); mr.setHints(barcodeHints(true));
      const t = mr.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(c)))).getText();
      return Barcode.isValidGtin(t) ? t : null;
    } catch (e) { return null; }
  }
  async function handlePhoto(url) {
    status('Looking for a barcode in the photo...');
    const code = await photoBarcode(url);
    if (code && await lookup(code)) return;
    await readImage(url);
  }
  // Files are read through a temporary object URL (no giant base64 string in memory), then released.
  function fromFile(f) { const url = URL.createObjectURL(f); return handlePhoto(url).catch(() => status('Could not open that photo.')).finally(() => URL.revokeObjectURL(url)); }
  $('uploadBtn').onclick = () => { $('fileIn').click(); try { api.warmup(); } catch (e) { /* ignore */ } };
  const isImg = f => f.type.indexOf('image/') === 0 || /\.(jpe?g|jfif|png|webp|bmp|gif)$/i.test(f.name);
  const takeFile = f => { if (window.UI) UI.go('scan'); fromFile(f); };
  const dz = document.querySelector('.panel.hero'), hasFiles = e => Array.from((e.dataTransfer && e.dataTransfer.types) || []).indexOf('Files') >= 0;
  ['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { if (hasFiles(e)) { e.preventDefault(); dz.classList.add('drag'); } }));
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) dz.classList.remove('drag'); });
  document.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); const f = Array.from((e.dataTransfer && e.dataTransfer.files) || []).find(isImg); if (f) takeFile(f); });
  $('pasteText').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runText($('pasteText').value); };
  $('clearBtn').onclick = () => { $('pasteText').value = ''; $('bcText').value = ''; resetState(); cur = null; view = null; last = null; $('result').innerHTML = ''; status(''); };
  document.addEventListener('paste', e => { // Ctrl+V of a copied image
    const it = Array.from((e.clipboardData && e.clipboardData.items) || []).find(t => t.type.indexOf('image/') === 0); if (!it) return;
    e.preventDefault(); const f = it.getAsFile(); if (!f) return; if (window.UI) UI.go('scan'); fromFile(f);
  });
  const pick = e => { const f = e.target.files[0]; if (!f) return; e.target.value = ''; fromFile(f); };
  $('fileIn').onchange = pick; $('camIn').onchange = pick;
  // Opens the phone's own camera app (sharper than live video). The live camera must be released first.
  $('photoBtn').onclick = () => { stopCamera(); $('camIn').click(); try { api.warmup(); } catch (e) { /* ignore */ } };

  // ---- results ----
  const cls = s => s >= 75 ? 'good' : s >= 50 ? 'ok' : s >= 25 ? 'poor' : 'bad';
  function allergyWarnings(ing, product) {
    const out = [], algs = (profile.allergies || []).map(a => a.toLowerCase().trim()).filter(a => a.length >= 3);
    if (!algs.length) return out;
    const done = new Set(), add = (allergy, kind, text) => { const k = allergy + '|' + kind; if (!done.has(k)) { done.add(k); out.push({ allergy, kind, text }); } };
    if (ing) ing.warnings.forEach(w => add(w.allergy, w.kind, (w.kind === 'may' ? 'may contain traces of ' : 'contains ') + w.ingredient));
    if (product) algs.forEach(a => {
      const terms = Engine.termsFor(a), hit = tags => (tags || []).find(t => { const s = t.replace(/-/g, ' '); return terms.some(x => s.includes(x) || x.includes(s)); });
      const d = hit(product.allergens); if (d) add(a, 'contains', 'declares the allergen "' + d.replace(/-/g, ' ') + '"');
      const tr = hit(product.traces); if (tr) add(a, 'may', 'may contain traces of "' + tr.replace(/-/g, ' ') + '"');
    });
    const noData = product && !product.ingredients && !(product.allergens || []).length && !(product.traces || []).length && !(ing && ing.found.length);
    algs.forEach(a => {
      const has = out.some(w => w.allergy === a);
      if (!has && ((ing && ing.allergyStatus === 'unverified') || noData)) add(a, 'unverified', 'could not be checked for this allergy; read the printed label');
    });
    return out;
  }
  function render(c) {
    last = c; const { product, ing, nut } = c;
    const out = $('result'), prevTools = out.querySelector('details.tools'); if (prevTools && !fresh) toolsOpen = prevTools.open;
    const wasFresh = fresh; fresh = false;
    const ingScore = ing ? ing.score : null, nutScore = nut ? nut.score : null;
    const score = Nutrition.overall(ingScore, nutScore);
    if (score === null && !product && !(ing && (profile.allergies || []).length)) { cur = null; view = null; lastKey = null; out.innerHTML = ''; return; }
    const hazard = Nutrition.worst(ing ? ing.hazard : null, nut ? nut.level : null);
    cur = Features.snapshot(c, score, hazard); if (manual) cur.manual = manual;
    out.classList.toggle('still', !wasFresh && cur.key === lastKey); lastKey = cur.key; // same result re-drawn: skip entrance animation
    const vcls = score !== null ? cls(score) : '';
    const head = '<section class="card head"><div><h2>' + (product ? esc(product.name) : 'Result') + '</h2><p class="muted">' + (product ? esc([product.brand, product.quantity].filter(Boolean).join(' - ')) : 'Scanned text') + '</p></div>' + actionsHtml() + '</section>';
    let verdict;
    if (score !== null) {
      const chips = ['Hazard: ' + hazard];
      if (ingScore !== null) chips.push('Ingredients ' + ingScore + '/100'); if (nutScore !== null) chips.push('Nutrition ' + nutScore + '/100');
      if (ing && ing.confidence && ing.confidence !== 'none') chips.push('Confidence: ' + ing.confidence + ' (' + Math.round(ing.coverage * 100) + '% recognised)');
      verdict = '<section class="card verdict v-' + vcls + '"><div class="big ' + vcls + '">' + score + '</div><div><div class="vword">' + esc(Nutrition.verdict(score)) + '</div><div class="vsub">Overall score out of 100</div><div class="vchips">' + chips.map(c => '<span>' + esc(c) + '</span>').join('') + '</div></div></section>';
    } else verdict = '<section class="card"><p>No score: not enough recognised ingredients or nutrition data. Try a clearer photo or paste the ingredient list.</p></section>';
    const aw = allergyWarnings(ing, product);
    const unv = aw.filter(w => w.kind === 'unverified'), awShown = aw.filter(w => w.kind !== 'unverified').concat(unv.length ? [{ allergy: unv.map(w => w.allergy).join(', '), kind: 'unverified', text: 'could not be checked for your allergies; read the printed label' }] : []);
    let alerts = '';
    awShown.forEach(w => {
      const who = ' (you listed "' + esc(w.allergy) + '")';
      alerts += w.kind === 'contains' ? '<div class="warn"><div><strong>Allergy warning:</strong> this product ' + esc(w.text) + who + '.</div></div>'
        : w.kind === 'may' ? '<div class="warn soft"><div><strong>May contain traces:</strong> this product ' + esc(w.text) + who + '. Avoid it if your allergy is severe.</div></div>'
        : '<div class="warn soft"><div><strong>Cannot confirm:</strong> this product ' + esc(w.text) + who + '.</div></div>';
    });
    if (!awShown.length && (profile.allergies || []).length) alerts += '<div class="ok-note">No match for your allergies (' + esc(profile.allergies.join(', ')) + ') in the information we read. Always confirm on the printed label.</div>';
    let glance = '';
    if (ing && ing.found.length) {
      const watch = ing.found.filter(x => x.hazard === 'high' || x.score < 40).sort((a, b) => a.score - b.score).slice(0, 5), good = ing.found.filter(x => x.score >= 75 && x.hazard !== 'high').slice(0, 5);
      const tags = (l, k) => l.map(x => '<span class="tagc ' + k + '" title="' + esc(x.note) + '">' + esc(x.name) + '</span>').join('');
      if (watch.length || good.length) glance = '<section class="card glance">' + (watch.length ? '<div><h3>Watch out for</h3>' + tags(watch, 'r') + '</div>' : '') + (good.length ? '<div><h3>Good to see</h3>' + tags(good, 'g') + '</div>' : '') + '</section>';
    }
    const adv = Advice.evaluate({ ing, nut, product, profile, overall: score, hazard, serving: servingOf(product) });
    view = { product, nut, adv, score, hazard, verdict: Nutrition.verdict(score), warnings: awShown };
    const foryou = adv ? '<section class="card">' + foryouHtml(adv) + '</section>' : '';
    const cols = adv ? '<div class="cols"><section class="card">' + whoHtml(adv) + '</section><section class="card">' + freqHtml(adv) + '</section></div>' : '';
    let ingCard = '';
    if (ing && ing.found.length) {
      ingCard = '<section class="card"><h3>Ingredients, riskiest first</h3>' + (ing.unknown.length ? '<p class="muted small">Not in the ingredient database (' + ing.unknown.length + '), so the ingredient score is partial: ' + esc(ing.unknown.join(', ')) + '</p>' : '') + '<div class="tablewrap"><table><tr><th>Ingredient</th><th>Score</th><th>Hazard</th><th>Why</th></tr>';
      ing.found.slice().sort((a, b) => a.score - b.score).forEach(x => {
        ingCard += '<tr><td>' + esc(x.name) + '</td><td><div class="bar ' + cls(x.score) + '"><i style="width:' + x.score + '%"></i></div>' + x.score + '</td><td>' + esc(x.hazard) + '</td><td>' + esc(x.note) + '</td></tr>';
      });
      ingCard += '</table></div></section>';
    } else if (product) ingCard = '<section class="card"><p class="muted small">' + (product.ingredients ? 'None of its ingredients are in the database yet.' : 'No ingredient list is stored for this product. Scan or paste the ingredient label to rate its ingredients.') + '</p></section>';
    let nutCard = '';
    if (nut) {
      const per = nut.unit === 'ml' ? '100 ml' : '100 g', sv = servingOf(product), ps = Nutrition.perServing(nut.kcal, sv);
      nutCard = '<section class="card"><h3>Nutrition per ' + per + '</h3>';
      if (nut.kcal !== null) nutCard += '<p class="kcal"><strong>' + nut.kcal + ' kcal</strong>' + (ps !== null ? ' (about ' + ps + ' kcal per serving of ' + esc(sv) + ')' : '') + '</p>';
      nutCard += '<div class="tablewrap"><table><tr><th>Nutrient</th><th>Amount</th><th>Level</th></tr>';
      nut.rows.forEach(r => { nutCard += '<tr><td>' + esc(r.label) + '</td><td>' + r.value + ' g</td><td>' + (r.level ? '<span class="chip ' + r.level + '">' + r.level + '</span>' : '') + '</td></tr>'; });
      nutCard += '</table></div><h3>Effect on health</h3><ul class="fx">' + nut.effects.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></section>';
    } else if (product) nutCard = '<section class="card"><p class="muted small">No nutrition data is listed for this product.</p></section>';
    const nutForm = '<details class="card more"' + (nut ? '' : ' open') + '><summary>Add or edit nutrition facts</summary>' + nutFormHtml(c) + '</details>';
    const toolsHtml = expectHtml(c) + similarHtml() + compareHtml();
    const tools = toolsHtml.trim() ? '<details class="card more tools"' + (toolsOpen ? ' open' : '') + '><summary>More tools: expectations, similar products, compare</summary>' + toolsHtml + '</details>' : '';
    out.innerHTML = '<div class="res">' + [head, alerts, verdict, glance, foryou, cols, ingCard, nutCard, nutForm, tools].join('') + '</div>';
  }

  // ---- personalised advice sections ----
  const ST = { avoid: 'Better to avoid', limit: 'Limit', ok: 'No concerns found' }, CH = { avoid: 'high', limit: 'medium', ok: 'low' };
  const chip = s => '<span class="chip ' + CH[s] + '">' + ST[s] + '</span>';
  function foryouHtml(a) {
    const names = a.mine.map(g => g.label).join(', ');
    let h = '<div class="sec"><h3>For you (' + esc(names) + ')</h3><p>' + chip(a.status) + '</p>';
    const bad = a.mine.filter(g => g.status !== 'ok');
    h += bad.length ? '<ul class="fx">' + bad.map(g => g.reasons.map(r => '<li><strong>' + esc(g.label) + ':</strong> ' + esc(r) + '</li>').join('')).join('') + '</ul>'
      : '<p>Nothing in this product conflicts with your profile.</p>';
    a.notes.forEach(n => { h += '<p class="muted small note">' + esc(n) + '</p>'; });
    return h + '</div>';
  }
  function whoHtml(a) {
    const bad = a.groups.filter(g => g.status !== 'ok'), ok = a.groups.filter(g => g.status === 'ok');
    let h = '<div class="sec"><h3>Who should avoid or limit this</h3>';
    h += bad.length ? '<ul class="who">' + bad.map(g => '<li>' + chip(g.status) + ' <strong>' + esc(g.label) + '</strong><br><span class="muted small">' + esc(g.reasons.join(' ')) + '</span></li>').join('') + '</ul>'
      : '<p>No group has a specific concern.</p>';
    if (ok.length) h += '<h3>Generally fine for</h3><p>' + esc(ok.map(g => g.label).join(', ')) + '</p>';
    return h + '</div>';
  }
  function freqHtml(a) {
    const opts = ['Every day', 'A few times a week', 'Once a week or less'];
    let h = '<div class="sec"><h3>How often will you eat this?</h3><div class="freq">' +
      opts.map((o, i) => '<button data-freq="' + i + '" class="' + (freq === i ? 'on' : '') + '">' + o + '</button>').join('') + '</div>';
    if (freq !== null) {
      const f = Advice.frequency(a.tier, freq);
      h += '<p class="verdict ' + (f.ok ? 'good' : 'bad') + '">' + esc(f.text) + '</p><p>Suggested: ' + esc(a.rec) + '</p>' +
        '<h3>If you ate this every day</h3><ul class="fx">' + a.daily.map(d => '<li>' + esc(d) + '</li>').join('') + '</ul>';
    }
    return h + '</div>';
  }
  // ---- favorites, history, expectation, compare, voice, feedback ----
  function actionsHtml() {
    if (!cur) return '';
    const fav = Store.isFav(cur.key);
    return '<div class="actions"><button data-act="fav" aria-pressed="' + fav + '">' + (fav ? 'Saved to favorites' : 'Save to favorites') + '</button>' +
      (window.speechSynthesis ? '<button data-act="speak">Read aloud</button>' : '') + '<button data-act="report">Report a problem</button></div>';
  }
  function expectHtml() {
    let h = '<div class="sec"><h3>Is this what you expected?</h3><div class="row"><input id="expectIn" class="grow" aria-label="What did you expect" placeholder="e.g. sugar free, vegan, no palm oil" value="' + esc(expectText) + '"><button data-act="expect">Check</button></div>';
    if (expectRes) {
      const V = { match: ['low', 'Matches what you expected'], mismatch: ['high', 'Does not match what you expected'], unknown: ['medium', 'Could not check this expectation'] }[expectRes.verdict];
      h += '<p class="verdict"><span class="chip ' + V[0] + '">' + V[1] + '</span></p>';
      if (!expectRes.items.length) h += '<p class="muted small">Type what you expected, for example "sugar free", "vegan" or "no palm oil".</p>';
      h += '<ul class="who">' + expectRes.items.map(x => '<li><span class="chip ' + (x.status === true ? 'low' : x.status === false ? 'high' : 'medium') + '">' +
        (x.status === true ? 'Matches' : x.status === false ? 'Does not match' : 'Cannot confirm') + '</span> <strong>' + esc(x.claim) + '</strong><br><span class="muted small">' + esc(x.why) + '</span></li>').join('') + '</ul>';
      if (expectRes.unconfirmed && expectRes.verdict !== 'unknown') h += '<p class="muted small note">' + expectRes.unconfirmed + ' point(s) could not be confirmed from the data available.</p>';
    }
    return h + '</div>';
  }
  function comparePool() {
    const seen = new Set([cur ? cur.key : '']), pool = [];
    Store.history().concat(Store.favorites(), similar && similar.items ? similar.items : []).forEach(e => { if (!seen.has(e.key)) { seen.add(e.key); pool.push(e); } });
    return pool;
  }
  function compareHtml() {
    if (!cur) return '';
    const pool = comparePool();
    let h = '<div class="sec"><h3>Compare with another product</h3>';
    if (!pool.length) return h + '<p class="muted small">Scan another product of the same type, then compare it here. Your scanned and favorite products appear in this list.</p></div>';
    h += '<div class="row"><select id="cmpSel" class="grow" aria-label="Product to compare with">' + pool.map(e => '<option value="' + esc(e.key) + '"' + (e.key === cmpKey ? ' selected' : '') + '>' +
      esc(e.name) + (e.score !== null && e.score !== undefined ? ' (' + e.score + ')' : '') + '</option>').join('') + '</select><button data-act="compare">Compare</button></div>';
    const o = cmpKey && pool.find(e => e.key === cmpKey);
    if (o) {
      const r = Features.compare(cur, o), cell = (v, best) => '<td' + (best ? ' class="best"' : '') + '>' + (v === null ? '-' : v) + '</td>';
      h += '<p class="verdict">' + esc(r.summary) + '</p><table><tr><th>Per 100 g</th><th>' + esc(cur.name) + '</th><th>' + esc(o.name) + '</th></tr>' +
        r.rows.map(x => '<tr><td>' + esc(x.label) + '</td>' + cell(x.a, x.better === 'a') + cell(x.b, x.better === 'b') + '</tr>').join('') + '</table>';
    }
    return h + '</div>';
  }
  $('result').onclick = e => {
    const b = e.target.closest('[data-freq],[data-act]'); if (!b || !last) return;
    if (b.dataset.freq !== undefined) { freq = parseInt(b.dataset.freq, 10); render(last); return; }
    const act = b.dataset.act;
    if (act === 'fav' && cur) { Store.toggleFav(cur); renderLists(); render(last); }
    else if (act === 'speak' && view) { const s = window.speechSynthesis; if (s.speaking) s.cancel(); else s.speak(new SpeechSynthesisUtterance(Features.speech(view))); }
    else if (act === 'report') openFeedback('report');
    else if (act === 'expect') { expectText = $('expectIn').value; expectRes = Features.expectation(expectText, { product: last.product, ing: last.ing, nut: last.nut, text: last.text, overall: view ? view.score : null }); render(last); }
    else if (act === 'compare') { cmpKey = $('cmpSel').value; render(last); }
    else if (act === 'cmpsim') { cmpKey = b.dataset.key; render(last); }
    else if (act === 'similar') findSimilar();
    else if (act === 'nutphoto') $('nutFile').click();
    else if (act === 'nutapply') {
      const vals = { kcal: null, fat: null, sat: null, carbs: null, sugars: null, fibre: null, protein: null, salt: null };
      document.querySelectorAll('#result [data-n]').forEach(i => { const v = parseFloat(i.value); vals[i.dataset.n] = Number.isFinite(v) && v >= 0 ? v : null; });
      const drink = $('nDrink').checked, nut = Nutrition.assess(vals, { drink });
      if (!nut) { status('Enter at least calories, fat, sugars or salt from the nutrition table.'); return; }
      manual = { vals, drink, serving: $('nServing').value.trim(), auto: false };
      last = Object.assign({}, last, { nut }); status(''); render(last); record();
    }
  };

  $('result').onchange = e => {
    if (e.target.id !== 'nutFile' || !e.target.files[0] || !window.api) return;
    const fr = new FileReader();
    fr.onload = async () => {
      status('Reading the nutrition table...');
      try {
        const p = Nutrition.parseNutrition(await scan(fr.result));
        document.querySelectorAll('#result [data-n]').forEach(i => { if (p[i.dataset.n] !== null) i.value = p[i.dataset.n]; });
        status(p.count ? 'Values filled in from the photo. Please check them, then press Calculate.' : 'Could not find nutrition values in that photo. Enter them by hand.');
      } catch (err) { status('Could not read the photo. Enter the values by hand.'); }
    };
    fr.readAsDataURL(e.target.files[0]);
  };
  function nutFormHtml(c) {
    if (c.nut && !manual) return '';
    const v = manual ? manual.vals : {};
    const F = [['kcal', 'Calories (kcal)'], ['fat', 'Fat (g)'], ['sat', 'Saturated fat (g)'], ['carbs', 'Carbohydrates (g)'], ['sugars', 'Sugars (g)'], ['fibre', 'Fibre (g)'], ['protein', 'Protein (g)'], ['salt', 'Salt (g)']];
    return '<div class="sec"><h3>' + (c.nut ? 'Check the nutrition values' : 'Add nutrition facts for calories and health effects') + '</h3>' +
      '<p class="muted small">Enter the values per 100 g (or per 100 ml for a drink) from the nutrition table on the pack.</p><div class="nutgrid">' +
      F.map(([k, l]) => '<label>' + l + '<input type="number" step="any" min="0" data-n="' + k + '" value="' + (v[k] === null || v[k] === undefined ? '' : v[k]) + '"></label>').join('') +
      '</div><div class="row"><label class="chk"><input type="checkbox" id="nDrink"' + (manual && manual.drink ? ' checked' : '') + '> This is a drink</label>' +
      '<input id="nServing" class="grow" aria-label="Serving size" placeholder="Serving size, e.g. 30 g (optional)" value="' + esc(manual ? manual.serving : '') + '"></div>' +
      '<div class="row"><button class="primary" data-act="nutapply">Calculate</button><button data-act="nutphoto">Read from a photo</button><input id="nutFile" type="file" accept="image/*" hidden></div></div>';
  }
  function similarHtml() {
    if (!cur || !last || !last.product || !(last.product.categories || []).length) return '';
    let h = '<div class="sec"><h3>Similar products and healthier options</h3>';
    if (!similar) return h + '<p class="muted small">Find products of the same type on Open Food Facts and see how they score. Needs internet.</p><button data-act="similar">Find similar products</button></div>';
    if (similar.loading) return h + '<p class="muted small" role="status">Searching...</p></div>';
    if (similar.msg) return h + '<p class="muted small">' + esc(similar.msg) + '</p><button data-act="similar">Try again</button></div>';
    const better = similar.items.filter(x => x.better).length;
    h += '<p>' + (better ? 'Found ' + better + ' higher-scoring option' + (better > 1 ? 's' : '') + ' of the same type.' : 'No higher-scoring product of the same type was found.') + '</p><ul class="who">' +
      similar.items.map(x => '<li>' + (x.better ? '<span class="chip low">Better</span> ' : '') + '<strong>' + esc(x.name) + '</strong> <span class="muted small">' + esc(x.product ? x.product.brand : '') +
        '</span> - ' + x.score + '/100<br><button class="link" data-act="cmpsim" data-key="' + esc(x.key) + '">Compare with this product</button></li>').join('') + '</ul>';
    return h + '</div>';
  }
  async function findSimilar() {
    const mine = last;
    if (!window.api || !window.api.findSimilar) { similar = { msg: 'Searching is not available right now.' }; render(last); return; }
    similar = { loading: true }; render(last);
    const r = await window.api.findSimilar(mine.product.categories);
    if (last !== mine) return;
    if (!r.ok) { similar = { msg: r.reason === 'network' ? 'Could not reach Open Food Facts. Check your internet connection.' : 'No similar products with data were found.' }; render(last); return; }
    const snaps = [];
    r.products.forEach(p => {
      const ing = p.ingredients ? Engine.analyze(p.ingredients, profile) : null, nut = Nutrition.assess(p.nutrition, { drink: Nutrition.isDrink(p.quantity) });
      const o = Nutrition.overall(ing ? ing.score : null, nut ? nut.score : null);
      if (o !== null) snaps.push(Features.snapshot({ product: p, ing, nut, text: '' }, o, Nutrition.worst(ing ? ing.hazard : null, nut ? nut.level : null)));
    });
    const items = Features.pickAlternatives(cur, snaps);
    similar = items.length ? { items } : { msg: 'No similar products with enough data were found.' };
    render(last);
  }

  function renderLists() {
    const mk = (arr, p) => arr.length ? '<ul class="who">' + arr.map((e, i) => '<li><button class="link" data-open="' + p + i + '">' + esc(e.name) + '</button>' +
      (e.score !== null && e.score !== undefined ? ' <span class="muted small">' + e.score + '/100</span>' : '') + '</li>').join('') + '</ul>' : '<p class="muted small">Nothing yet.</p>';
    const hist = Store.history(), f = Store.favorites();
    $('lists').innerHTML = '<details open><summary>Favorites (' + f.length + ')</summary>' + mk(f, 'f') + '</details><details open><summary>Recent scans (' + hist.length + ')</summary>' +
      mk(hist.slice(0, 20), 'h') + (hist.length ? '<button class="link" data-act="clearhist">Clear history</button>' : '') + '</details>';
  }
  $('lists').onclick = e => {
    const o = e.target.closest('[data-open]'), a = e.target.closest('[data-act]');
    if (o) {
      const k = o.dataset.open, arr = k[0] === 'f' ? Store.favorites() : Store.history().slice(0, 20), en = arr[parseInt(k.slice(1), 10)];
      if (!en) return;
      stopCamera(); if (window.UI) UI.go('scan');
      if (en.product) { $('bcText').value = en.product.barcode; showProduct(en.product, en.manual); } else { $('pasteText').value = en.text || ''; runText(en.text || '', en.manual); }
    } else if (a && a.dataset.act === 'clearhist') { Store.clearHistory(); renderLists(); }
  };

  let fbType = 'feedback';
  function openFeedback(type) {
    fbType = type; $('fbForm').hidden = false;
    $('fbLabel').textContent = type === 'report' ? 'Describe the problem' + (cur ? ' with "' + cur.name + '"' : '') : 'Your feedback';
    $('fbText').value = ''; $('fbText').focus();
    if ($('fbForm').scrollIntoView) $('fbForm').scrollIntoView();
  }
  $('fbBtn').onclick = () => openFeedback('feedback'); $('repBtn').onclick = () => openFeedback('report');
  $('fbSend').onclick = () => {
    const text = $('fbText').value.trim();
    if (!text) { $('fbMsg').textContent = 'Please write a message first.'; return; }
    Store.addFeedback({ type: fbType, text, product: fbType === 'report' && cur ? cur.name + (cur.product ? ' [' + cur.key + ']' : '') : '' });
    $('fbForm').hidden = true; $('fbMsg').textContent = 'Thank you. Saved on this device.';
  };
  $('stars').onclick = e => {
    const b = e.target.closest('[data-rate]'); if (!b) return;
    const r = parseInt(b.dataset.rate, 10); Store.addFeedback({ type: 'rating', rating: r });
    Array.from($('stars').children).forEach(x => x.classList.toggle('on', parseInt(x.dataset.rate, 10) <= r));
    $('fbMsg').textContent = 'Thanks for rating ' + r + ' out of 5.';
  };
  $('fbExport').onclick = () => {
    const txt = Store.exportFeedback(); if (!txt) { $('fbMsg').textContent = 'No saved feedback yet.'; return; }
    const done = () => { $('fbMsg').textContent = 'Feedback copied. Paste it into an email or message to send it.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(done, () => { $('fbText').value = txt; $('fbForm').hidden = false; $('fbMsg').textContent = 'Select and copy the text in the box.'; }); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = 'label-scanner-feedback.txt'; a.click();
  };

  renderLists();
  if (profile) showMain(); else showProfile();

  // Android Back button: close camera -> leave edit screen -> return to Scan -> only then exit.
  try {
    const C = window.Capacitor, CapApp = C && ((C.Plugins && C.Plugins.App) || (C.registerPlugin && C.registerPlugin('App')));
    if (CapApp && CapApp.addListener) CapApp.addListener('backButton', () => {
      if (!$('camWrap').hidden) { stopCamera(); return; }
      if (!$('profileView').hidden) { if (profile) { showMain(); if (window.UI) UI.go('settings'); } else CapApp.exitApp(); return; }
      const nav = document.querySelector('.nav[aria-current=page]');
      if (nav && nav.dataset.nav !== 'scan' && window.UI) { UI.go('scan'); return; }
      CapApp.exitApp();
    });
  } catch (e) { /* not running inside Capacitor */ }
})();
