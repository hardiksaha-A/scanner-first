// Barcode number validation (EAN-8, UPC-A, EAN-13, GTIN-14 check digit).
(function (root) {
  'use strict';
  function isValidGtin(code) {
    code = String(code || '').trim();
    if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
    const d = code.split('').map(Number), check = d.pop();
    let sum = 0;
    for (let i = d.length - 1, w = 3; i >= 0; i--, w = 4 - w) sum += d[i] * w;
    return (10 - (sum % 10)) % 10 === check;
  }
  const api = { isValidGtin };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Barcode = api;
})(typeof window !== 'undefined' ? window : globalThis);
