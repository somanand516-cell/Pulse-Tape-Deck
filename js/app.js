/* Pulse Player — library, views, playback, queue, floating window, settings. */
(() => {
  const { $, esc, h, fmt, toast, modal, menu } = UI;
  const media = $('#media');
  const AUDIO_EXT = ['mp3', 'flac', 'wav', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus', 'weba', 'mid', 'midi'];
  const VIDEO_EXT = ['mp4', 'm4v', 'mkv', 'webm', '3gp', 'mov'];
  const extOf = n => (n.split('.').pop() || '').toLowerCase();
  const stripExt = s => s.replace(/\.[^./\\]+$/, '');
  const isMediaName = n => AUDIO_EXT.includes(extOf(n)) || VIDEO_EXT.includes(extOf(n));

  const settings = Object.assign({ theme: 'auto', accent: '#f26b1d', saveFiles: true, autoLyrics: false, resume: true, keySounds: true, tapeFx: true }, DB.local.get('settings', {}));
  const saveSettings = () => DB.local.set('settings', settings);

  const lib = new Map();   // id -> track
  const lrcs = new Map();  // lower-case path or name without extension -> File
  const favorites = new Set(DB.local.get('favorites', []));
  let playlists = DB.local.get('playlists', []);
  const stats = DB.local.get('stats', {});
  const hidden = new Set(DB.local.get('hidden', []));
  let pendingHandles = [];
  const midiCache = new Map();

  const P = { label: 'Mixtape', queue: [], base: [], qi: -1, shuffle: DB.local.get('shuffle', false), repeat: DB.local.get('repeat', 'off'), cur: null, url: null, errors: 0, token: 0, counted: false };
  const view = { name: 'songs', sub: null, sort: DB.local.get('sort', 'title') };

  const saveFavs = () => DB.local.set('favorites', [...favorites]);
  const savePlaylists = () => DB.local.set('playlists', playlists);
  const saveStats = () => DB.local.set('stats', stats);

  /* =================== theme =================== */
  const mqLight = matchMedia('(prefers-color-scheme: light)');
  function currentTheme() {
    if (settings.theme === 'auto') return mqLight.matches ? 'light' : 'dark';
    if (settings.theme === 'daynight') { const hr = new Date().getHours(); return hr >= 7 && hr < 19 ? 'light' : 'dark'; }
    return settings.theme;
  }
  function applyTheme() {
    const t = currentTheme();
    for (const d of [document, pipWin && pipWin.document].filter(Boolean)) {
      d.documentElement.dataset.theme = t;
      d.documentElement.style.setProperty('--accent', settings.accent);
    }
    $('meta[name=theme-color]').content = t === 'light' ? '#c6c6ca' : '#3a3a3e';
  }
  mqLight.addEventListener('change', applyTheme);
  setInterval(() => settings.theme === 'daynight' && applyTheme(), 60000);

  /* =================== library =================== */
  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
  }

  function makeTrack(id, file, path, m, folderFallback) {
    const parts = path.split('/');
    const ext = extOf(file.name);
    return {
      id, file, path, name: file.name, ext,
      folder: parts.length > 1 ? parts.slice(0, -1).join('/') : folderFallback || 'Imported',
      isVideo: VIDEO_EXT.includes(ext), isMidi: ext === 'mid' || ext === 'midi',
      title: m.title || stripExt(file.name), artist: m.artist || 'Unknown artist', album: m.album || 'Unknown album',
      albumArtist: m.albumArtist || '', genre: m.genre || 'Unknown genre', year: m.year || '', trackNo: m.track || '',
      duration: m.duration || 0, picture: m.picture || null, art: m.picture ? URL.createObjectURL(m.picture) : null,
      lyrics: m.lyrics || null, addedAt: m.addedAt || Date.now(), metaRec: m,
    };
  }

  /* entries: File[] or {file, path}[] */
  async function addFiles(entries, opts = {}) {
    const persist = opts.persist ?? settings.saveFiles;
    const list = entries.map(e => e instanceof File ? { file: e, path: e.webkitRelativePath || (opts.folder ? opts.folder + '/' + e.name : e.name) } : e);
    for (const e of list) if (extOf(e.file.name) === 'lrc') {
      lrcs.set(stripExt(e.path).toLowerCase(), e.file);
      lrcs.set(stripExt(e.file.name).toLowerCase(), e.file);
      if (persist) DB.put('files', { id: e.path + '|lrc', path: e.path, file: e.file });
    }
    const todo = list.filter(e => isMediaName(e.file.name));
    if (!todo.length) { if (!opts.quiet && !list.some(e => extOf(e.file.name) === 'lrc')) toast('No supported music or video files found'); return 0; }
    if (persist && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    let added = 0, done = 0;
    const showProgress = !opts.quiet && todo.length > 15;
    await pool(todo, 4, async ({ file, path }) => {
      const id = path + '|' + file.size;
      done++;
      if (showProgress && done % 10 === 0) toast(`Scanning library… ${done}/${todo.length}`, 60000);
      if (lib.has(id)) return;
      if (hidden.has(id)) { if (!opts.explicit) return; hidden.delete(id); DB.local.set('hidden', [...hidden]); }
      let m = await DB.get('meta', id);
      if (!m) { m = await Meta.read(file); m.id = id; m.addedAt = Date.now(); DB.put('meta', m); }
      lib.set(id, makeTrack(id, file, path, m, opts.folder));
      if (persist) DB.put('files', { id, path, file });
      added++;
    });
    if (!opts.quiet) toast(added ? `Added ${added} item${added > 1 ? 's' : ''} to your library` : 'Everything is already in your library');
    if (opts.render !== false) { render(); scanDurations(); }
    return added;
  }
  const userAdd = (files, opts = {}) => addFiles(files, Object.assign({ explicit: true }, opts));

  async function scanHandle(rec, quiet) {
    const out = [];
    async function walk(dir, prefix) {
      for await (const [name, hd] of dir.entries()) {
        if (hd.kind === 'directory') await walk(hd, prefix + name + '/');
        else if (isMediaName(name) || extOf(name) === 'lrc') { try { out.push({ file: await hd.getFile(), path: prefix + name }); } catch { /* unreadable */ } }
      }
    }
    if (!quiet) toast(`Scanning “${rec.handle.name}”…`, 60000);
    await walk(rec.handle, rec.handle.name + '/');
    return addFiles(out, { persist: false, quiet, render: !quiet });
  }

  async function pickFolder() {
    if (!window.showDirectoryPicker) return $('#folderInput').click();
    try {
      const handle = await showDirectoryPicker({ id: 'pulse-music', mode: 'read' });
      const existing = await DB.all('handles');
      for (const r of existing) if (await r.handle.isSameEntry(handle)) return scanHandle(r);
      const rec = { key: handle.name + '-' + Date.now(), handle };
      await DB.put('handles', rec);
      await scanHandle(rec);
    } catch (e) { if (e.name !== 'AbortError') toast('Could not open folder: ' + e.message); }
  }

  async function reconnect() {
    const recs = pendingHandles; pendingHandles = [];
    for (const rec of recs) {
      try { if (await rec.handle.requestPermission({ mode: 'read' }) === 'granted') await scanHandle(rec); else pendingHandles.push(rec); }
      catch { pendingHandles.push(rec); }
    }
    render();
  }

  async function removeTrack(id) {
    const t = lib.get(id); if (!t) return;
    lib.delete(id); hidden.add(id); DB.local.set('hidden', [...hidden]);
    DB.del('files', id); DB.del('meta', id);
    if (t.art) URL.revokeObjectURL(t.art);
    P.queue = P.queue.filter(x => x !== id); P.base = P.base.filter(x => x !== id);
    if (P.cur && P.cur.id === id) { media.pause(); P.cur = null; P.qi = Math.min(P.qi, P.queue.length - 1); $('#bar').classList.add('hidden'); }
    else if (P.cur) P.qi = P.queue.indexOf(P.cur.id);
    render();
  }

  async function clearLibrary() {
    if (!(await UI.confirm('Clear library', 'Remove all songs and videos from Pulse? Your original files are not deleted.', 'Clear'))) return;
    media.pause(); media.removeAttribute('src');
    for (const t of lib.values()) if (t.art) URL.revokeObjectURL(t.art);
    lib.clear(); lrcs.clear(); hidden.clear(); pendingHandles = [];
    await Promise.all([DB.clear('files'), DB.clear('meta'), DB.clear('handles')]);
    DB.local.set('hidden', []); DB.local.set('session', null);
    P.queue = []; P.base = []; P.qi = -1; P.cur = null;
    $('#bar').classList.add('hidden');
    render(); toast('Library cleared');
  }

  let durBusy = false;
  async function scanDurations() {
    if (durBusy) return; durBusy = true;
    const probe = document.createElement('audio'); probe.preload = 'metadata';
    for (const t of [...lib.values()]) {
      if (t.duration || t.isMidi || t.durFail || !lib.has(t.id)) continue;
      const url = URL.createObjectURL(t.file);
      const d = await new Promise(res => {
        let fin = false; const done = v => { if (!fin) { fin = true; res(v); } };
        probe.onloadedmetadata = () => done(probe.duration); probe.onerror = () => done(0);
        probe.src = url; setTimeout(() => done(0), 8000);
      });
      URL.revokeObjectURL(url);
      if (isFinite(d) && d > 0) {
        t.duration = d; t.metaRec.duration = d; DB.put('meta', t.metaRec);
        document.querySelectorAll(`.row[data-id="${CSS.escape(t.id)}"] .dur`).forEach(e => { e.textContent = fmt(d); });
      } else t.durFail = true;
    }
    probe.removeAttribute('src'); durBusy = false;
  }

  /* drag & drop (files and folders) */
  async function entriesFromDrop(dt) {
    const out = [];
    const items = [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    async function walk(entry) {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej)).catch(() => null);
        if (file) out.push({ file, path: entry.fullPath.replace(/^\//, '') });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do { batch = await new Promise(res => reader.readEntries(res, () => res([]))); for (const e of batch) await walk(e); } while (batch.length);
      }
    }
    if (items.length) for (const e of items) await walk(e);
    else out.push(...[...dt.files].map(f => ({ file: f, path: f.name })));
    return out;
  }

  /* =================== views =================== */
  const content = $('#content'), toolbar = $('#toolbar');
  const audioTracks = () => [...lib.values()].filter(t => !t.isVideo);
  const videoTracks = () => [...lib.values()].filter(t => t.isVideo);
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  function sortTracks(list, sort = view.sort) {
    const by = {
      title: (a, b) => coll.compare(a.title, b.title),
      artist: (a, b) => coll.compare(a.artist, b.artist) || coll.compare(a.album, b.album) || (a.trackNo || 0) - (b.trackNo || 0),
      album: (a, b) => coll.compare(a.album, b.album) || (a.trackNo || 0) - (b.trackNo || 0),
      added: (a, b) => b.addedAt - a.addedAt,
      duration: (a, b) => b.duration - a.duration,
      plays: (a, b) => ((stats[b.id] || {}).plays || 0) - ((stats[a.id] || {}).plays || 0),
      track: (a, b) => (a.trackNo || 999) - (b.trackNo || 999) || coll.compare(a.title, b.title),
    }[sort] || (() => 0);
    return list.slice().sort(by);
  }

  function artHTML(t, cls = '') {
    if (t && t.art) return `<div class="art has-img ${cls}" style="background-image:url('${t.art}')"></div>`;
    return `<div class="art ${cls}">${t && t.isVideo ? '▶' : '♪'}</div>`;
  }
  const subtitle = (t, sep) => t.isVideo ? t.folder : t.album === 'Unknown album' ? t.artist : t.artist + sep + t.album;
  function setArt(el, t) {
    if (t && t.art) { el.style.backgroundImage = `url("${t.art}")`; el.classList.add('has-img'); el.textContent = ''; }
    else { el.style.backgroundImage = ''; el.classList.remove('has-img'); el.textContent = t && t.isVideo ? '▶' : '♪'; }
  }

  let observer = null;
  function trackList(ids, ctx = {}) {
    const ul = h('<ul class="list"></ul>');
    let i = 0;
    const sentinel = h('<li style="height:1px"></li>');
    const renderMore = () => {
      const frag = document.createDocumentFragment();
      const end = Math.min(ids.length, i + 150);
      for (; i < end; i++) {
        const t = lib.get(ids[i]); if (!t) continue;
        const li = h(`<li class="row${P.cur && P.cur.id === t.id ? ' playing' : ''}" data-i="${i}" data-id="${esc(t.id)}">
          ${ctx.numbered ? `<span class="idx">${t.trackNo || i + 1}</span>` : ''}${artHTML(t)}
          <div class="meta"><div class="t">${favorites.has(t.id) ? '<span style="color:var(--accent)">♥</span> ' : ''}${esc(t.title)}</div>
          <div class="a">${esc(subtitle(t, ' · '))}</div></div>
          <span class="dur">${t.duration ? fmt(t.duration) : ''}</span>
          <button class="icon-btn sm more" title="More">⋮</button></li>`);
        frag.appendChild(li);
      }
      sentinel.remove();
      ul.appendChild(frag);
      if (i < ids.length) { ul.appendChild(sentinel); observer.observe(sentinel); }
    };
    sentinel._more = renderMore;
    renderMore();
    ul.addEventListener('click', e => {
      const li = e.target.closest('.row'); if (!li) return;
      const idx = +li.dataset.i;
      if (e.target.closest('.more')) return trackMenu(ids[idx], ctx);
      playList(ids, idx, { label: ctx.label || viewLabel() });
    });
    ul.addEventListener('contextmenu', e => { const li = e.target.closest('.row'); if (li) { e.preventDefault(); trackMenu(ids[+li.dataset.i], ctx); } });
    return ul;
  }
  observer = new IntersectionObserver(entries => { for (const en of entries) if (en.isIntersecting) { observer.unobserve(en.target); en.target._more(); } }, { root: content, rootMargin: '600px' });

  function emptyState(title, text) {
    const el = h(`<div class="empty">${Deck.cassette({ title: 'Blank tape', sub: 'insert your music', key: 'blank' })}<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="btns">
      <button class="btn primary" data-a="files">＋ Add files</button><button class="btn" data-a="folder">▤ Add folder</button>
      ${pendingHandles.length ? '<button class="btn" data-a="reconnect">↻ Reconnect saved folders</button>' : ''}</div>
      <p class="muted" style="margin-top:20px">Supports MP3, FLAC, WAV, M4A, AAC, OGG, OPUS, MIDI · MP4, MKV, WEBM, 3GP, MOV<br>You can also drag &amp; drop files or folders here.</p></div>`);
    el.querySelector('[data-a=files]').onclick = () => $('#fileInput').click();
    el.querySelector('[data-a=folder]').onclick = pickFolder;
    const rc = el.querySelector('[data-a=reconnect]'); if (rc) rc.onclick = reconnect;
    return el;
  }

  /* big cassette + embossed SHUFFLE PLAY key at the top of a collection */
  function tapeHead(title, by, ids) {
    const art = ids.map(id => lib.get(id)).find(t => t && t.art);
    const el = h(`<div class="tape-head">${Deck.cassette({ title, sub: 'playlist', key: title, art: art && art.art })}
      <div class="info"><h2>${esc(title)}</h2><div class="by">${esc(by)}</div>
      <div class="btns"><button class="btn" data-s>Shuffle play</button><button class="btn primary" data-p>▶ Play</button></div></div></div>`);
    const go = shuffle => ids.length && playList(ids, shuffle ? Math.floor(Math.random() * ids.length) : 0, { shuffle, label: title });
    el.querySelector('[data-s]').onclick = () => go(true);
    el.querySelector('[data-p]').onclick = () => go(false);
    el.querySelector('.cassette').onclick = () => go(P.shuffle);
    content.appendChild(el);
  }
  function collectionChips() {
    const el = tb(['artists', 'albums', 'genres', 'folders', 'playlists'].map(v => `<button class="chip ${view.name === v ? 'active' : ''}" data-v="${v}">${v === 'playlists' ? 'Playlists' : TITLES[v]}</button>`).join(''));
    el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { view.name = b.dataset.v; view.sub = null; render(); });
  }

  function tb(html) { const el = h(`<div style="display:contents">${html}</div>`); toolbar.appendChild(el); return el; }
  function playButtons(ids, extra = '') {
    const el = tb(`<button class="btn primary" data-p>▶ Play all</button><button class="btn" data-s>⤮ Shuffle</button>${extra}`);
    el.querySelector('[data-p]').onclick = () => ids.length && playList(ids, 0, { shuffle: false });
    el.querySelector('[data-s]').onclick = () => ids.length && playList(ids, Math.floor(Math.random() * ids.length), { shuffle: true });
    return el;
  }
  function sortSelect(options) {
    const el = tb(`<select class="input" title="Sort">${options.map(([v, l]) => `<option value="${v}" ${view.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`);
    el.querySelector('select').onchange = e => { view.sort = e.target.value; DB.local.set('sort', view.sort); render(); };
  }
  const SORTS = [['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['added', 'Recently added'], ['duration', 'Longest'], ['plays', 'Most played']];
  function countLabel(n, word) { tb(`<span class="muted">${n} ${word}${n === 1 ? '' : 's'}</span>`); }
  function backButton() { tb('<button class="chip" data-back>← Back</button>').querySelector('[data-back]').onclick = () => { view.sub = null; render(); }; }

  function banner() {
    if (!pendingHandles.length) return;
    const b = h(`<div class="tool" style="margin-bottom:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span style="flex:1">Your saved music folder needs permission again to load.</span><button class="btn primary">↻ Reconnect</button></div>`);
    b.querySelector('button').onclick = reconnect;
    content.appendChild(b);
  }

  function grid(groups, onOpen, sub, kind) {
    const g = h('<div class="grid"></div>');
    for (const [key, tracks] of groups) {
      const withArt = tracks.find(t => t.art);
      const card = h(`<div class="card">${Deck.cassette({ title: key, sub: kind, key, art: withArt && withArt.art })}
        <div class="t">${esc(key)}</div><div class="a">${esc(sub(tracks))}</div></div>`);
      card.onclick = () => onOpen(key);
      g.appendChild(card);
    }
    return g;
  }
  function groupBy(key, list) {
    const m = new Map();
    for (const t of list) { const k = t[key] || 'Unknown'; if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
    return [...m.entries()].sort((a, b) => coll.compare(a[0], b[0]));
  }

  const TITLES = { songs: 'Home', videos: 'Videos', artists: 'Artists', albums: 'Albums', genres: 'Genres', folders: 'Folders', playlists: 'Collections', tools: 'Tools' };

  function render() {
    toolbar.innerHTML = ''; content.innerHTML = ''; observer.disconnect();
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view.name));
    const q = $('#search').value.trim().toLowerCase();
    const tab = q ? 'search' : ['artists', 'albums', 'genres', 'folders', 'playlists'].includes(view.name) ? 'playlists' : view.name === 'tools' ? 'tools' : 'songs';
    document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    if (q) return renderSearch(q);
    $('#viewTitle').textContent = view.sub ? view.sub.key : TITLES[view.name];
    if (!view.sub && tab === 'playlists') collectionChips();
    VIEWS[view.name]();
    content.scrollTop = 0;
  }

  function subList(tracks, sortKey, ctx) {
    backButton();
    const ids = sortTracks(tracks, sortKey).map(t => t.id);
    const by = view.name === 'albums' && tracks[0] ? 'by ' + (tracks[0].albumArtist || tracks[0].artist) : `${ids.length} track${ids.length === 1 ? '' : 's'}`;
    tapeHead(view.sub.key, by, ids);
    countLabel(ids.length, 'track');
    content.appendChild(trackList(ids, ctx));
  }

  const VIEWS = {
    songs() {
      const list = audioTracks();
      if (!lib.size) return content.appendChild(emptyState('Your library is empty', 'Add music and videos from your device to start listening — everything stays offline on this device.'));
      banner();
      const ids = sortTracks(list).map(t => t.id);
      if (ids.length) tapeHead('All songs', `by you · ${ids.length} song${ids.length === 1 ? '' : 's'}`, ids);
      sortSelect(SORTS); countLabel(ids.length, 'song');
      if (!ids.length) content.appendChild(h('<p class="empty">No songs yet — only videos.</p>'));
      content.appendChild(trackList(ids));
    },
    videos() {
      const ids = sortTracks(videoTracks()).map(t => t.id);
      if (!ids.length) return content.appendChild(emptyState('No videos', 'Add MP4, MKV, WEBM, 3GP or MOV files to watch them here.'));
      playButtons(ids); sortSelect(SORTS.filter(s => s[0] !== 'artist' && s[0] !== 'album')); countLabel(ids.length, 'video');
      content.appendChild(trackList(ids));
    },
    artists() {
      if (view.sub) return subList(audioTracks().filter(t => t.artist === view.sub.key), 'album', {});
      const groups = groupBy('artist', audioTracks());
      countLabel(groups.length, 'artist');
      content.appendChild(grid(groups, k => { view.sub = { key: k }; render(); }, ts => `${ts.length} song${ts.length > 1 ? 's' : ''}`, 'artist'));
    },
    albums() {
      if (view.sub) return subList(audioTracks().filter(t => t.album === view.sub.key), 'track', { numbered: true });
      const groups = groupBy('album', audioTracks());
      countLabel(groups.length, 'album');
      content.appendChild(grid(groups, k => { view.sub = { key: k }; render(); }, ts => ts[0].albumArtist || ts[0].artist, 'album'));
    },
    genres() {
      if (view.sub) return subList(audioTracks().filter(t => t.genre === view.sub.key), 'artist', {});
      const groups = groupBy('genre', audioTracks());
      countLabel(groups.length, 'genre');
      content.appendChild(grid(groups, k => { view.sub = { key: k }; render(); }, ts => `${ts.length} song${ts.length > 1 ? 's' : ''}`, 'genre'));
    },
    folders() {
      if (view.sub) return subList([...lib.values()].filter(t => t.folder === view.sub.key), 'title', {});
      const groups = groupBy('folder', [...lib.values()]);
      tb('<button class="btn" data-f>▤ Add folder</button>').querySelector('[data-f]').onclick = pickFolder;
      countLabel(groups.length, 'folder');
      const ul = h('<ul class="list"></ul>');
      for (const [k, ts] of groups) {
        const li = h(`<li class="row"><div class="art">▤</div><div class="meta"><div class="t">${esc(k.split('/').pop())}</div><div class="a">${esc(k)} · ${ts.length} item${ts.length > 1 ? 's' : ''}</div></div></li>`);
        li.onclick = () => { view.sub = { key: k }; render(); };
        ul.appendChild(li);
      }
      content.appendChild(ul);
    },
    playlists() {
      if (view.sub) return renderPlaylist(view.sub);
      tb('<button class="btn primary" data-n>＋ New playlist</button>').querySelector('[data-n]').onclick = newPlaylist;
      const smart = [
        { kind: 'fav', key: 'Favorites', icon: '♥', ids: () => [...favorites] },
        { kind: 'recent', key: 'Recently played', icon: '◷', ids: recentIds },
        { kind: 'most', key: 'Most played', icon: '★', ids: mostPlayedIds },
        { kind: 'added', key: 'Recently added', icon: '＋', ids: () => sortTracks([...lib.values()], 'added').slice(0, 100).map(t => t.id) },
      ];
      const g = h('<div class="grid"></div>');
      const card = (name, icon, n, open, art) => {
        const c = h(`<div class="card">${Deck.cassette({ title: name, sub: icon === '≡' ? 'playlist' : 'smart mix', key: name, art: art && art.art })}<div class="t">${esc(name)}</div><div class="a">${n} track${n === 1 ? '' : 's'}</div></div>`);
        c.onclick = open; g.appendChild(c);
      };
      for (const s of smart) { const ids = s.ids().filter(id => lib.has(id)); card(s.key, s.icon, ids.length, () => { view.sub = s; render(); }); }
      for (const pl of playlists) {
        const ids = pl.tracks.filter(id => lib.has(id));
        card(pl.name, '≡', ids.length, () => { view.sub = { kind: 'user', key: pl.name, id: pl.id }; render(); }, ids.map(id => lib.get(id)).find(t => t.art));
      }
      content.appendChild(g);
    },
    tools() {
      const tools = [
        ['⚌', 'Equalizer', 'Presets (Rock, Pop, Jazz, Classical, Hip-hop, Metal…), bass boost, reverb & sound field.', () => Tools.equalizer()],
        ['☾', 'Sleep timer', 'Stop the music after a set time or at the end of the current track.', () => Tools.sleepTimer()],
        ['✂', 'Ringtone maker', 'Cut any part of a song, add fades and save it as MP3 or WAV.', () => Tools.ringtone()],
        ['⇄', 'Video to MP3', 'Extract the audio track from your videos as MP3 or WAV.', () => Tools.converter()],
        ['⧉', 'Floating window', 'Pop the player out so you can keep watching or listening in other apps.', floatWindow],
        ['⏩', 'Playback speed', 'Play slower or faster, with or without changing the pitch.', () => Tools.speed()],
        ['◐', 'Graphite / aluminum', 'Switch between the graphite (night) and brushed aluminum (day) finish, or follow the time of day.', openSettings],
        ['◎', 'Tape mode', 'Make any song sound like a real cassette: warm saturation, wow & flutter and a little hiss.', () => { $('#btnTape').click(); }],
        ['⚙', 'Settings & library', 'Manage folders, offline storage, lyrics and more.', openSettings],
      ];
      const g = h('<div class="tools-grid"></div>');
      for (const [ic, name, text, fn] of tools) {
        const b = h(`<button class="tool"><div class="ti">${ic}</div><h3>${name}</h3><p>${text}</p></button>`);
        b.onclick = fn; g.appendChild(b);
      }
      content.appendChild(g);
    },
  };

  function viewLabel() {
    if ($('#search').value.trim()) return 'Search mix';
    if (view.sub) return view.sub.key;
    return { songs: 'All songs', videos: 'Videos' }[view.name] || TITLES[view.name];
  }

  function recentIds() {
    return Object.entries(stats).filter(([, s]) => s.last).sort((a, b) => b[1].last - a[1].last).slice(0, 100).map(([id]) => id);
  }
  function mostPlayedIds() {
    return Object.entries(stats).filter(([, s]) => s.plays).sort((a, b) => b[1].plays - a[1].plays).slice(0, 100).map(([id]) => id);
  }

  function renderPlaylist(sub) {
    $('#viewTitle').textContent = sub.key;
    backButton();
    let ids;
    if (sub.kind === 'user') {
      const pl = playlists.find(p => p.id === sub.id);
      if (!pl) { view.sub = null; return render(); }
      ids = pl.tracks.filter(id => lib.has(id));
      tb('<button class="chip" data-r>✎ Rename</button><button class="chip" data-x>🗑 Delete</button><button class="chip" data-e>⇩ Export M3U</button>');
      tapeHead(pl.name, `mixtape · ${ids.length} track${ids.length === 1 ? '' : 's'}`, ids);
      toolbar.querySelector('[data-r]').onclick = async () => { const n = await UI.prompt('Rename playlist', pl.name); if (n) { pl.name = n; sub.key = n; savePlaylists(); render(); } };
      toolbar.querySelector('[data-x]').onclick = async () => { if (await UI.confirm('Delete playlist', `Delete “${pl.name}”? The songs stay in your library.`, 'Delete')) { playlists = playlists.filter(p => p !== pl); savePlaylists(); view.sub = null; render(); } };
      toolbar.querySelector('[data-e]').onclick = () => {
        const text = '#EXTM3U\n' + ids.map(id => { const t = lib.get(id); return `#EXTINF:${Math.round(t.duration) || -1},${t.artist} - ${t.title}\n${t.path}`; }).join('\n');
        UI.download(new Blob([text], { type: 'audio/x-mpegurl' }), pl.name + '.m3u');
      };
    } else {
      ids = ({ fav: () => [...favorites], recent: recentIds, most: mostPlayedIds, added: () => sortTracks([...lib.values()], 'added').slice(0, 100).map(t => t.id) })[sub.kind]().filter(id => lib.has(id));
      tapeHead(sub.key, `smart mix · ${ids.length} track${ids.length === 1 ? '' : 's'}`, ids);
    }
    countLabel(ids.length, 'track');
    if (!ids.length) content.appendChild(h(`<p class="empty">Nothing here yet.${sub.kind === 'user' ? ' Use ⋮ → “Add to playlist” on any song.' : ''}</p>`));
    content.appendChild(trackList(ids, { playlist: sub.kind === 'user' ? sub.id : null }));
  }

  function renderSearch(q) {
    $('#viewTitle').textContent = 'Search';
    const words = q.split(/\s+/);
    const match = t => { const s = `${t.title} ${t.artist} ${t.album} ${t.genre} ${t.name}`.toLowerCase(); return words.every(w => s.includes(w)); };
    const songs = sortTracks(audioTracks().filter(match)).map(t => t.id);
    const vids = sortTracks(videoTracks().filter(match)).map(t => t.id);
    countLabel(songs.length + vids.length, 'result');
    if (!songs.length && !vids.length) return content.appendChild(h(`<p class="empty">No results for “${esc(q)}”.</p>`));
    if (songs.length) { content.appendChild(h(`<div class="section-h"><h2>Songs</h2></div>`)); content.appendChild(trackList(songs)); }
    if (vids.length) { content.appendChild(h(`<div class="section-h"><h2>Videos</h2></div>`)); content.appendChild(trackList(vids)); }
  }

  /* =================== menus & dialogs =================== */
  function trackMenu(id, ctx = {}) {
    const t = lib.get(id); if (!t) return;
    menu(t.title, [
      { label: '▶  Play now', fn: () => playList([id], 0) },
      { label: '⤵  Play next', fn: () => { playNext(id); toast('Will play next'); } },
      { label: '☷  Add to queue', fn: () => { enqueue(id); toast('Added to queue'); } },
      { label: '≡  Add to playlist…', fn: () => addToPlaylist([id]) },
      { label: favorites.has(id) ? '♡  Remove from favorites' : '♥  Add to favorites', fn: () => toggleFav(id) },
      !t.isVideo && { label: '☺  Go to artist', fn: () => goto('artists', t.artist) },
      !t.isVideo && { label: '◉  Go to album', fn: () => goto('albums', t.album) },
      !t.isVideo && { label: '✂  Make ringtone', fn: () => Tools.ringtone(t) },
      t.isVideo && { label: '⇄  Convert to MP3', fn: () => Tools.converter(t) },
      ctx.playlist && { label: '✕  Remove from this playlist', fn: () => { const pl = playlists.find(p => p.id === ctx.playlist); pl.tracks = pl.tracks.filter(x => x !== id); savePlaylists(); render(); } },
      { label: 'ⓘ  Details', fn: () => trackInfo(t) },
      { label: '🗑  Remove from library', fn: () => removeTrack(id) },
    ]);
  }
  function goto(name, key) { closeNP(); view.name = name; view.sub = { key }; $('#search').value = ''; render(); }

  function trackInfo(t) {
    const rows = [['Title', t.title], ['Artist', t.artist], ['Album', t.album], ['Album artist', t.albumArtist], ['Genre', t.genre], ['Year', t.year], ['Track #', t.trackNo],
      ['Duration', t.duration ? fmt(t.duration) : '—'], ['Format', t.ext.toUpperCase()], ['Size', (t.file.size / 1048576).toFixed(2) + ' MB'], ['Location', t.path],
      ['Plays', (stats[t.id] || {}).plays || 0], ['Lyrics', findLrc(t) ? '.lrc file' : t.lyrics ? 'Embedded' : Lyrics.cached(t) ? 'Saved' : 'None']];
    modal({ title: 'Details', body: `${t.art ? `<img src="${t.art}" style="width:140px;border-radius:12px;display:block;margin-bottom:14px">` : ''}
      <div class="kv">${rows.filter(r => r[1] !== '' && r[1] != null).map(([k, v]) => `<b>${k}</b><span>${esc(v)}</span>`).join('')}</div>` });
  }

  function addToPlaylist(ids) {
    const items = playlists.map(pl => ({ label: '≡  ' + pl.name, fn: () => { pl.tracks.push(...ids.filter(id => !pl.tracks.includes(id))); savePlaylists(); toast(`Added to “${pl.name}”`); } }));
    items.push({ label: '＋  New playlist…', fn: () => newPlaylist(ids) });
    menu('Add to playlist', items);
  }
  async function newPlaylist(ids = []) {
    const name = await UI.prompt('New playlist', '', 'Playlist name');
    if (!name) return;
    playlists.push({ id: 'pl' + Date.now(), name, tracks: Array.isArray(ids) ? ids : [] });
    savePlaylists();
    toast(`Playlist “${name}” created`);
    if (view.name === 'playlists') render();
  }
  function toggleFav(id) {
    if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
    saveFavs();
    if (P.cur && P.cur.id === id) updateFavBtn();
    document.querySelectorAll(`.row[data-id="${CSS.escape(id)}"] .t`).forEach(el => {
      const t = lib.get(id); el.innerHTML = (favorites.has(id) ? '<span style="color:var(--accent)">♥</span> ' : '') + esc(t.title);
    });
    toast(favorites.has(id) ? 'Added to favorites' : 'Removed from favorites');
  }

  /* =================== playback =================== */
  function shuffleArr(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function shuffleQueue() {
    const cur = P.queue[P.qi];
    const rest = shuffleArr(P.queue.filter((_, i) => i !== P.qi));
    P.queue = cur ? [cur, ...rest] : rest;
    P.qi = cur ? 0 : -1;
  }
  function playList(ids, idx, opts = {}) {
    if (opts.shuffle != null && opts.shuffle !== P.shuffle) { P.shuffle = opts.shuffle; DB.local.set('shuffle', P.shuffle); updateModeBtns(); }
    P.base = ids.slice(); P.queue = ids.slice(); P.qi = idx;
    if (opts.label) P.label = opts.label;
    if (P.shuffle) shuffleQueue();
    return loadTrack(P.queue[P.qi], true);
  }
  function enqueue(id) {
    if (!P.cur) return playList([id], 0);
    P.queue.push(id); P.base.push(id); renderQueue();
  }
  function playNext(id) {
    if (!P.cur) return playList([id], 0);
    P.queue.splice(P.qi + 1, 0, id);
    const bi = P.base.indexOf(P.cur.id); P.base.splice(bi + 1, 0, id);
    renderQueue();
  }

  async function loadTrack(id, autoplay, startTime = 0) {
    const t = lib.get(id); if (!t) return;
    const token = ++P.token;
    P.cur = t; P.counted = false; P.autoOpen = autoplay && t.isVideo;
    if (P.url) { URL.revokeObjectURL(P.url); P.url = null; }
    let url;
    if (t.isMidi) {
      url = midiCache.get(id);
      if (!url) {
        toast('Rendering MIDI…', 30000);
        try {
          const buf = await Midi.render(await t.file.arrayBuffer());
          url = URL.createObjectURL(Encode.wav(buf));
          midiCache.set(id, url);
          t.duration = buf.duration;
          document.querySelectorAll(`.row[data-id="${CSS.escape(id)}"] .dur`).forEach(e => { e.textContent = fmt(buf.duration); });
          toast('MIDI ready', 1000);
        } catch (e) { toast('Could not play MIDI: ' + e.message); return; }
        if (token !== P.token) return;
      }
    } else {
      url = P.url = URL.createObjectURL(t.file);
    }
    media.src = url;
    media.playbackRate = media.defaultPlaybackRate;
    if (startTime) media.addEventListener('loadedmetadata', () => { media.currentTime = Math.min(startTime, (media.duration || startTime) - 1); }, { once: true });
    updateNowPlaying();
    loadLyrics(t);
    if (autoplay) play();
    saveSession();
  }

  function play() {
    if (!P.cur) {
      const ids = sortTracks(audioTracks()).map(t => t.id);
      if (ids.length) return playList(ids, 0);
      return toast('Add some music first');
    }
    try { Engine.init(media); } catch (e) { console.warn('audio engine unavailable', e); }
    Engine.resume();
    media.play().catch(e => { if (e.name !== 'AbortError') console.warn(e); });
  }
  function pause() { media.pause(); }
  // cassette-style motor ramp: pitch slides down on stop and up on start
  let rampIv = 0;
  function rampRate(from, to, ms, done) {
    clearInterval(rampIv);
    const keep = media.preservesPitch, t0 = performance.now();
    media.preservesPitch = false;
    media.playbackRate = from;
    rampIv = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      media.playbackRate = Math.max(0.0625, from + (to - from) * k * k);
      if (k >= 1) { clearInterval(rampIv); media.playbackRate = media.defaultPlaybackRate; media.preservesPitch = keep; done && done(); }
    }, 20);
  }
  const tapeFxOn = () => settings.tapeFx && !isVideoActive() && P.cur && !P.cur.isVideo;
  function toggle() {
    if (!P.cur || media.paused) {
      play();
      if (P.cur && tapeFxOn()) rampRate(media.defaultPlaybackRate * 0.35, media.defaultPlaybackRate, 380);
    } else if (tapeFxOn()) {
      const r = media.defaultPlaybackRate;
      rampRate(r, r * 0.08, 520, pause);
    } else pause();
  }
  function next(auto = false) {
    if (!P.queue.length) return;
    if (P.qi < P.queue.length - 1) P.qi++;
    else if (P.repeat === 'all' || !auto) { if (P.shuffle) { P.queue = shuffleArr(P.base.slice()); } P.qi = 0; }
    else { pause(); media.currentTime = 0; return; }
    loadTrack(P.queue[P.qi], true);
  }
  function prev() {
    if (media.currentTime > 3 || !P.queue.length) { media.currentTime = 0; return; }
    if (P.qi > 0) P.qi--;
    else if (P.repeat === 'all') P.qi = P.queue.length - 1;
    else { media.currentTime = 0; return; }
    loadTrack(P.queue[P.qi], true);
  }
  const seekBy = s => { media.currentTime = Math.max(0, Math.min((media.duration || 0) - 0.1, media.currentTime + s)); };
  const isVideoActive = () => !!(P.cur && media.videoWidth > 0);

  media.addEventListener('ended', () => {
    if (P.repeat === 'one') { media.currentTime = 0; play(); }
    else if (Tools.consumeEndOfTrack()) { /* sleep timer: stop here */ }
    else next(true);
  });
  media.addEventListener('error', () => {
    if (!P.cur || !media.getAttribute('src')) return;
    P.errors++;
    toast(`Can't play “${P.cur.title}” — this format isn't supported by your browser`, 3500);
    if (P.errors < 5 && P.qi < P.queue.length - 1) setTimeout(() => next(true), 1500);
  });
  media.addEventListener('playing', () => {
    P.errors = 0;
    if (!P.counted && P.cur) {
      P.counted = true;
      const s = stats[P.cur.id] || (stats[P.cur.id] = { plays: 0 });
      s.plays++; s.last = Date.now(); saveStats();
    }
  });
  media.addEventListener('play', updatePlayState);
  media.addEventListener('pause', () => { updatePlayState(); saveSession(); });
  media.addEventListener('loadedmetadata', () => {
    const t = P.cur; if (!t) return;
    if (isFinite(media.duration) && media.duration > 0 && Math.abs(media.duration - t.duration) > 1 && !t.isMidi) {
      t.duration = media.duration; t.metaRec.duration = media.duration; DB.put('meta', t.metaRec);
    }
    if (P.autoOpen && isVideoActive() && !npOpen() && floater.classList.contains('hidden') && !document.pictureInPictureElement) openNP('art');
    P.autoOpen = false;
    placeVideo();
    progress();
  });
  let lastSave = 0, lastPos = 0;
  media.addEventListener('timeupdate', () => {
    progress();
    const now = Date.now();
    if (now - lastSave > 5000) { lastSave = now; saveSession(); }
    if (now - lastPos > 1000 && 'mediaSession' in navigator && navigator.mediaSession.setPositionState && isFinite(media.duration)) {
      lastPos = now;
      try { navigator.mediaSession.setPositionState({ duration: media.duration, position: Math.min(media.currentTime, media.duration), playbackRate: media.playbackRate }); } catch { /* ignore */ }
    }
  });

  let seeking = false;
  function progress() {
    const d = media.duration || (P.cur && P.cur.duration) || 0, c = media.currentTime || 0;
    const pct = d ? c / d : 0;
    $('#barProgress').style.width = pct * 100 + '%';
    $('#barTime').textContent = `${fmt(c)} / ${fmt(d)}`;
    $('#npDur').textContent = fmt(d);
    if (!seeking) { $('#npCur').textContent = fmt(c); $('#seek').value = pct * 1000; }
    flSeek.value = pct * 1000;
    Deck.setProgress(pct);
    Lyrics.sync(c);
  }

  function updatePlayState() {
    const playing = !media.paused;
    [...document.querySelectorAll('[data-act=toggle]:not(.key)'), ...floater.querySelectorAll('[data-act=toggle]')].forEach(b => { b.textContent = playing ? '⏸' : '▶'; });
    $('#keyPlay').classList.toggle('down', playing);
    $('#playLabel').textContent = playing ? '⏸' : '▶';
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    if (playing) Deck.wake();
  }
  function updateModeBtns() {
    $('#btnShuffle').classList.toggle('on', P.shuffle);
    const r = $('#btnRepeat');
    r.classList.toggle('on', P.repeat !== 'off');
    r.textContent = P.repeat === 'one' ? '↻¹' : '↻';
    r.title = { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: one' }[P.repeat];
  }
  function updateFavBtn() {
    const on = P.cur && favorites.has(P.cur.id);
    $('#npFav').textContent = on ? '♥' : '♡';
    $('#npFav').classList.toggle('on', !!on);
  }

  function updateNowPlaying() {
    const t = P.cur; if (!t) return;
    $('#bar').classList.remove('hidden');
    $('#barTitle').textContent = $('#npTitle').textContent = flTitle.textContent = t.title;
    $('#barArtist').textContent = $('#npArtist').textContent = subtitle(t, ' — ');
    setArt($('#barArt'), t);
    const side = P.queue.length > 1 && P.qi >= Math.ceil(P.queue.length / 2) ? 'B' : 'A';
    $('#sideBadge').textContent = 'SIDE ' + side;
    Deck.setCassette($('#deckCassette'), { title: P.label, sub: t.artist !== 'Unknown artist' ? t.artist : 'playlist', side, key: P.label, art: t.art });
    flArt.innerHTML = Deck.cassette({ title: P.label, sub: t.title, side, key: P.label, art: t.art });
    document.title = `${t.title} · ${t.artist} — Pulse`;
    updateFavBtn();
    document.querySelectorAll('.row.playing').forEach(r => r.classList.remove('playing'));
    document.querySelectorAll(`.row[data-id="${CSS.escape(t.id)}"]`).forEach(r => r.classList.add('playing'));
    renderQueue();
    $('#stage').classList.toggle('video', t.isVideo);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title, artist: t.artist, album: t.album,
        artwork: t.art ? [{ src: t.art, sizes: '512x512', type: t.picture.type || 'image/jpeg' }] : [{ src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      });
    }
  }

  function saveSession() {
    if (!P.cur) return;
    DB.local.set('session', { label: P.label, queue: P.queue, base: P.base, qi: P.qi, time: media.currentTime || 0, id: P.cur.id });
  }
  function restoreSession() {
    const s = DB.local.get('session', null);
    if (!s || !settings.resume || !lib.has(s.id)) return;
    P.queue = s.queue.filter(id => lib.has(id)); P.base = (s.base || s.queue).filter(id => lib.has(id));
    P.qi = Math.max(0, P.queue.indexOf(s.id));
    if (s.label) P.label = s.label;
    loadTrack(s.id, false, s.time);
  }

  if ('mediaSession' in navigator) {
    const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* unsupported action */ } };
    set('play', play); set('pause', pause); set('stop', () => { pause(); media.currentTime = 0; });
    set('previoustrack', prev); set('nexttrack', () => next());
    set('seekbackward', d => seekBy(-(d.seekOffset || 10))); set('seekforward', d => seekBy(d.seekOffset || 10));
    set('seekto', d => { media.currentTime = d.seekTime; });
  }

  /* =================== lyrics =================== */
  function findLrc(t) {
    return lrcs.get(stripExt(t.path).toLowerCase()) || lrcs.get(stripExt(t.name).toLowerCase()) || lrcs.get(`${t.artist} - ${t.title}`.toLowerCase());
  }
  function showOffset() { $('#lyrOffset').textContent = Lyrics.offset ? `offset ${Lyrics.offset > 0 ? '+' : ''}${Lyrics.offset}s` : ''; }
  async function loadLyrics(t) {
    Lyrics.offset = DB.local.get('lyrOff.' + t.id, 0); showOffset();
    const lrc = findLrc(t);
    if (lrc) return Lyrics.show(await lrc.text());
    const c = Lyrics.cached(t); if (c) return Lyrics.show(c);
    if (t.lyrics) return Lyrics.show(t.lyrics);
    Lyrics.show(null);
    if (settings.autoLyrics && navigator.onLine && !t.isVideo) searchLyrics(t, true);
  }
  async function searchLyrics(t, quiet) {
    if (!t) return;
    if (!quiet) Lyrics.show(null, 'Searching online…');
    try { const text = await Lyrics.online(t); if (P.cur === t) Lyrics.show(text); }
    catch (e) { if (!quiet && P.cur === t) Lyrics.show(null, navigator.onLine ? e.message : 'You are offline.'); }
  }
  function nudgeLyrics(d) { if (!P.cur) return; Lyrics.offset += d; DB.local.set('lyrOff.' + P.cur.id, Lyrics.offset); showOffset(); Lyrics.sync(media.currentTime); }

  /* =================== now playing screen =================== */
  const np = $('#np');
  const npOpen = () => !np.classList.contains('hidden');
  function openNP(tab = 'art') {
    if (!P.cur) return toast('Nothing is playing');
    if (!npOpen()) { np.classList.remove('hidden'); history.pushState({ np: 1 }, ''); }
    setTab(tab);
    placeVideo();
  }
  function closeNP(fromPop) {
    if (!npOpen()) return;
    np.classList.add('hidden');
    if (!fromPop && history.state && history.state.np) history.back();
    placeVideo();
  }
  addEventListener('popstate', () => closeNP(true));
  function setTab(tab) {
    np.querySelectorAll('[data-np]').forEach(b => b.classList.toggle('active', b.dataset.np === tab));
    np.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('active', p.dataset.pane === tab));
    if (tab === 'queue') renderQueue();
    if (tab === 'lyrics') { Lyrics.offset = Lyrics.offset; Lyrics.sync(media.currentTime); }
    if (tab === 'art') startViz();
  }

  function renderQueue() {
    const ol = $('#queueList');
    if (!npOpen() || !np.querySelector('[data-pane=queue].active')) return;
    ol.innerHTML = '';
    $('#queueInfo').textContent = `${P.queue.length} in queue${P.shuffle ? ' · shuffled' : ''}`;
    P.queue.forEach((id, i) => {
      const t = lib.get(id); if (!t) return;
      const li = h(`<li class="row${i === P.qi ? ' playing' : ''}"><span class="idx">${i + 1}</span>${artHTML(t)}
        <div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}</div></div>
        <button class="icon-btn sm" data-up title="Move up">↑</button><button class="icon-btn sm" data-rm title="Remove">✕</button></li>`);
      li.onclick = e => {
        if (e.target.closest('[data-rm]')) {
          if (i === P.qi) return toast('That track is playing now');
          P.queue.splice(i, 1); if (i < P.qi) P.qi--; return renderQueue();
        }
        if (e.target.closest('[data-up]')) {
          if (i === 0) return;
          [P.queue[i - 1], P.queue[i]] = [P.queue[i], P.queue[i - 1]];
          if (P.qi === i) P.qi--; else if (P.qi === i - 1) P.qi++;
          return renderQueue();
        }
        P.qi = i; loadTrack(id, true);
      };
      ol.appendChild(li);
    });
    const cur = ol.children[P.qi]; if (cur) cur.scrollIntoView({ block: 'center' });
  }

  const deckVisible = () => npOpen() && !!np.querySelector('[data-pane=art].active') && !isVideoActive() && !document.hidden;
  const startViz = () => Deck.wake();

  /* =================== floating window / video placement =================== */
  const floater = $('#floater'), flTitle = $('#flTitle'), flArt = $('#flArt'), flStage = $('#flStage'), flSeek = $('#flSeek');
  let pipWin = null;
  function placeVideo() {
    const v = isVideoActive();
    $('#stage').classList.toggle('video', !!(P.cur && (v || P.cur.isVideo)));
    let slot = null;
    if (v) { if (npOpen()) slot = $('#videoSlot'); else if (!floater.classList.contains('hidden') && !pipWin) slot = flStage; }
    if (slot) { if (media.parentElement !== slot) slot.appendChild(media); media.classList.add('show'); }
    else { if (media.parentElement !== document.body) document.body.appendChild(media); media.classList.remove('show'); }
    flArt.classList.toggle('hidden', slot === flStage);
  }
  function showFloater(on) {
    floater.classList.toggle('hidden', !on);
    placeVideo();
  }
  async function floatWindow() {
    if (!P.cur) return toast('Play something first');
    if (pipWin) { pipWin.close(); return; }
    if (document.pictureInPictureElement) { document.exitPictureInPicture(); return; }
    if (isVideoActive() && document.pictureInPictureEnabled) {
      try { closeNP(); await media.requestPictureInPicture(); return; } catch (e) { console.warn(e); }
    }
    if ('documentPictureInPicture' in window) {
      try { await openDocPip(); return; } catch (e) { console.warn(e); }
    }
    closeNP();
    showFloater(floater.classList.contains('hidden'));
  }
  async function openDocPip() {
    pipWin = await documentPictureInPicture.requestWindow({ width: 340, height: 320 });
    const d = pipWin.document;
    for (const ss of document.styleSheets) {
      try { const st = d.createElement('style'); st.textContent = [...ss.cssRules].map(r => r.cssText).join('\n'); d.head.appendChild(st); }
      catch { const l = d.createElement('link'); l.rel = 'stylesheet'; l.href = ss.href; d.head.appendChild(l); }
    }
    d.title = 'Pulse mini player';
    applyTheme();
    floater.classList.remove('hidden'); floater.classList.add('in-pip');
    d.body.appendChild(floater);
    placeVideo();
    pipWin.addEventListener('pagehide', () => {
      floater.classList.remove('in-pip'); floater.classList.add('hidden');
      $('#app').appendChild(floater);
      pipWin = null; placeVideo();
    });
  }
  async function pipVideo() {
    if (!isVideoActive()) return toast('Picture-in-picture is for videos — use the floating window for music');
    if (!document.pictureInPictureEnabled) return toast('Picture-in-picture is not supported in this browser');
    try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await media.requestPictureInPicture(); } catch (e) { toast(e.message); }
  }
  function fullscreen() {
    if (!isVideoActive()) return toast('Full screen is for videos');
    if (document.fullscreenElement) document.exitFullscreen(); else (media.requestFullscreen || media.webkitEnterFullscreen).call(media);
  }
  media.addEventListener('leavepictureinpicture', () => setTimeout(placeVideo));

  // drag the in-app floater
  floater.querySelector('#flHead').addEventListener('pointerdown', e => {
    if (e.target.closest('button') || pipWin) return;
    const r = floater.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
    const head = e.currentTarget;
    head.setPointerCapture(e.pointerId);
    head.onpointermove = ev => {
      floater.style.left = Math.max(0, Math.min(innerWidth - r.width, ev.clientX - ox)) + 'px';
      floater.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - oy)) + 'px';
      floater.style.right = 'auto'; floater.style.bottom = 'auto';
    };
    head.onpointerup = () => { head.onpointermove = null; };
  });
  floater.querySelector('#flClose').onclick = () => { if (pipWin) pipWin.close(); else showFloater(false); };
  floater.querySelector('#flExpand').onclick = () => { if (pipWin) { pipWin.close(); window.focus(); } else showFloater(false); openNP(); };
  flSeek.addEventListener('input', e => { if (media.duration) media.currentTime = e.target.value / 1000 * media.duration; });

  /* =================== settings =================== */
  let installEvt = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });

  async function openSettings() {
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null;
    const accents = ['#f26b1d', '#e0a526', '#d23a2a', '#2f8f83', '#3d6fb6', '#8e5bb5', '#6f9440', '#d4486e'];
    const body = h(`<div>
      <h3>Appearance</h3>
      <div class="presets" data-themes>${[['auto', 'Follow system'], ['daynight', 'Day / night by time'], ['light', 'Aluminum (day)'], ['dark', 'Graphite (night)']].map(([v, l]) => `<button class="chip ${settings.theme === v ? 'active' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
      <div class="presets" data-accents>${accents.map(c => `<button class="chip" data-c="${c}" style="background:${c};border-color:${c === settings.accent ? 'var(--fg)' : c};width:34px;height:34px;padding:0" title="${c}"></button>`).join('')}</div>
      <h3>Library</h3>
      <div class="row-btns" style="justify-content:flex-start"><button class="btn" data-a="files">＋ Add files</button><button class="btn" data-a="folder">▤ Add folder</button>
        ${pendingHandles.length ? '<button class="btn" data-a="reconnect">↻ Reconnect folders</button>' : ''}<button class="btn" data-a="rescan">⟳ Rescan folders</button><button class="btn" data-a="clear">🗑 Clear library</button></div>
      <div class="field"><label class="switch"><input type="checkbox" data-s="saveFiles" ${settings.saveFiles ? 'checked' : ''}> Keep an offline copy of added files inside the app (recommended on phones)</label></div>
      <p class="muted">${lib.size} items in library${est ? ` · app storage used: ${(est.usage / 1048576).toFixed(0)} MB of ${(est.quota / 1073741824).toFixed(1)} GB` : ''}</p>
      <h3>Playback &amp; lyrics</h3>
      <div class="field"><label class="switch"><input type="checkbox" data-s="resume" ${settings.resume ? 'checked' : ''}> Resume where I left off</label></div>
      <div class="field"><label class="switch"><input type="checkbox" data-s="tapeFx" ${settings.tapeFx ? 'checked' : ''}> Tape motor effect — pitch slides down on stop and up on start</label></div>
      <div class="field"><label class="switch"><input type="checkbox" data-s="keySounds" ${settings.keySounds ? 'checked' : ''}> Mechanical click sounds on deck keys</label></div>
      <div class="field"><label class="switch"><input type="checkbox" data-s="autoLyrics" ${settings.autoLyrics ? 'checked' : ''}> Automatically find synced lyrics online when none are on the device (lrclib.net)</label></div>
      ${installEvt ? '<h3>App</h3><button class="btn primary" data-a="install">⇩ Install Pulse as an app</button>' : ''}
      <h3>Keyboard shortcuts</h3>
      <p class="muted">Hold ⏮ / ⏭ on the deck to rewind / fast-forward · tap the tape counter to zero it<br>Space play/pause · ←/→ seek 5 s · Shift+←/→ previous/next · ↑/↓ volume · M mute · L lyrics · Q queue · E equalizer · F full screen</p>
    </div>`);
    const m = modal({ title: 'Settings', body, wide: true });
    body.querySelectorAll('[data-themes] [data-v]').forEach(b => b.onclick = () => { settings.theme = b.dataset.v; saveSettings(); applyTheme(); body.querySelectorAll('[data-themes] .chip').forEach(c => c.classList.toggle('active', c === b)); });
    body.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { settings.accent = b.dataset.c; saveSettings(); applyTheme(); body.querySelectorAll('[data-c]').forEach(c => { c.style.borderColor = c === b ? 'var(--fg)' : c.dataset.c; }); });
    body.querySelectorAll('[data-s]').forEach(i => i.onchange = () => { settings[i.dataset.s] = i.checked; saveSettings(); });
    const act = {
      files: () => $('#fileInput').click(), folder: pickFolder, reconnect, clear: () => { m.close(); clearLibrary(); },
      rescan: async () => { const hs = await DB.all('handles'); if (!hs.length) return toast('No saved folders — use “Add folder” first'); for (const r of hs) { try { if (await r.handle.requestPermission({ mode: 'read' }) === 'granted') await scanHandle(r); } catch (e) { toast(e.message); } } },
      install: async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; m.close(); },
    };
    body.querySelectorAll('[data-a]').forEach(b => b.onclick = () => act[b.dataset.a]());
  }

  /* =================== wiring =================== */
  const actions = {
    prev, next: () => next(), toggle,
    lyrics: () => openNP('lyrics'), queue: () => openNP('queue'),
    eq: () => Tools.equalizer(), sleep: () => Tools.sleepTimer(), speed: () => Tools.speed(),
    float: floatWindow, pip: pipVideo, fullscreen,
  };
  const onAct = e => {
    const b = e.target.closest('[data-act]'); if (!b || !actions[b.dataset.act]) return;
    e.stopPropagation();
    if (b.dataset.skip) { delete b.dataset.skip; return; } // the press was a hold-to-scrub
    actions[b.dataset.act]();
  };
  for (const id of ['#bar', '#np', '#floater']) $(id).addEventListener('click', onAct);

  $('#barOpen').onclick = () => openNP('art');
  Deck.init({ media, isVisible: deckVisible, needle: $('#dialNeedle'), fill: $('#dialFill'), vu: [$('#vuL'), $('#vuR')], counter: $('#counter') });
  Deck.hold($('#keyPrev'), -1, seekBy);
  Deck.hold($('#keyNext'), 1, seekBy);
  np.addEventListener('pointerdown', e => { const k = e.target.closest('.key, .led-btn'); if (k && settings.keySounds) Deck.clunk(k.id === 'keyPlay'); });
  const syncTape = () => $('#btnTape').classList.toggle('on', !!Engine.state.tape);
  $('#btnTape').onclick = () => { Engine.set({ tape: !Engine.state.tape }); syncTape(); toast(Engine.state.tape ? 'Tape mode on — warm, wobbly, a little hiss' : 'Tape mode off'); };
  document.addEventListener('tapemode', syncTape);
  syncTape();
  $('#tabbar').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    if (b.dataset.tab === 'search') { view.name = 'songs'; view.sub = null; render(); $('#search').focus(); return; }
    view.name = b.dataset.tab; view.sub = null; $('#search').value = ''; render();
  });
  $('#npClose').onclick = () => closeNP();
  np.querySelectorAll('[data-np]').forEach(b => b.onclick = () => setTab(b.dataset.np));
  $('#npFav').onclick = () => P.cur && toggleFav(P.cur.id);
  $('#npMore').onclick = () => {
    const t = P.cur; if (!t) return;
    menu(t.title, [
      { label: '≡  Add to playlist…', fn: () => addToPlaylist([t.id]) },
      { label: '⧉  In-app floating player', fn: () => { closeNP(); showFloater(true); } },
      !t.isVideo && { label: '☺  Go to artist', fn: () => goto('artists', t.artist) },
      !t.isVideo && { label: '◉  Go to album', fn: () => goto('albums', t.album) },
      !t.isVideo && { label: '✂  Make ringtone', fn: () => Tools.ringtone(t) },
      t.isVideo && { label: '⇄  Convert to MP3', fn: () => Tools.converter(t) },
      { label: 'ⓘ  Details', fn: () => trackInfo(t) },
    ]);
  };
  $('#btnShuffle').onclick = () => {
    P.shuffle = !P.shuffle; DB.local.set('shuffle', P.shuffle);
    if (P.shuffle) shuffleQueue(); else if (P.cur) { P.queue = P.base.slice(); P.qi = Math.max(0, P.queue.indexOf(P.cur.id)); }
    updateModeBtns(); renderQueue(); toast(P.shuffle ? 'Shuffle on' : 'Shuffle off');
  };
  $('#btnRepeat').onclick = () => {
    P.repeat = { off: 'all', all: 'one', one: 'off' }[P.repeat]; DB.local.set('repeat', P.repeat);
    updateModeBtns(); toast({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat this track' }[P.repeat]);
  };
  const seek = $('#seek');
  seek.addEventListener('input', () => { seeking = true; $('#npCur').textContent = fmt(seek.value / 1000 * (media.duration || 0)); });
  seek.addEventListener('change', () => { if (media.duration) media.currentTime = seek.value / 1000 * media.duration; seeking = false; });
  $('.bar-progress').onclick = e => { if (media.duration) { const r = e.currentTarget.getBoundingClientRect(); media.currentTime = (e.clientX - r.left) / r.width * media.duration; } };

  const vol = $('#barVol');
  media.volume = vol.value = DB.local.get('volume', 1);
  vol.oninput = () => { media.volume = +vol.value; DB.local.set('volume', media.volume); };
  media.defaultPlaybackRate = media.playbackRate = DB.local.get('speed', 1);
  media.preservesPitch = DB.local.get('pitch', true);
  $('#speedLabel').textContent = media.playbackRate + 'x';

  $('#lyrLoad').onclick = () => P.cur && $('#lrcInput').click();
  $('#lrcInput').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f || !P.cur) return;
    const text = await f.text(); Lyrics.store(P.cur, text); Lyrics.show(text); toast('Lyrics saved for this track');
  };
  $('#lyrOnline').onclick = () => searchLyrics(P.cur, false);
  $('#lyrMinus').onclick = () => nudgeLyrics(-0.5);
  $('#lyrPlus').onclick = () => nudgeLyrics(0.5);
  $('#queueClear').onclick = () => { P.queue = P.queue.slice(0, P.qi + 1); P.base = P.queue.slice(); renderQueue(); };
  Lyrics.mount($('#lyrics'), t => { media.currentTime = t; if (media.paused) play(); });

  // navigation
  const nav = $('#nav');
  nav.addEventListener('click', e => {
    const b = e.target.closest('.nav-item'); if (!b) return;
    view.name = b.dataset.view; view.sub = null; $('#search').value = '';
    nav.classList.remove('open'); render();
  });
  $('#btnMenu').onclick = e => { e.stopPropagation(); nav.classList.toggle('open'); };
  document.addEventListener('click', e => { if (nav.classList.contains('open') && !nav.contains(e.target)) nav.classList.remove('open'); });
  let searchTimer;
  $('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 150); });
  $('#btnAdd').onclick = () => menu('Add to library', [
    { label: '♫  Add music & video files…', fn: () => $('#fileInput').click() },
    { label: '▤  Add a whole folder…', fn: pickFolder },
    pendingHandles.length && { label: '↻  Reconnect saved folders', fn: reconnect },
  ]);
  $('#btnTheme').onclick = () => { settings.theme = currentTheme() === 'dark' ? 'light' : 'dark'; saveSettings(); applyTheme(); toast(settings.theme === 'dark' ? 'Night theme' : 'Day theme'); };
  $('#btnSettings').onclick = openSettings;
  $('#fileInput').onchange = e => { const f = [...e.target.files]; e.target.value = ''; userAdd(f); };
  $('#folderInput').onchange = e => { const f = [...e.target.files]; e.target.value = ''; userAdd(f); };

  // drag & drop
  let dragDepth = 0;
  addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; $('#dropHint').classList.remove('hidden'); } });
  addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropHint').classList.add('hidden'); } });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', async e => {
    e.preventDefault(); dragDepth = 0; $('#dropHint').classList.add('hidden');
    const entries = await entriesFromDrop(e.dataTransfer);
    if (entries.length) userAdd(entries);
  });

  // keyboard
  addEventListener('keydown', e => {
    if (e.target.matches('input:not([type=range]), select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); toggle(); }
    else if (k === 'ArrowRight') { e.preventDefault(); e.shiftKey ? next() : seekBy(5); }
    else if (k === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? prev() : seekBy(-5); }
    else if (k === 'ArrowUp') { e.preventDefault(); media.volume = vol.value = Math.min(1, media.volume + 0.05); DB.local.set('volume', media.volume); toast(`Volume ${Math.round(media.volume * 100)}%`, 800); }
    else if (k === 'ArrowDown') { e.preventDefault(); media.volume = vol.value = Math.max(0, media.volume - 0.05); DB.local.set('volume', media.volume); toast(`Volume ${Math.round(media.volume * 100)}%`, 800); }
    else if (k === 'm' || k === 'M') { media.muted = !media.muted; toast(media.muted ? 'Muted' : 'Unmuted', 800); }
    else if (k === 'l' || k === 'L') openNP('lyrics');
    else if (k === 'q' || k === 'Q') openNP('queue');
    else if (k === 'e' || k === 'E') Tools.equalizer();
    else if (k === 'f' || k === 'F') fullscreen();
  });

  addEventListener('visibilitychange', () => { if (document.hidden) saveSession(); else if (npOpen()) startViz(); });
  addEventListener('pagehide', saveSession);

  Tools.bind({ media, pause, tracks: () => [...lib.values()], addFiles: userAdd });

  /* =================== startup =================== */
  async function init() {
    applyTheme();
    updateModeBtns();
    render();
    const stored = await DB.all('files');
    if (stored.length) await addFiles(stored.map(r => ({ file: r.file, path: r.path })), { persist: false, quiet: true, render: false });
    const handles = await DB.all('handles');
    for (const rec of handles) {
      try { if (await rec.handle.queryPermission({ mode: 'read' }) === 'granted') await scanHandle(rec, true); else pendingHandles.push(rec); }
      catch { pendingHandles.push(rec); }
    }
    render();
    restoreSession();
    scanDurations();
    if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  init();
})();
