// Example language pack (NOT loaded). Copy to lang/xx.js, translate every value, then add
//   <script src="lang/xx.js"></script>
// to index.html next to the other language packs. Use lang/TEMPLATE.json for the full list of English strings.
// Keep the English text on the left EXACTLY as written; only change the right-hand side.
I18N.register('xx', {
  native: 'Name of the language in itself',   // shown in the language list
  dir: 'ltr',                                 // use 'rtl' for Arabic, Hebrew, Urdu...
  strings: {
    'Scan': 'Translated word',
    'Settings': 'Translated word',
    'Scan a product': 'Translated sentence'
  }
});
