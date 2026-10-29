/* Tag reader for ID3v1/v2 (MP3), FLAC, MP4/M4A/MOV and Ogg/Opus. No external libraries. */
const Meta = (() => {
  const GENRES = ('Blues,Classic Rock,Country,Dance,Disco,Funk,Grunge,Hip-Hop,Jazz,Metal,New Age,Oldies,Other,Pop,R&B,Rap,Reggae,Rock,Techno,Industrial,' +
    'Alternative,Ska,Death Metal,Pranks,Soundtrack,Euro-Techno,Ambient,Trip-Hop,Vocal,Jazz+Funk,Fusion,Trance,Classical,Instrumental,Acid,House,Game,Sound Clip,Gospel,Noise,' +
    'Alt. Rock,Bass,Soul,Punk,Space,Meditative,Instrumental Pop,Instrumental Rock,Ethnic,Gothic,Darkwave,Techno-Industrial,Electronic,Pop-Folk,Eurodance,Dream,Southern Rock,Comedy,Cult,Gangsta,' +
    'Top 40,Christian Rap,Pop/Funk,Jungle,Native American,Cabaret,New Wave,Psychedelic,Rave,Showtunes,Trailer,Lo-Fi,Tribal,Acid Punk,Acid Jazz,Polka,Retro,Musical,Rock & Roll,Hard Rock').split(',');

  const latin1 = new TextDecoder('latin1');
  const utf8 = new TextDecoder('utf-8');
  const utf16le = new TextDecoder('utf-16le');
  const utf16be = new TextDecoder('utf-16be');

  const readSlice = (file, start, end) => file.slice(start, end).arrayBuffer().then(b => new Uint8Array(b));
  const str = (u8, a, b) => latin1.decode(u8.subarray(a, b));
  const be32 = (u8, o) => ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;
  const le32 = (u8, o) => (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
  const synch = (u8, o) => (u8[o] << 21) | (u8[o + 1] << 14) | (u8[o + 2] << 7) | u8[o + 3];
  const clean = s => (s || '').replace(/\0+$/g, '').replace(/^﻿/, '').trim();

  function normGenre(g) {
    g = clean(g);
    const m = g.match(/^\(?(\d+)\)?/);
    if (m && GENRES[+m[1]] && (g === m[0] || g.replace(m[0], '') === '')) return GENRES[+m[1]];
    return g.replace(/^\(\d+\)/, '');
  }

  /* ---------- ID3v2 ---------- */
  function decodeText(u8, enc) {
    if (!u8.length) return '';
    switch (enc) {
      case 0: return latin1.decode(u8);
      case 1: {
        if (u8[0] === 0xFE && u8[1] === 0xFF) return utf16be.decode(u8.subarray(2));
        if (u8[0] === 0xFF && u8[1] === 0xFE) return utf16le.decode(u8.subarray(2));
        return utf16le.decode(u8);
      }
      case 2: return utf16be.decode(u8);
      default: return utf8.decode(u8);
    }
  }
  // index of the string terminator for the given encoding
  function termIdx(u8, start, enc) {
    if (enc === 1 || enc === 2) {
      for (let i = start; i + 1 < u8.length; i += 2) if (u8[i] === 0 && u8[i + 1] === 0) return i;
      return u8.length;
    }
    const i = u8.indexOf(0, start);
    return i < 0 ? u8.length : i;
  }
  const termLen = enc => (enc === 1 || enc === 2) ? 2 : 1;

  async function id3v2(file, out) {
    const head = await readSlice(file, 0, 10);
    if (str(head, 0, 3) !== 'ID3') return false;
    const ver = head[3], flags = head[5], size = synch(head, 6);
    const tag = await readSlice(file, 10, 10 + size);
    let p = 0;
    if (flags & 0x40) p += ver === 4 ? synch(tag, 0) : be32(tag, 0) + 4;
    const idLen = ver === 2 ? 3 : 4, hdrLen = ver === 2 ? 6 : 10;
    const map = ver === 2
      ? { TT2: 'title', TP1: 'artist', TP2: 'albumArtist', TAL: 'album', TCO: 'genre', TYE: 'year', TRK: 'track' }
      : { TIT2: 'title', TPE1: 'artist', TPE2: 'albumArtist', TALB: 'album', TCON: 'genre', TYER: 'year', TDRC: 'year', TRCK: 'track' };

    while (p + hdrLen < tag.length) {
      const id = str(tag, p, p + idLen);
      if (!/^[A-Z0-9]+$/.test(id)) break;
      const fsize = ver === 2 ? (tag[p + 3] << 16 | tag[p + 4] << 8 | tag[p + 5]) : ver === 4 ? synch(tag, p + 4) : be32(tag, p + 4);
      const body = tag.subarray(p + hdrLen, p + hdrLen + fsize);
      p += hdrLen + fsize;
      if (!fsize) continue;
      try {
        if (map[id]) {
          const v = clean(decodeText(body.subarray(1), body[0]));
          if (v && !out[map[id]]) out[map[id]] = v;
        } else if (id === 'APIC' || id === 'PIC') {
          if (out.picture) continue;
          const enc = body[0];
          let i, mime;
          if (id === 'PIC') { mime = 'image/' + str(body, 1, 4).toLowerCase().replace('jpg', 'jpeg'); i = 4; }
          else { const e = body.indexOf(0, 1); mime = str(body, 1, e) || 'image/jpeg'; i = e + 1; }
          i += 1; // picture type
          i = termIdx(body, i, enc) + termLen(enc);
          if (!mime.includes('/')) mime = 'image/' + mime.toLowerCase();
          out.picture = new Blob([body.slice(i)], { type: mime });
        } else if (id === 'USLT' || id === 'ULT') {
          const enc = body[0];
          const d = termIdx(body, 4, enc) + termLen(enc);
          const text = clean(decodeText(body.subarray(d), enc));
          if (text) out.lyrics = text;
        }
      } catch (e) { /* skip broken frame */ }
    }
    if (out.genre) out.genre = normGenre(out.genre);
    return true;
  }

  async function id3v1(file, out) {
    if (file.size < 128) return;
    const t = await readSlice(file, file.size - 128, file.size);
    if (str(t, 0, 3) !== 'TAG') return;
    const s = (a, b) => clean(latin1.decode(t.subarray(a, b)));
    out.title = out.title || s(3, 33);
    out.artist = out.artist || s(33, 63);
    out.album = out.album || s(63, 93);
    out.year = out.year || s(93, 97);
    if (!out.genre && GENRES[t[127]]) out.genre = GENRES[t[127]];
  }

  /* ---------- Vorbis comments (FLAC / Ogg) ---------- */
  function vorbisComments(u8, o, out) {
    const vlen = le32(u8, o); o += 4 + vlen;
    const n = le32(u8, o); o += 4;
    const keys = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', ALBUMARTIST: 'albumArtist', GENRE: 'genre', DATE: 'year', YEAR: 'year', TRACKNUMBER: 'track', LYRICS: 'lyrics', UNSYNCEDLYRICS: 'lyrics' };
    for (let i = 0; i < n && o + 4 <= u8.length; i++) {
      const len = le32(u8, o); o += 4;
      const s = utf8.decode(u8.subarray(o, o + len)); o += len;
      const eq = s.indexOf('=');
      if (eq < 0) continue;
      const k = keys[s.slice(0, eq).toUpperCase()];
      if (k && !out[k]) out[k] = s.slice(eq + 1).trim();
    }
  }

  async function flac(file, out) {
    const h = await readSlice(file, 0, 4);
    if (str(h, 0, 4) !== 'fLaC') return false;
    let pos = 4;
    for (let guard = 0; guard < 64; guard++) {
      const bh = await readSlice(file, pos, pos + 4);
      if (bh.length < 4) break;
      const last = bh[0] & 0x80, type = bh[0] & 0x7f, len = (bh[1] << 16) | (bh[2] << 8) | bh[3];
      const needBody = type === 0 || type === 4 || (type === 6 && !out.picture);
      if (needBody) {
        const b = await readSlice(file, pos + 4, pos + 4 + len);
        if (type === 0) {
          const rate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
          const samples = (b[13] & 0x0f) * 2 ** 32 + be32(b, 14);
          if (rate && samples) out.duration = samples / rate;
        } else if (type === 4) vorbisComments(b, 0, out);
        else if (type === 6) {
          let o = 4;
          const ml = be32(b, o); o += 4; const mime = str(b, o, o + ml); o += ml;
          const dl = be32(b, o); o += 4 + dl + 16;
          const pl = be32(b, o); o += 4;
          out.picture = new Blob([b.slice(o, o + pl)], { type: mime || 'image/jpeg' });
        }
      }
      pos += 4 + len;
      if (last) break;
    }
    return true;
  }

  async function ogg(file, out) {
    const u8 = await readSlice(file, 0, Math.min(file.size, 256 * 1024));
    if (str(u8, 0, 4) !== 'OggS') return false;
    const s = latin1.decode(u8);
    let i = s.indexOf('\x03vorbis'), skip = 7;
    if (i < 0) { i = s.indexOf('OpusTags'); skip = 8; }
    if (i >= 0) { try { vorbisComments(u8, i + skip, out); } catch { /* truncated */ } }
    return true;
  }

  /* ---------- MP4 / M4A / MOV ---------- */
  async function mp4(file, out) {
    const h = await readSlice(file, 0, 12);
    if (str(h, 4, 8) !== 'ftyp') return false;
    // walk top-level atoms to find moov without reading the whole file
    let pos = 0, moov = null;
    while (pos + 8 <= file.size) {
      const a = await readSlice(file, pos, pos + 16);
      let size = be32(a, 0); const type = str(a, 4, 8);
      if (size === 1) size = be32(a, 8) * 2 ** 32 + be32(a, 12);
      else if (size === 0) size = file.size - pos;
      if (size < 8) break;
      if (type === 'moov') { moov = await readSlice(file, pos, pos + size); break; }
      pos += size;
    }
    if (!moov) return true;

    const walk = (u8, start, end, cb) => {
      let o = start;
      while (o + 8 <= end) {
        let size = be32(u8, o); const type = str(u8, o + 4, o + 8);
        if (size === 0) size = end - o;
        if (size < 8) break;
        cb(type, o + 8, o + size);
        o += size;
      }
    };
    const ilstKeys = { '\xa9nam': 'title', '\xa9ART': 'artist', 'aART': 'albumArtist', '\xa9alb': 'album', '\xa9gen': 'genre', '\xa9day': 'year', '\xa9lyr': 'lyrics' };
    walk(moov, 8, moov.length, (type, s, e) => {
      if (type === 'mvhd') {
        const v = moov[s];
        const ts = v === 1 ? be32(moov, s + 20) : be32(moov, s + 12);
        const du = v === 1 ? be32(moov, s + 24) * 2 ** 32 + be32(moov, s + 28) : be32(moov, s + 16);
        if (ts) out.duration = du / ts;
      }
      if (type !== 'udta') return;
      walk(moov, s, e, (t2, s2, e2) => {
        if (t2 !== 'meta') return;
        walk(moov, s2 + 4, e2, (t3, s3, e3) => {
          if (t3 !== 'ilst') return;
          walk(moov, s3, e3, (key, s4, e4) => {
            walk(moov, s4, e4, (dt, s5, e5) => {
              if (dt !== 'data') return;
              const dtype = be32(moov, s5) & 0xffffff;
              const val = moov.subarray(s5 + 8, e5);
              if (ilstKeys[key]) { if (!out[ilstKeys[key]]) out[ilstKeys[key]] = utf8.decode(val).trim(); }
              else if (key === 'trkn' && val.length >= 4) out.track = String((val[2] << 8) | val[3]);
              else if (key === 'gnre' && val.length >= 2) out.genre = out.genre || GENRES[((val[0] << 8) | val[1]) - 1] || '';
              else if (key === 'covr' && !out.picture) out.picture = new Blob([val.slice()], { type: dtype === 14 ? 'image/png' : 'image/jpeg' });
            });
          });
        });
      });
    });
    return true;
  }

  /* ---------- public ---------- */
  function fromFilename(name) {
    const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    const m = base.match(/^(?:\d{1,3}[\s.\-]+)?(.+?)\s+[-–]\s+(.+)$/);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: base.replace(/^\d{1,3}[\s.\-]+(?=\D)/, '') };
  }

  async function read(file) {
    const out = {};
    try {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (ext === 'flac') await flac(file, out);
      else if (['m4a', 'mp4', 'm4v', 'mov', 'aac', '3gp', 'm4b'].includes(ext)) { if (!(await mp4(file, out))) await id3v2(file, out); }
      else if (['ogg', 'opus', 'oga'].includes(ext)) await ogg(file, out);
      else if (!['mid', 'midi', 'wav', 'mkv', 'webm'].includes(ext)) {
        const had = await id3v2(file, out);
        if (!had || !out.title) await id3v1(file, out);
      }
    } catch (e) { console.warn('tag read failed', file.name, e); }
    const fb = fromFilename(file.name);
    out.title = out.title || fb.title;
    out.artist = out.artist || fb.artist || '';
    if (out.track) out.track = parseInt(out.track, 10) || '';
    if (out.year) out.year = String(out.year).slice(0, 4);
    return out;
  }

  return { read, fromFilename };
})();
