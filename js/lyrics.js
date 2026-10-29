/* Lyrics: LRC parsing, synced display, local .lrc matching and optional online lookup (lrclib.net). */
const Lyrics = (() => {
  function parse(text) {
    const lines = [];
    let offset = 0, timed = false;
    for (const raw of String(text).split(/\r?\n/)) {
      const off = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
      if (off) { offset = +off[1] / 1000; continue; }
      const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
      const words = raw.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
      if (tags.length) {
        timed = true;
        for (const t of tags) lines.push({ time: +t[1] * 60 + parseFloat(t[2].replace(':', '.')), text: words });
      } else if (!/^\[[a-z]+:.*\]$/i.test(raw.trim())) {
        lines.push({ time: null, text: words });
      }
    }
    if (timed) {
      const out = lines.filter(l => l.time != null).sort((a, b) => a.time - b.time);
      out.forEach(l => { l.time = Math.max(0, l.time - offset); });
      return { synced: true, lines: out };
    }
    return { synced: false, lines: lines.filter((l, i, a) => l.text || (i > 0 && a[i - 1].text)) };
  }

  const cacheKey = t => 'lyr.' + t.id;
  function cached(track) { return DB.local.get(cacheKey(track), null); }
  function store(track, text) { DB.local.set(cacheKey(track), text); }

  async function online(track) {
    const q = new URLSearchParams({ track_name: track.title || '', artist_name: track.artist || '' });
    if (track.album) q.set('album_name', track.album);
    if (track.duration) q.set('duration', Math.round(track.duration));
    let res = await fetch('https://lrclib.net/api/get?' + q).catch(() => null);
    let data = res && res.ok ? await res.json() : null;
    if (!data) {
      const s = new URLSearchParams({ q: `${track.artist || ''} ${track.title || ''}`.trim() });
      res = await fetch('https://lrclib.net/api/search?' + s);
      if (!res.ok) throw new Error('Lyrics service unavailable');
      const list = await res.json();
      data = list.find(x => x.syncedLyrics) || list[0];
    }
    const text = data && (data.syncedLyrics || data.plainLyrics);
    if (!text) throw new Error('No lyrics found');
    store(track, text);
    return text;
  }

  /* ---------- view ---------- */
  let el, doc = { synced: false, lines: [] }, cur = -1, userOffset = 0, onSeek;

  function mount(container, seekCb) { el = container; onSeek = seekCb; }

  function show(text, emptyMsg) {
    doc = text ? parse(text) : { synced: false, lines: [] };
    cur = -1;
    el.classList.toggle('plain', !doc.synced);
    el.innerHTML = '';
    if (!doc.lines.length) {
      el.innerHTML = `<div class="empty"><p class="muted">${emptyMsg || 'No lyrics for this track.'}</p>
        <p class="muted">Put a <b>.lrc</b> file with the same name next to the song, embed lyrics in the tags, load one manually or search online.</p></div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    doc.lines.forEach((l, i) => {
      const p = document.createElement('p');
      p.textContent = l.text || '♪';
      if (doc.synced) p.onclick = () => onSeek && onSeek(l.time + userOffset);
      p.dataset.i = i;
      frag.appendChild(p);
    });
    el.appendChild(frag);
    el.scrollTop = 0;
  }

  function sync(time) {
    if (!doc.synced || !el) return;
    const t = time - userOffset;
    let i = cur;
    if (i < 0 || doc.lines[i].time > t || (doc.lines[i + 1] && doc.lines[i + 1].time <= t)) {
      i = -1;
      for (let k = 0; k < doc.lines.length; k++) { if (doc.lines[k].time <= t + 0.05) i = k; else break; }
    }
    if (i === cur) return;
    if (cur >= 0 && el.children[cur]) el.children[cur].classList.remove('cur');
    cur = i;
    const p = el.children[cur];
    if (p) {
      p.classList.add('cur');
      if (el.offsetParent) el.scrollTo({ top: p.offsetTop - el.clientHeight / 2 + p.clientHeight / 2 });
    }
  }

  return {
    parse, online, cached, store, mount, show, sync,
    get offset() { return userOffset; },
    set offset(v) { userOffset = Math.round(v * 10) / 10; cur = -1; },
    get synced() { return doc.synced; },
  };
})();
