const fs = require('fs'), nm = 'node_modules', out = 'www/vendor/tess';
fs.mkdirSync(out + '/core', { recursive: true }); fs.mkdirSync(out + '/lang', { recursive: true });
fs.copyFileSync(nm + '/tesseract.js/dist/tesseract.min.js', out + '/tesseract.min.js');
fs.copyFileSync(nm + '/tesseract.js/dist/worker.min.js', out + '/worker.min.js');
for (const f of fs.readdirSync(nm + '/tesseract.js-core'))
  if (/^tesseract-core.*lstm.*\.(js|wasm)$/.test(f)) fs.copyFileSync(nm + '/tesseract.js-core/' + f, out + '/core/' + f);
fs.copyFileSync(nm + '/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', out + '/lang/eng.traineddata.gz');
console.log('prep ok', fs.readdirSync(out + '/core'));
