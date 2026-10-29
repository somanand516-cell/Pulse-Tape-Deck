/* Audio engine (Web Audio graph with EQ & effects) plus WAV / MP3 encoders. */
const Engine = (() => {
  const FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const PRESETS = {
    'Flat':        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'Rock':        [5, 4, 3, 1, -1, -1, 1, 3, 4, 5],
    'Pop':         [-1, 1, 3, 4, 4, 2, 0, -1, -1, -1],
    'Jazz':        [3, 2, 1, 2, -2, -2, 0, 1, 2, 3],
    'Classical':   [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
    'Hip-hop':     [6, 5, 2, 3, -1, -1, 1, -1, 2, 3],
    'Heavy Metal': [5, 3, 5, 2, -1, -2, 2, 4, 6, 5],
    'Dance':       [6, 5, 2, 0, 0, -2, -2, -2, 0, 0],
    'Electronic':  [5, 4, 1, 0, -2, 2, 1, 1, 4, 5],
    'R&B':         [3, 7, 6, 1, -2, -1, 2, 3, 3, 4],
    'Acoustic':    [4, 4, 3, 1, 2, 2, 3, 3, 3, 2],
    'Vocal':       [-2, -3, -3, 1, 4, 4, 3, 1, 0, -2],
    'Piano':       [2, 1, 0, 2, 3, 1, 3, 4, 3, 3],
    'Bass Boost':  [8, 7, 5, 3, 1, 0, 0, 0, 0, 0],
    'Treble Boost':[0, 0, 0, 0, 0, 1, 3, 5, 7, 8],
  };
  const REVERBS = {
    'Off':          null,
    'Small room':   { secs: 0.6, decay: 3.5, wet: 0.18 },
    'Medium room':  { secs: 1.2, decay: 3, wet: 0.22 },
    'Large room':   { secs: 2.0, decay: 2.6, wet: 0.26 },
    'Concert hall': { secs: 3.2, decay: 2.2, wet: 0.3 },
    'Plate':        { secs: 1.6, decay: 4, wet: 0.25, bright: true },
  };
  const FIELDS = { 'Normal': 100, 'Mono': 0, 'Narrow': 60, 'Wide': 150, 'Stage': 175, '3D Surround': 200 };

  const defaults = { enabled: true, preset: 'Flat', gains: PRESETS.Flat.slice(), preamp: 0, bass: 0, width: 100, field: 'Normal', reverb: 'Off', reverbMix: 0.25, balance: 0, normalize: false, tape: false };
  let s = Object.assign({}, defaults, DB.local.get('eq', {}));
  let ctx = null, n = {};

  function save() { DB.local.set('eq', s); }

  function init(media) {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'playback' });
    n.src = ctx.createMediaElementSource(media);
    n.pre = ctx.createGain();
    n.bands = FREQS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === FREQS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f; b.Q.value = 1.1;
      return b;
    });
    n.bass = ctx.createBiquadFilter(); n.bass.type = 'lowshelf'; n.bass.frequency.value = 110;

    // stereo width via L/R cross-mix (mid/side)
    n.split = ctx.createChannelSplitter(2);
    n.merge = ctx.createChannelMerger(2);
    n.ll = ctx.createGain(); n.rr = ctx.createGain(); n.lr = ctx.createGain(); n.rl = ctx.createGain();
    n.split.connect(n.ll, 0); n.split.connect(n.lr, 0);
    n.split.connect(n.rr, 1); n.split.connect(n.rl, 1);
    n.ll.connect(n.merge, 0, 0); n.rl.connect(n.merge, 0, 0);
    n.rr.connect(n.merge, 0, 1); n.lr.connect(n.merge, 0, 1);

    n.pan = ctx.createStereoPanner();
    n.dry = ctx.createGain();
    n.conv = ctx.createConvolver();
    n.wet = ctx.createGain();
    n.sum = ctx.createGain();
    n.comp = ctx.createDynamicsCompressor();
    n.analyser = ctx.createAnalyser(); n.analyser.fftSize = 2048; n.analyser.smoothingTimeConstant = 0.8;

    let x = n.src.connect(n.pre);
    for (const b of n.bands) x = x.connect(b);
    // tape mode: soft saturation, high roll-off, wow & flutter (modulated delay) and a touch of hiss
    n.tapeIn = ctx.createGain(); n.tapeDry = ctx.createGain(); n.tapeWet = ctx.createGain();
    n.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const v = i / 511.5 - 1; curve[i] = Math.tanh(1.8 * v) / Math.tanh(1.8); }
    n.shaper.curve = curve; n.shaper.oversample = '2x';
    n.tapeLP = ctx.createBiquadFilter(); n.tapeLP.type = 'lowpass'; n.tapeLP.frequency.value = 11000; n.tapeLP.Q.value = 0.5;
    n.wow = ctx.createDelay(0.05); n.wow.delayTime.value = 0.012;
    for (const [hz, depth] of [[0.55, 0.0011], [6.5, 0.00018]]) {
      const lfo = ctx.createOscillator(), g = ctx.createGain();
      lfo.frequency.value = hz; g.gain.value = depth;
      lfo.connect(g).connect(n.wow.delayTime); lfo.start();
    }
    const noise = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = noise.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    n.hiss = ctx.createBufferSource(); n.hiss.buffer = noise; n.hiss.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
    n.hissGain = ctx.createGain(); n.hissGain.gain.value = 0;
    n.hiss.connect(hp).connect(n.hissGain).connect(n.split); n.hiss.start();
    x.connect(n.bass).connect(n.tapeIn);
    n.tapeIn.connect(n.tapeDry).connect(n.split);
    n.tapeIn.connect(n.shaper).connect(n.tapeLP).connect(n.wow).connect(n.tapeWet).connect(n.split);
    n.merge.connect(n.pan);
    n.pan.connect(n.dry).connect(n.sum);
    n.pan.connect(n.conv).connect(n.wet).connect(n.sum);
    n.sum.connect(n.comp).connect(n.analyser).connect(ctx.destination);
    // per-channel analysers for the VU meters
    const meterSplit = ctx.createChannelSplitter(2);
    n.comp.connect(meterSplit);
    n.meters = [0, 1].map(c => { const a = ctx.createAnalyser(); a.fftSize = 1024; meterSplit.connect(a, c); return a; });
    apply();
    return ctx;
  }

  function impulse(r) {
    const len = Math.floor(ctx.sampleRate * r.secs);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        lp = r.bright ? w : lp * 0.6 + w * 0.4; // darker tail for rooms
        d[i] = lp * Math.pow(1 - i / len, r.decay);
      }
    }
    return buf;
  }

  let lastReverb = null;
  function apply() {
    if (!ctx) return;
    const t = ctx.currentTime, on = s.enabled;
    n.pre.gain.setTargetAtTime(Math.pow(10, (on ? s.preamp : 0) / 20), t, 0.02);
    n.bands.forEach((b, i) => b.gain.setTargetAtTime(on ? s.gains[i] : 0, t, 0.02));
    n.bass.gain.setTargetAtTime(on ? s.bass * 0.15 : 0, t, 0.02); // 0..100 -> 0..15 dB
    const w = on ? s.width / 100 : 1;
    n.ll.gain.value = n.rr.gain.value = (1 + w) / 2;
    n.lr.gain.value = n.rl.gain.value = (1 - w) / 2;
    n.pan.pan.setTargetAtTime(on ? s.balance : 0, t, 0.02);
    const r = on ? REVERBS[s.reverb] : null;
    if (r) {
      if (lastReverb !== s.reverb) { n.conv.buffer = impulse(r); lastReverb = s.reverb; }
      n.wet.gain.setTargetAtTime(s.reverbMix, t, 0.05);
      n.dry.gain.setTargetAtTime(1 - s.reverbMix * 0.4, t, 0.05);
    } else {
      n.wet.gain.setTargetAtTime(0, t, 0.05);
      n.dry.gain.setTargetAtTime(1, t, 0.05);
    }
    const tape = on && s.tape;
    n.tapeDry.gain.setTargetAtTime(tape ? 0 : 1, t, 0.03);
    n.tapeWet.gain.setTargetAtTime(tape ? 0.92 : 0, t, 0.03);
    n.hissGain.gain.setTargetAtTime(tape ? 0.004 : 0, t, 0.05);
    const norm = on && s.normalize;
    n.comp.threshold.value = norm ? -24 : 0;
    n.comp.ratio.value = norm ? 6 : 1;
    n.comp.knee.value = norm ? 20 : 0;
    n.comp.attack.value = 0.005; n.comp.release.value = 0.25;
  }

  function set(patch) {
    Object.assign(s, patch);
    if ('gains' in patch && !('preset' in patch)) s.preset = 'Custom';
    if ('width' in patch && !('field' in patch)) s.field = Object.keys(FIELDS).find(k => FIELDS[k] === s.width) || 'Custom';
    apply(); save();
  }
  function preset(name) { if (PRESETS[name]) set({ preset: name, gains: PRESETS[name].slice() }); }
  function field(name) { if (name in FIELDS) set({ field: name, width: FIELDS[name] }); }
  function reset() { s = Object.assign({}, defaults, { gains: PRESETS.Flat.slice() }); apply(); save(); }

  return {
    FREQS, PRESETS, REVERBS, FIELDS, init, set, preset, field, reset,
    get state() { return s; },
    get ctx() { return ctx; },
    get analyser() { return n.analyser; },
    get meters() { return n.meters; },
    resume() { if (ctx && ctx.state === 'suspended') return ctx.resume(); },
  };
})();

/* ---------- encoders ---------- */
const Encode = (() => {
  function wav(buffer, start = 0, end = buffer.length) {
    const ch = Math.min(2, buffer.numberOfChannels), rate = buffer.sampleRate, frames = end - start;
    const ab = new ArrayBuffer(44 + frames * ch * 2), v = new DataView(ab);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + frames * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, frames * ch * 2, true);
    const data = []; for (let c = 0; c < ch; c++) data.push(buffer.getChannelData(c));
    let o = 44;
    for (let i = start; i < end; i++) for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2;
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  let lamePromise = null;
  function loadLame() {
    if (window.lamejs) return Promise.resolve();
    if (lamePromise) return lamePromise;
    const load = src => new Promise((res, rej) => {
      const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = rej; document.head.appendChild(el);
    });
    lamePromise = load('js/vendor/lame.min.js')
      .catch(() => load('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js'))
      .catch(e => { lamePromise = null; throw new Error('MP3 encoder could not be loaded'); });
    return lamePromise;
  }

  const toInt16 = (f32, a, b) => {
    const out = new Int16Array(b - a);
    for (let i = a; i < b; i++) { const x = Math.max(-1, Math.min(1, f32[i])); out[i - a] = x < 0 ? x * 0x8000 : x * 0x7fff; }
    return out;
  };

  async function mp3(buffer, kbps = 192, onProgress) {
    await loadLame();
    const ch = Math.min(2, buffer.numberOfChannels);
    let rate = buffer.sampleRate;
    if (![32000, 44100, 48000, 22050, 24000, 16000].includes(rate)) {
      // resample to 44.1 kHz for the encoder
      const off = new OfflineAudioContext(ch, Math.ceil(buffer.duration * 44100), 44100);
      const src = off.createBufferSource(); src.buffer = buffer; src.connect(off.destination); src.start();
      buffer = await off.startRendering(); rate = 44100;
    }
    const enc = new lamejs.Mp3Encoder(ch, rate, kbps);
    const L = buffer.getChannelData(0), R = ch > 1 ? buffer.getChannelData(1) : null;
    const parts = [], block = 1152 * 20;
    for (let i = 0; i < L.length; i += block) {
      const e = Math.min(L.length, i + block);
      const out = R ? enc.encodeBuffer(toInt16(L, i, e), toInt16(R, i, e)) : enc.encodeBuffer(toInt16(L, i, e));
      if (out.length) parts.push(out);
      if ((i / block) % 25 === 0) { onProgress && onProgress(i / L.length); await new Promise(r => setTimeout(r)); }
    }
    const end = enc.flush(); if (end.length) parts.push(end);
    onProgress && onProgress(1);
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  async function decode(file) {
    const ab = await file.arrayBuffer();
    const ctx = new (window.OfflineAudioContext)(2, 1, 44100);
    if (/\.midi?$/i.test(file.name)) return Midi.render(ab);
    return ctx.decodeAudioData(ab);
  }

  return { wav, mp3, decode, loadLame };
})();
