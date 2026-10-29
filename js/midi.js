/* Minimal Standard MIDI File parser + synthesizer. Renders a .mid file to an AudioBuffer
   with an OfflineAudioContext so it can be played (and equalized) like any other track. */
const Midi = (() => {
  function parse(buf) {
    const d = new DataView(buf);
    const u8 = new Uint8Array(buf);
    const tag = o => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
    if (tag(0) !== 'MThd') throw new Error('Not a MIDI file');
    const ntrks = d.getUint16(10), div = d.getUint16(12);
    const events = [];
    let p = 8 + d.getUint32(4);

    for (let t = 0; t < ntrks && p + 8 <= u8.length; t++) {
      if (tag(p) !== 'MTrk') { p += 8 + d.getUint32(p + 4); t--; continue; }
      const end = p + 8 + d.getUint32(p + 4);
      p += 8;
      let tick = 0, status = 0;
      const vlq = () => { let v = 0, b; do { b = u8[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && p < end); return v; };
      while (p < end) {
        tick += vlq();
        let b = u8[p];
        if (b & 0x80) { status = b; p++; } else if (!status) break;
        const type = status >> 4, ch = status & 0x0f;
        if (status === 0xff) {
          const mt = u8[p++]; const len = vlq();
          if (mt === 0x51) events.push({ tick, kind: 'tempo', v: (u8[p] << 16) | (u8[p + 1] << 8) | u8[p + 2] });
          p += len; status = 0;
        } else if (status === 0xf0 || status === 0xf7) {
          p += vlq(); status = 0;
        } else if (type === 0x9 || type === 0x8) {
          const note = u8[p++], vel = u8[p++];
          events.push({ tick, kind: type === 0x9 && vel > 0 ? 'on' : 'off', ch, note, vel });
        } else if (type === 0xb) {
          const cc = u8[p++], val = u8[p++];
          if (cc === 7 || cc === 10 || cc === 11) events.push({ tick, kind: 'cc', ch, cc, val });
        } else if (type === 0xc) {
          events.push({ tick, kind: 'prog', ch, v: u8[p++] });
        } else if (type === 0xd) p += 1;
        else p += 2; // 0xA, 0xE
      }
      p = end;
    }

    events.sort((a, b) => a.tick - b.tick || (a.kind === 'off' ? -1 : 1));
    // ticks -> seconds
    let secPerTick, smpte = false;
    if (div & 0x8000) { smpte = true; secPerTick = 1 / (-(((div >> 8) << 24) >> 24) * (div & 0xff)); }
    else secPerTick = 0.5 / div;
    let lastTick = 0, time = 0;
    for (const e of events) {
      time += (e.tick - lastTick) * secPerTick;
      lastTick = e.tick;
      e.time = time;
      if (e.kind === 'tempo' && !smpte) secPerTick = e.v / 1e6 / div;
    }

    // pair note on/off
    const notes = [], open = new Map();
    const prog = new Array(16).fill(0), vol = new Array(16).fill(100), expr = new Array(16).fill(127), pan = new Array(16).fill(64);
    for (const e of events) {
      if (e.kind === 'prog') prog[e.ch] = e.v;
      else if (e.kind === 'cc') { if (e.cc === 7) vol[e.ch] = e.val; else if (e.cc === 11) expr[e.ch] = e.val; else pan[e.ch] = e.val; }
      else if (e.kind === 'on') {
        const key = e.ch * 128 + e.note;
        if (!open.has(key)) open.set(key, []);
        open.get(key).push({ start: e.time, ch: e.ch, note: e.note, vel: e.vel * vol[e.ch] * expr[e.ch] / (127 * 127 * 127), prog: prog[e.ch], pan: pan[e.ch] });
      } else if (e.kind === 'off') {
        const list = open.get(e.ch * 128 + e.note);
        const n = list && list.shift();
        if (n) { n.end = Math.max(e.time, n.start + 0.03); notes.push(n); }
      }
    }
    for (const list of open.values()) for (const n of list) { n.end = n.start + 1; notes.push(n); }
    return notes;
  }

  const WAVES = ['triangle', 'sine', 'square', 'sawtooth', 'triangle', 'sawtooth', 'sawtooth', 'sawtooth', 'square', 'sine', 'sawtooth', 'square', 'sawtooth', 'triangle', 'sine', 'square'];

  async function render(arrayBuffer) {
    const notes = parse(arrayBuffer);
    if (!notes.length) throw new Error('MIDI file has no notes');
    const length = Math.min(15 * 60, Math.max(...notes.map(n => n.end)) + 2);
    const rate = 32000;
    const ctx = new OfflineAudioContext(2, Math.ceil(length * rate), rate);

    const master = ctx.createDynamicsCompressor();
    master.threshold.value = -12; master.ratio.value = 4;
    const out = ctx.createGain(); out.gain.value = 0.9;
    master.connect(out).connect(ctx.destination);

    const noise = ctx.createBuffer(1, rate, rate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    const panners = [];
    const chanOut = (ch, panVal) => {
      if (!panners[ch]) { panners[ch] = ctx.createStereoPanner(); panners[ch].connect(master); panners[ch].pan.value = (panVal - 64) / 64; }
      return panners[ch];
    };

    for (const n of notes) {
      if (n.start >= length) continue;
      const dest = chanOut(n.ch, n.pan);
      const g = ctx.createGain();
      g.connect(dest);
      const peak = 0.18 * n.vel + 0.01;

      if (n.ch === 9) { // percussion
        const src = ctx.createBufferSource(); src.buffer = noise;
        const f = ctx.createBiquadFilter();
        let decay = 0.12;
        if (n.note === 35 || n.note === 36) {
          const o = ctx.createOscillator(); const og = ctx.createGain();
          o.frequency.setValueAtTime(140, n.start); o.frequency.exponentialRampToValueAtTime(45, n.start + 0.12);
          og.gain.setValueAtTime(peak * 3, n.start); og.gain.exponentialRampToValueAtTime(0.001, n.start + 0.3);
          o.connect(og).connect(dest); o.start(n.start); o.stop(n.start + 0.32);
          continue;
        } else if (n.note === 38 || n.note === 40) { f.type = 'bandpass'; f.frequency.value = 1800; decay = 0.15; }
        else if ([42, 44, 46].includes(n.note)) { f.type = 'highpass'; f.frequency.value = 7000; decay = n.note === 46 ? 0.25 : 0.05; }
        else if ([49, 51, 52, 55, 57, 59].includes(n.note)) { f.type = 'highpass'; f.frequency.value = 5000; decay = 0.6; }
        else { f.type = 'bandpass'; f.frequency.value = 300 + (n.note - 35) * 40; decay = 0.18; }
        g.gain.setValueAtTime(peak * 1.6, n.start); g.gain.exponentialRampToValueAtTime(0.001, n.start + decay);
        src.connect(f).connect(g); src.start(n.start); src.stop(n.start + decay + 0.02);
        continue;
      }

      const family = n.prog >> 3;
      const o = ctx.createOscillator();
      o.type = WAVES[family] || 'triangle';
      o.frequency.value = 440 * Math.pow(2, (n.note - 69) / 12);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = Math.min(12000, o.frequency.value * (o.type === 'sawtooth' || o.type === 'square' ? 4 : 8));
      const sustained = family === 2 || family === 5 || family === 6 || family === 7 || family === 8 || family === 9 || family === 11;
      const attack = family === 5 || family === 6 || family === 11 ? 0.06 : 0.005;
      const lvl = o.type === 'square' || o.type === 'sawtooth' ? peak * 0.45 : peak;
      g.gain.setValueAtTime(0, n.start);
      g.gain.linearRampToValueAtTime(lvl, n.start + attack);
      if (!sustained) g.gain.setTargetAtTime(lvl * 0.25, n.start + attack, 0.35);
      g.gain.setTargetAtTime(0, n.end, 0.08);
      o.connect(lp).connect(g);
      o.start(n.start);
      o.stop(Math.min(length, n.end + 0.5));
    }
    return ctx.startRendering();
  }

  return { render };
})();
