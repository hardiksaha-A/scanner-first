HOW TO ADD A LANGUAGE
1. Copy lang/_example.js to lang/<code>.js (for example hi.js for Hindi).
2. Fill in 'native', 'dir' and the translations. TEMPLATE.json lists every English text in the app.
3. In index.html add:  <script src="lang/<code>.js"></script>  (the comment shows where).
4. Restart the app. The language appears in the list on the setup screen and in Settings.
Notes: translation matches whole pieces of text. Texts not in your pack stay in English, so you can translate in stages.
Country is a separate setting and is never changed by the language.
