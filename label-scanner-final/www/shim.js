// Replaces Electron preload bridge (window.api) with in-browser OCR + native-HTTP lookups.
(function () {
  const base = location.origin + '/vendor/tess', IDLE_MS = 90000;
  let worker = null, workerP = null, chain = Promise.resolve(), idle = null;
  function getWorker() {
    if (worker) return Promise.resolve(worker);
    if (!workerP) workerP = Promise.resolve().then(() => Tesseract.createWorker('eng', 1, {
      workerPath: base + '/worker.min.js', corePath: base + '/core', langPath: base + '/lang',
      workerBlobURL: false, cacheMethod: 'none', errorHandler: e => console.error('[ocr]', e)
    })).then(w => { worker = w; return w; }, e => { workerP = null; throw e; });
    return workerP;
  }
  async function reset() { const w = worker; worker = null; workerP = null; if (w) { try { await w.terminate(); } catch (e) {} } }
  // The OCR engine holds ~100 MB; free it when idle so Android does not kill the app in the background.
  const armIdle = () => { clearTimeout(idle); idle = setTimeout(reset, IDLE_MS); };
  // Start loading the engine early (when the user opens the camera or picker) so the first scan feels faster.
  function warmup() { try { clearTimeout(idle); getWorker().then(armIdle, () => {}); } catch (e) { /* OCR not available: scanning will report it */ } }
  // image: Blob (preferred, cheap) or data URL. Only plain text is requested; hocr/tsv output is skipped.
  function scanImage(image) {
    const run = async () => {
      let t; clearTimeout(idle);
      try {
        const w = await getWorker();
        const limit = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('OCR timed out')), 90000); });
        const { data } = await Promise.race([w.recognize(image, {}, { text: true }), limit]);
        return data.text;
      } catch (e) { await reset(); throw e; } finally { clearTimeout(t); armIdle(); }
    };
    const p = chain.then(run, run); chain = p.catch(() => {}); return p;
  }
  window.api = {
    scanImage, warmup,
    lookupBarcode: c => window.__lookup.fetchProduct(c),
    findSimilar: t => window.__lookup.findSimilar(t)
  };
})();
