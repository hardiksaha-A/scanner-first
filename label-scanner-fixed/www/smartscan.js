// Smart scanner: tries several ways of reading a label photo and keeps the best result.
// Handles sideways or upside-down photos, uneven light and shadows, small and huge images.
(function (root) {
  'use strict';
  const GOOD = 18, POOR = 5;
  const load = url => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image')); im.src = url; });
  const scaleFor = im => { const m = Math.max(im.width, im.height); return m < 1100 ? Math.min(4, 1600 / m) : m > 1800 ? 1800 / m : 1; };

  function draw(im, k, rot) { // scaled copy, turned by 0/90/180/270 degrees
    const w = Math.max(1, Math.round(im.width * k)), h = Math.max(1, Math.round(im.height * k)), c = document.createElement('canvas');
    const swap = rot === 90 || rot === 270; c.width = swap ? h : w; c.height = swap ? w : h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high';
    x.translate(c.width / 2, c.height / 2); x.rotate(rot * Math.PI / 180); x.drawImage(im, -w / 2, -h / 2, w, h); return c;
  }
  function toGray(c) { // returns {x, d, g}: context, image data, grey values
    const x = c.getContext('2d', { willReadFrequently: true }), d = x.getImageData(0, 0, c.width, c.height), p = d.data, n = c.width * c.height, g = new Uint8ClampedArray(n);
    for (let i = 0, q = 0; i < n; i++, q += 4) g[i] = (p[q] * 299 + p[q + 1] * 587 + p[q + 2] * 114) / 1000;
    return { x, d, g, n };
  }
  function put(o, vals) { const p = o.d.data; for (let i = 0, q = 0; i < o.n; i++, q += 4) p[q] = p[q + 1] = p[q + 2] = vals[i]; o.x.putImageData(o.d, 0, 0); }
  function stretch(c) { // grey + contrast stretch
    const o = toGray(c), h = new Uint32Array(256); o.g.forEach(v => h[v]++);
    let lo = 0, hi = 255, a = 0; while (lo < 255 && (a += h[lo]) < o.n * 0.02) lo++; a = 0; while (hi > 0 && (a += h[hi]) < o.n * 0.02) hi--;
    const s = hi > lo ? 255 / (hi - lo) : 1, out = new Uint8ClampedArray(o.n); for (let i = 0; i < o.n; i++) out[i] = (o.g[i] - lo) * s; put(o, out); return c;
  }
  function binarize(c) { // black text on white, using the local average so shadows and glare do not matter
    const o = toGray(c), w = c.width, h = c.height, I = new Float64Array((w + 1) * (h + 1));
    for (let y = 1; y <= h; y++) { let row = 0; for (let x = 1; x <= w; x++) { row += o.g[(y - 1) * w + x - 1]; I[y * (w + 1) + x] = I[(y - 1) * (w + 1) + x] + row; } }
    const r = Math.max(8, Math.round(Math.min(w, h) / 24)), out = new Uint8ClampedArray(o.n);
    for (let y = 0; y < h; y++) { const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) { const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), area = (x1 - x0) * (y1 - y0);
        const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
        out[y * w + x] = o.g[y * w + x] < (sum / area) * 0.88 ? 0 : 255; } }
    put(o, out); return c;
  }
  // How useful is this text? More recognised ingredients plus an "Ingredients" heading = better.
  function quality(text) {
    const t = String(text || ''); if (t.trim().length < 8) return 0;
    let r; try { r = root.Engine.analyze(t, {}); } catch (e) { return 0; }
    return r.found.length * 2 + (/ingredient/i.test(t) ? 4 : 0) + Math.round(r.coverage * 3);
  }
  const PLAN = [['normal', 0, 'gray'], ['uneven light', 0, 'bin'], ['turned right', 90, 'gray'], ['turned left', 270, 'gray'], ['upside down', 180, 'gray']];
  async function read(dataUrl, opt) {
    const say = opt.progress || (() => {}), im = await load(dataUrl); let best = null, lastErr = null, plan = PLAN.slice(0, 2);
    for (let i = 0; i < plan.length; i++) {
      const [label, rot, mode] = plan[i]; say('Reading the label (attempt ' + (i + 1) + ': ' + label + ')...');
      const c = draw(im, scaleFor(im), rot); mode === 'bin' ? binarize(c) : stretch(c);
      let text = ''; try { text = await opt.ocr(await new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('encode')), 'image/png'))); } catch (e) { lastErr = e; }
      const q = quality(text); if (!best || q > best.q) best = { text, q, label, rot, tries: i + 1 };
      if (best.q >= (i >= 2 ? 12 : GOOD)) break; // turned photos: accept earlier
      if (i === plan.length - 1 && best.q < POOR && plan.length === 2) plan = plan.concat(PLAN.slice(2)); // nothing useful: try turned photos
    }
    if (!best || (!best.text.trim() && lastErr)) throw lastErr || new Error('ocr');
    return best;
  }
  const api = { read, quality };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SmartScan = api;
})(typeof window !== 'undefined' ? window : globalThis);
