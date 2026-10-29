/* Cassette deck visuals: cassette artwork, spinning reels, VU meters, tape counter, dial, key sounds. */
const Deck = (() => {
  const STRIPES = ['#ee6a1f', '#e0a526', '#2f8f83', '#c63b2f', '#3d6fb6', '#8e5bb5', '#6f9440', '#1f8aa0', '#d4486e'];
  const SHELLS = ['#232326', '#2f2f33', '#3b3733', '#1b1d22'];
  const hash = s => { let x = 2166136261; for (const c of String(s)) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return x >>> 0; };
  const colorFor = key => STRIPES[hash(key) % STRIPES.length];
  const shellFor = key => SHELLS[(hash(key) >> 5) % SHELLS.length];
  const xml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const R_MIN = 17, R_MAX = 40;
  let uid = 0;

  function reel(cls) {
    let teeth = '';
    for (let k = 0; k < 6; k++) teeth += `<rect x="-2.2" y="-10.5" width="4.4" height="4.5" rx="1" fill="#1a1a1a" transform="rotate(${k * 60})"/>`;
    return `<g class="${cls}"><circle r="15" fill="#ececec" stroke="#9a9a9a" stroke-width="1"/><circle r="10.5" fill="#1a1a1a"/>${teeth}
      <circle r="3" fill="#ececec"/></g>`;
  }

  /* Cassette as SVG. vertical=true rotates it 90° for the deck window. */
  function cassette({ title = '', sub = 'PLAYLIST', side = 'A', key = title, art = null, vertical = false, progress = 0.5 } = {}) {
    const id = 'c' + (++uid), stripe = colorFor(key), shell = shellFor(key);
    let t = String(title).toUpperCase();
    if (t.length > 24) t = t.slice(0, 23) + '…';
    // fit the title between the side letter and the cover sticker
    const left = 62, right = art ? 306 : 362, avail = right - left;
    let fs = Math.min(30, avail / (Math.max(1, t.length) * 0.86));
    while (fs < 13 && t.length > 4) { t = t.slice(0, -2).replace(/…$/, '') + '…'; fs = Math.min(30, avail / (t.length * 0.86)); }
    const cx = (left + right) / 2;
    const rl = Math.sqrt(R_MIN ** 2 + (R_MAX ** 2 - R_MIN ** 2) * (1 - progress));
    const rr = Math.sqrt(R_MIN ** 2 + (R_MAX ** 2 - R_MIN ** 2) * progress);
    const screws = [[16, 16], [384, 16], [16, 240], [384, 240], [200, 238]].map(([x, y]) =>
      `<g transform="translate(${x} ${y})"><circle r="5.5" fill="#8d8d90" stroke="#000" stroke-opacity=".5"/><path d="M-3.5 0H3.5M0 -3.5V3.5" stroke="#3a3a3a" stroke-width="1.4"/></g>`).join('');
    const body = `
      <defs>
        <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shell}" stop-opacity=".85"/><stop offset=".5" stop-color="${shell}"/><stop offset="1" stop-color="#0c0c0d"/></linearGradient>
        <linearGradient id="${id}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f2e8"/><stop offset="1" stop-color="#e4ddcc"/></linearGradient>
        <clipPath id="${id}w"><rect x="104" y="80" width="192" height="64" rx="10"/></clipPath>
        <clipPath id="${id}a"><rect x="316" y="24" width="48" height="48" rx="4"/></clipPath>
      </defs>
      <rect x="2" y="2" width="396" height="252" rx="16" fill="url(#${id}s)" stroke="#000" stroke-opacity=".6" stroke-width="2"/>
      <rect x="6" y="6" width="388" height="244" rx="13" fill="none" stroke="#fff" stroke-opacity=".07"/>
      <rect x="24" y="16" width="352" height="166" rx="8" fill="url(#${id}l)"/>
      <text x="34" y="56" font-family="'Archivo Black','Arial Black',Impact,sans-serif" font-size="26" fill="#2a2a2a">${xml(side)}</text>
      <text x="${cx}" y="54" text-anchor="middle" font-family="'Archivo Black','Arial Black',Impact,sans-serif" font-size="${fs.toFixed(1)}" fill="#262626">${xml(t)}</text>
      <rect x="${cx - 70}" y="64" width="140" height="3" rx="1.5" fill="#2a2a2a"/>
      <rect x="24" y="108" width="352" height="44" fill="${stripe}"/>
      <rect x="24" y="152" width="352" height="3" fill="#2a2a2a" opacity=".85"/>
      <text x="200" y="172" text-anchor="middle" font-family="'Archivo','Segoe UI',sans-serif" font-weight="800" font-size="10" letter-spacing="4" fill="${stripe}">${xml(String(sub).toUpperCase())}</text>
      ${art ? `<g transform="rotate(4 340 48)"><rect x="313" y="21" width="54" height="54" rx="5" fill="#fff"/><image href="${xml(art)}" x="316" y="24" width="48" height="48" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}a)"/></g>` : ''}
      <rect x="102" y="78" width="196" height="68" rx="12" fill="#0e0e0f"/>
      <g clip-path="url(#${id}w)">
        <rect x="104" y="80" width="192" height="64" fill="#151515"/>
        <circle class="spool-l" cx="152" cy="112" r="${rl.toFixed(1)}" fill="#4a3427"/>
        <circle class="spool-r" cx="248" cy="112" r="${rr.toFixed(1)}" fill="#4a3427"/>
        <rect x="186" y="96" width="28" height="32" rx="3" fill="#000" opacity=".55"/>
        <rect x="104" y="80" width="192" height="26" fill="#fff" opacity=".05"/>
      </g>
      <g transform="translate(152 112)">${reel('reel-l')}</g>
      <g transform="translate(248 112)">${reel('reel-r')}</g>
      <path d="M86 252 L106 204 H294 L314 252 Z" fill="#1d1d1f" stroke="#000" stroke-opacity=".5"/>
      <circle cx="130" cy="234" r="6" fill="#050505"/><circle cx="270" cy="234" r="6" fill="#050505"/>
      <rect x="168" y="222" width="8" height="14" rx="2" fill="#050505"/><rect x="224" y="222" width="8" height="14" rx="2" fill="#050505"/>
      ${screws}`;
    return vertical
      ? `<svg class="cassette" viewBox="0 0 256 400" xmlns="http://www.w3.org/2000/svg"><g transform="translate(256 0) rotate(90)">${body}</g></svg>`
      : `<svg class="cassette" viewBox="0 0 400 256" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  }

  /* ---------- VU meter ---------- */
  function vuSVG(label) {
    let ticks = '';
    for (let i = 0; i <= 10; i++) {
      const a = (-50 + i * 10) * Math.PI / 180, red = i >= 8;
      const r1 = 46, r2 = i % 2 ? 52 : 55;
      ticks += `<line x1="${60 + Math.sin(a) * r1}" y1="${66 - Math.cos(a) * r1}" x2="${60 + Math.sin(a) * r2}" y2="${66 - Math.cos(a) * r2}" stroke="${red ? '#d23a2a' : '#333'}" stroke-width="${i % 2 ? 1 : 1.6}"/>`;
    }
    return `<svg viewBox="0 0 120 70" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="vuFace${label}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf3d8"/><stop offset="1" stop-color="#eadfb8"/></linearGradient></defs>
      <rect width="120" height="70" rx="6" fill="url(#vuFace${label})"/>
      <path d="M${60 + Math.sin(0.524) * 50} ${66 - Math.cos(0.524) * 50} A50 50 0 0 1 ${60 + Math.sin(0.873) * 50} ${66 - Math.cos(0.873) * 50}" stroke="#d23a2a" stroke-width="5" fill="none"/>
      ${ticks}
      <text x="12" y="62" font-size="9" font-family="sans-serif" font-weight="700" fill="#555">${label}</text>
      <text x="108" y="62" font-size="7" text-anchor="end" font-family="sans-serif" fill="#888">VU</text>
      <line class="needle" x1="60" y1="66" x2="60" y2="12" stroke="#1d1d1d" stroke-width="1.4" stroke-linecap="round"/>
      <circle cx="60" cy="66" r="5" fill="#2a2a2a"/>
      <rect width="120" height="70" rx="6" fill="none" stroke="#000" stroke-opacity=".25"/>
    </svg>`;
  }

  /* ---------- state ---------- */
  let media, isVisible, deckEl, reels = [], spools = [], needles = [], counterDigits = [], needleEl, fillEl;
  let angle = [0, 0], vu = [0, 0], lastT = 0, running = false, progress = 0, lastCount = -1;
  let scrub = 0;
  const buf = new Float32Array(1024);

  function init(opts) {
    media = opts.media; isVisible = opts.isVisible;
    needleEl = opts.needle; fillEl = opts.fill;
    opts.vu.forEach((el, i) => { el.innerHTML = vuSVG(i ? 'R' : 'L'); needles[i] = el.querySelector('.needle'); });
    const c = opts.counter;
    c.innerHTML = [0, 1, 2].map(() => `<span class="digit"><span class="roll">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => `<i>${d}</i>`).join('')}</span></span>`).join('');
    counterDigits = [...c.querySelectorAll('.roll')];
    c.onclick = () => { counterZero = media.currentTime; lastCount = -1; renderCounter(); };
  }
  let counterZero = 0;

  function setCassette(el, opts) {
    deckEl = el;
    el.innerHTML = cassette(Object.assign({ vertical: true, progress }, opts));
    reels = [el.querySelector('.reel-l'), el.querySelector('.reel-r')];
    spools = [el.querySelector('.spool-l'), el.querySelector('.spool-r')];
    applyReels();
  }

  function radii() {
    return [Math.sqrt(R_MIN ** 2 + (R_MAX ** 2 - R_MIN ** 2) * (1 - progress)), Math.sqrt(R_MIN ** 2 + (R_MAX ** 2 - R_MIN ** 2) * progress)];
  }
  function applyReels() {
    const r = radii();
    spools.forEach((s, i) => s && s.setAttribute('r', r[i].toFixed(2)));
    reels.forEach((g, i) => g && g.setAttribute('transform', `rotate(${angle[i].toFixed(1)})`));
  }

  function setProgress(p) {
    progress = Math.max(0, Math.min(1, p || 0));
    if (needleEl) needleEl.style.left = progress * 100 + '%';
    if (fillEl) fillEl.style.width = progress * 100 + '%';
    if (!running) applyReels();
  }

  function renderCounter() {
    const v = Math.floor(Math.max(0, media.currentTime - counterZero) * 1.6) % 1000;
    if (v === lastCount) return;
    lastCount = v;
    const s = String(v).padStart(3, '0');
    counterDigits.forEach((d, i) => { d.style.transform = `translateY(-${+s[i] * 10}%)`; });
  }

  function frame(now) {
    if (!isVisible()) { running = false; return; }
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - (lastT || now)) / 1000); lastT = now;
    // tape moves at constant linear speed, so the smaller reel turns faster
    const playing = !media.paused && !media.ended;
    const speed = scrub ? scrub * 260 : playing ? 46 * media.playbackRate : 0;
    if (speed) {
      const r = radii();
      for (let i = 0; i < 2; i++) angle[i] = (angle[i] + speed / r[i] * dt * 57.3) % 360;
    }
    applyReels();
    renderCounter();
    // VU ballistics: quick attack, slower release
    const meters = Engine.meters;
    for (let i = 0; i < 2; i++) {
      let level = 0;
      if (meters && playing) {
        meters[i].getFloatTimeDomainData(buf);
        let sum = 0; for (let k = 0; k < buf.length; k++) sum += buf[k] * buf[k];
        const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-6) + 10;
        level = Math.max(0, Math.min(1, (db + 24) / 27));
      }
      vu[i] += (level - vu[i]) * (level > vu[i] ? 0.45 : 0.12);
      if (needles[i]) needles[i].setAttribute('transform', `rotate(${(-50 + vu[i] * 100).toFixed(1)} 60 66)`);
    }
  }
  function wake() { if (!running && isVisible && isVisible()) { running = true; lastT = 0; requestAnimationFrame(frame); } }

  /* ---------- mechanical key sounds ---------- */
  let sfx = null;
  function clunk(heavy) {
    try {
      sfx = sfx || new (window.AudioContext || window.webkitAudioContext)();
      sfx.resume();
      const t = sfx.currentTime;
      const len = Math.floor(sfx.sampleRate * 0.05), b = sfx.createBuffer(1, len, sfx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
      const src = sfx.createBufferSource(); src.buffer = b;
      const bp = sfx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = heavy ? 900 : 1800; bp.Q.value = 1.2;
      const g = sfx.createGain(); g.gain.value = heavy ? 0.5 : 0.3;
      src.connect(bp).connect(g).connect(sfx.destination); src.start(t);
      const o = sfx.createOscillator(), og = sfx.createGain();
      o.frequency.setValueAtTime(heavy ? 140 : 220, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.06);
      og.gain.setValueAtTime(heavy ? 0.35 : 0.15, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o.connect(og).connect(sfx.destination); o.start(t); o.stop(t + 0.1);
    } catch { /* audio unavailable */ }
  }

  /* hold a key to rewind / fast-forward; a short press keeps its normal click action */
  function hold(el, dir, seek) {
    let timer = 0, iv = 0;
    const stop = () => {
      clearTimeout(timer); clearInterval(iv);
      if (scrub) { scrub = 0; el.dataset.skip = '1'; el.classList.remove('down'); }
    };
    el.addEventListener('pointerdown', () => {
      timer = setTimeout(() => {
        scrub = dir; el.classList.add('down'); wake();
        iv = setInterval(() => seek(dir * 2), 120);
      }, 380);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, stop);
  }

  return { cassette, colorFor, setCassette, setProgress, init, wake, clunk, hold };
})();
