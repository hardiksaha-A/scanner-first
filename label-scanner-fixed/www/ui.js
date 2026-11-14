(() => {
  const $ = id => document.getElementById(id), TK = 'labelscanner.theme';
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function theme(v) {
    if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v; else { delete document.documentElement.dataset.theme; v = 'auto'; }
    try { localStorage.setItem(TK, v); } catch (e) { /* storage unavailable */ }
    document.querySelectorAll('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeSet === v)));
  }
  let saved = 'auto'; try { saved = localStorage.getItem(TK) || 'auto'; } catch (e) { /* ignore */ }
  theme(saved);
  document.querySelectorAll('[data-theme-set]').forEach(b => { b.onclick = () => theme(b.dataset.themeSet); });

  const names = { scan: 'v-scan', history: 'v-history', settings: 'v-settings' };
  function summary() {
    let p = null; try { p = JSON.parse(localStorage.getItem('labelscanner.profile')); } catch (e) { /* ignore */ }
    $('sCountry').value = (p && p.country) || '';
    $('profSummary').innerHTML = p ? '<p><b>' + esc(p.name) + '</b>, age ' + esc(p.age) + (p.country ? ', ' + esc(Countries.name(p.country, I18N.getLang())) : '') + '</p><p>Allergies: ' + (p.allergies && p.allergies.length ? esc(p.allergies.join(', ')) : 'none listed') + '</p>' : '';
  }
  function go(name) {
    Object.keys(names).forEach(k => { $(names[k]).hidden = k !== name; });
    document.querySelectorAll('.nav').forEach(b => { if (b.dataset.nav === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (name === 'settings') summary();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.nav').forEach(b => { b.onclick = () => go(b.dataset.nav); });
  window.UI = { go, guessCountry: () => Countries.guess(navigator.language) };
  const langSels = Array.from(document.querySelectorAll('[data-lang-select]')), countrySels = Array.from(document.querySelectorAll('[data-country-select]'));
  const fillLang = s => { s.innerHTML = I18N.list().map(l => '<option value="' + l.code + '"' + (l.available ? '' : ' disabled') + '>' + esc(l.native) + (l.available ? '' : ' (coming soon)') + '</option>').join(''); s.value = I18N.getLang(); };
  const fillCountry = s => { const v = s.value; s.innerHTML = '<option value="">Prefer not to say</option>' + Countries.list(I18N.getLang()).map(c => '<option value="' + c.code + '">' + esc(c.name) + '</option>').join(''); s.value = v; };
  const refresh = () => { langSels.forEach(fillLang); countrySels.forEach(fillCountry); };
  I18N.init(); refresh(); document.addEventListener('i18n:packs', refresh);
  langSels.forEach(s => { s.onchange = () => { I18N.setLang(s.value); refresh(); }; });
  countrySels.forEach(s => { s.onchange = () => { countrySels.forEach(o => { o.value = s.value; }); if (s.id === 'sCountry') document.dispatchEvent(new CustomEvent('ls:country', { detail: s.value })); }; });

  $('wipeBtn').onclick = () => {
    if (!confirm('Delete your profile, history, favorites and feedback from this device? This cannot be undone.')) return;
    try { localStorage.clear(); } catch (e) { /* ignore */ }
    location.reload();
  };

  // score ring count-up
  new MutationObserver(() => {
    const el = document.querySelector('#result .big'); if (!el || el.dataset.done) return;
    el.dataset.done = '1'; const n = parseInt(el.textContent, 10); if (!(n >= 0)) return;
    if (reduce() || $('result').classList.contains('still')) { el.style.setProperty('--p', n); return; } /* still = same result re-drawn: no replay */
    const t0 = performance.now(), D = 800;
    const step = t => { const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3), v = Math.round(n * e); el.style.setProperty('--p', v); el.textContent = v; if (k < 1) requestAnimationFrame(step); else el.textContent = n; };
    el.textContent = '0'; requestAnimationFrame(step);
  }).observe($('result'), { childList: true });

  // splash
  setTimeout(() => { const s = $('splash'); s.classList.add('out'); setTimeout(() => { s.hidden = true; }, 500); }, reduce() ? 300 : 900);
})();
