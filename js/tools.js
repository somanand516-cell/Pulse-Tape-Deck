/* Tool screens: equalizer, sleep timer, speed, ringtone maker, video-to-MP3 converter. */
const Tools = (() => {
  const { $, esc, h, fmt, toast, modal, download } = UI;
  let app; // { media, pause(), tracks(), addFiles(files) }
  const bind = a => { app = a; };

  /* ---------------- Equalizer ---------------- */
  function equalizer() {
    const s = Engine.state;
    const body = h(`<div>
      <div class="field"><label class="switch"><input type="checkbox" id="eqOn"> Equalizer &amp; effects on</label></div>
      <div class="presets" id="eqPresets"></div>
      <div class="eq-bands" id="eqBands"></div>
      <div class="field"><label>Preamp</label><input type="range" id="eqPre" min="-12" max="12" step="0.5"><span class="val" id="eqPreV"></span></div>
      <div class="field"><label>Bass boost</label><input type="range" id="eqBass" min="0" max="100" step="1"><span class="val" id="eqBassV"></span></div>
      <h3>Sound field</h3>
      <div class="presets" id="eqFields"></div>
      <div class="field"><label>Stereo width</label><input type="range" id="eqWidth" min="0" max="200" step="5"><span class="val" id="eqWidthV"></span></div>
      <div class="field"><label>Balance L/R</label><input type="range" id="eqBal" min="-1" max="1" step="0.05"><span class="val" id="eqBalV"></span></div>
      <h3>Reverb</h3>
      <div class="presets" id="eqReverbs"></div>
      <div class="field"><label>Reverb amount</label><input type="range" id="eqMix" min="0" max="0.8" step="0.02"><span class="val" id="eqMixV"></span></div>
      <div class="field"><label class="switch"><input type="checkbox" id="eqNorm"> Volume normalizer (evens out loud &amp; quiet parts)</label></div>
      <div class="field"><label class="switch"><input type="checkbox" id="eqTape"> Tape mode — warm saturation, wow &amp; flutter and a little hiss</label></div>
      <div class="row-btns"><button class="btn" id="eqReset">Reset all</button><button class="btn primary" data-close>Done</button></div>
    </div>`);
    modal({ title: 'Equalizer', body, wide: true });

    const chips = (root, names, active, fn) => {
      root.innerHTML = '';
      for (const name of names) {
        const c = document.createElement('button');
        c.className = 'chip' + (name === active ? ' active' : '');
        c.textContent = name;
        c.onclick = () => { fn(name); render(); };
        root.appendChild(c);
      }
    };
    const bandsEl = $('#eqBands', body);
    Engine.FREQS.forEach((f, i) => {
      const b = h(`<div class="eq-band"><span class="g"></span><input type="range" min="-12" max="12" step="0.5"><span>${f >= 1000 ? f / 1000 + 'k' : f}</span></div>`);
      $('input', b).oninput = e => { const g = s.gains.slice(); g[i] = +e.target.value; Engine.set({ gains: g }); render(); };
      bandsEl.appendChild(b);
    });
    const bindRange = (id, key, show) => {
      const inp = $('#' + id, body);
      inp.oninput = () => { Engine.set({ [key]: +inp.value }); render(); };
      return () => { inp.value = s[key]; $('#' + id + 'V', body).textContent = show(s[key]); };
    };
    const renders = [
      bindRange('eqPre', 'preamp', v => (v > 0 ? '+' : '') + v + 'dB'),
      bindRange('eqBass', 'bass', v => v + '%'),
      bindRange('eqWidth', 'width', v => v + '%'),
      bindRange('eqBal', 'balance', v => v === 0 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100)),
      bindRange('eqMix', 'reverbMix', v => Math.round(v * 100) + '%'),
    ];
    $('#eqOn', body).onchange = e => Engine.set({ enabled: e.target.checked });
    $('#eqNorm', body).onchange = e => Engine.set({ normalize: e.target.checked });
    $('#eqTape', body).onchange = e => { Engine.set({ tape: e.target.checked }); document.dispatchEvent(new Event('tapemode')); };
    $('#eqReset', body).onclick = () => { Engine.reset(); render(); };

    function render() {
      const st = Engine.state;
      $('#eqOn', body).checked = st.enabled;
      $('#eqNorm', body).checked = st.normalize;
      $('#eqTape', body).checked = st.tape;
      chips($('#eqPresets', body), Object.keys(Engine.PRESETS).concat(st.preset === 'Custom' ? ['Custom'] : []), st.preset, n => Engine.preset(n));
      chips($('#eqFields', body), Object.keys(Engine.FIELDS), st.field, n => Engine.field(n));
      chips($('#eqReverbs', body), Object.keys(Engine.REVERBS), st.reverb, n => Engine.set({ reverb: n }));
      [...bandsEl.children].forEach((b, i) => { $('input', b).value = st.gains[i]; $('.g', b).textContent = (st.gains[i] > 0 ? '+' : '') + st.gains[i]; });
      renders.forEach(r => r());
      body.style.opacity = st.enabled ? 1 : 0.6;
    }
    render();
  }

  /* ---------------- Sleep timer ---------------- */
  const sleep = { endAt: 0, endOfTrack: false, iv: 0 };
  function badge() {
    const el = $('#sleepBadge');
    if (sleep.endOfTrack) el.textContent = 'end';
    else if (sleep.endAt) el.textContent = Math.max(1, Math.ceil((sleep.endAt - Date.now()) / 60000)) + 'm';
    else el.textContent = '';
  }
  function cancelSleep() { clearInterval(sleep.iv); sleep.endAt = 0; sleep.endOfTrack = false; badge(); }
  function fadeAndStop() {
    const m = app.media, v0 = m.volume;
    let i = 0;
    const iv = setInterval(() => {
      i++;
      m.volume = Math.max(0, v0 * (1 - i / 30));
      if (i >= 30) { clearInterval(iv); app.pause(); m.volume = v0; toast('Sleep timer: playback stopped'); }
    }, 200);
  }
  function startSleep(min) {
    cancelSleep();
    sleep.endAt = Date.now() + min * 60000;
    sleep.iv = setInterval(() => {
      if (Date.now() >= sleep.endAt) { cancelSleep(); fadeAndStop(); } else badge();
    }, 5000);
    badge();
    toast(`Music will stop in ${min} min`);
  }
  function sleepTimer() {
    const left = sleep.endAt ? `Stops in about ${Math.ceil((sleep.endAt - Date.now()) / 60000)} min.` : sleep.endOfTrack ? 'Stops at the end of this track.' : 'Off';
    const body = h(`<div>
      <p class="muted">Status: ${left}</p>
      <div class="presets">${[5, 10, 15, 30, 45, 60, 90, 120].map(m => `<button class="chip" data-m="${m}">${m} min</button>`).join('')}</div>
      <div class="field"><label>Custom (min)</label><input class="input" type="number" min="1" max="600" value="20" id="slCustom" style="width:90px"><button class="btn" id="slStart">Start</button></div>
      <div class="row-btns"><button class="btn" id="slEnd">Stop after current track</button><button class="btn" id="slOff">Turn off</button></div>
    </div>`);
    const m = modal({ title: 'Sleep timer', body });
    body.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { startSleep(+b.dataset.m); m.close(); });
    $('#slStart', body).onclick = () => { const v = +$('#slCustom', body).value; if (v > 0) { startSleep(v); m.close(); } };
    $('#slEnd', body).onclick = () => { cancelSleep(); sleep.endOfTrack = true; badge(); toast('Will stop after this track'); m.close(); };
    $('#slOff', body).onclick = () => { cancelSleep(); toast('Sleep timer off'); m.close(); };
  }
  function consumeEndOfTrack() { if (!sleep.endOfTrack) return false; cancelSleep(); toast('Sleep timer: playback stopped'); return true; }

  /* ---------------- Speed ---------------- */
  function speed() {
    const m = app.media;
    const body = h(`<div>
      <div class="presets">${[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(v => `<button class="chip ${m.playbackRate === v ? 'active' : ''}" data-v="${v}">${v}x</button>`).join('')}</div>
      <div class="field"><label>Speed</label><input type="range" min="0.25" max="3" step="0.05" value="${m.playbackRate}" id="spR"><span class="val" id="spV">${m.playbackRate}x</span></div>
      <div class="field"><label class="switch"><input type="checkbox" id="spPitch" ${m.preservesPitch !== false ? 'checked' : ''}> Keep original pitch</label></div>
    </div>`);
    modal({ title: 'Playback speed', body });
    const setV = v => {
      v = Math.round(v * 100) / 100;
      m.playbackRate = v; m.defaultPlaybackRate = v;
      $('#spR', body).value = v; $('#spV', body).textContent = v + 'x';
      $('#speedLabel').textContent = v + 'x';
      body.querySelectorAll('[data-v]').forEach(c => c.classList.toggle('active', +c.dataset.v === v));
      DB.local.set('speed', v);
    };
    body.querySelectorAll('[data-v]').forEach(c => c.onclick = () => setV(+c.dataset.v));
    $('#spR', body).oninput = e => setV(+e.target.value);
    $('#spPitch', body).onchange = e => { m.preservesPitch = e.target.checked; DB.local.set('pitch', e.target.checked); };
  }

  /* ---------------- shared: source picker ---------------- */
  function sourcePicker(filter, label) {
    const tracks = app.tracks().filter(filter);
    return `<div class="field"><label>${label}</label>
      <select class="input" data-src style="flex:1;min-width:0"><option value="">— choose from library —</option>
      ${tracks.map(t => `<option value="${esc(t.id)}">${esc(t.title)}${t.artist ? ' – ' + esc(t.artist) : ''}</option>`).join('')}</select>
      <button class="btn" data-file>Choose file…</button></div>`;
  }
  function wirePicker(root, accept, onPick) {
    $('[data-src]', root).onchange = e => { const t = app.tracks().find(x => x.id === e.target.value); if (t) onPick(t.file, t); };
    $('[data-file]', root).onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept;
      inp.onchange = () => inp.files[0] && onPick(inp.files[0], null);
      inp.click();
    };
  }
  const baseName = f => f.name.replace(/\.[^.]+$/, '');

  /* ---------------- Ringtone maker ---------------- */
  function ringtone(track) {
    const body = h(`<div>
      ${sourcePicker(t => !t.isVideo, 'Song')}
      <div class="wave"><canvas></canvas><div class="sel"></div><div class="ph hidden"></div></div>
      <p class="muted" data-info>Pick a song to start. Tap the waveform to move the nearest marker.</p>
      <div class="field"><label>Start</label><input type="range" data-start min="0" max="1" step="0.01" value="0"><span class="val" data-sv>0:00</span></div>
      <div class="field"><label>End</label><input type="range" data-end min="0" max="1" step="0.01" value="1"><span class="val" data-ev>0:00</span></div>
      <div class="field"><label>Fade in / out</label>
        <label class="switch"><input type="checkbox" data-fi checked> in</label>
        <label class="switch"><input type="checkbox" data-fo checked> out</label></div>
      <div class="field"><label>Format</label><select class="input" data-fmt><option value="mp3">MP3 (192 kbps)</option><option value="wav">WAV</option></select></div>
      <div class="progress hidden"><div></div></div>
      <div class="row-btns"><button class="btn" data-preview disabled>▶ Preview</button><button class="btn primary" data-save disabled>Save ringtone</button></div>
    </div>`);
    let buf = null, srcFile = null, prev = null, raf = 0;
    const pctx = new (window.AudioContext || window.webkitAudioContext)();
    const m = modal({ title: 'Ringtone maker', body, wide: true, onClose: () => { stop(); pctx.close(); } });
    const canvas = $('canvas', body), sel = $('.sel', body), ph = $('.ph', body);
    const inS = $('[data-start]', body), inE = $('[data-end]', body);

    function draw() {
      const dpr = devicePixelRatio || 1, w = canvas.clientWidth, hh = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = hh * dpr;
      const g = canvas.getContext('2d'); g.scale(dpr, dpr);
      g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent');
      const d = buf.getChannelData(0), step = Math.floor(d.length / w);
      for (let x = 0; x < w; x++) {
        let mx = 0;
        for (let i = x * step, e = i + step; i < e; i += 16) mx = Math.max(mx, Math.abs(d[i]));
        const bh = Math.max(1, mx * hh * 0.95);
        g.fillRect(x, (hh - bh) / 2, 1, bh);
      }
    }
    function update() {
      if (!buf) return;
      let s = +inS.value, e = +inE.value;
      if (e <= s + 0.5) { e = Math.min(buf.duration, s + 0.5); inE.value = e; }
      $('[data-sv]', body).textContent = fmt(s);
      $('[data-ev]', body).textContent = fmt(e);
      sel.style.left = (s / buf.duration * 100) + '%';
      sel.style.width = ((e - s) / buf.duration * 100) + '%';
      $('[data-info]', body).textContent = `Selection: ${(e - s).toFixed(1)} s${e - s > 40 ? ' — most phones prefer ringtones under 40 s' : ''}`;
    }
    async function load(file) {
      stop();
      srcFile = file;
      $('[data-info]', body).textContent = 'Decoding audio…';
      try { buf = await Encode.decode(file); }
      catch { buf = null; $('[data-info]', body).textContent = 'Could not decode this file in your browser.'; return; }
      inS.max = inE.max = buf.duration;
      inS.value = Math.min(buf.duration * 0.3, Math.max(0, buf.duration - 30));
      inE.value = Math.min(buf.duration, +inS.value + 30);
      $('[data-preview]', body).disabled = $('[data-save]', body).disabled = false;
      draw(); update();
    }
    function stop() { if (prev) { try { prev.stop(); } catch {} prev = null; } cancelAnimationFrame(raf); ph.classList.add('hidden'); $('[data-preview]', body).textContent = '▶ Preview'; }
    function preview() {
      if (prev) return stop();
      pctx.resume();
      const s = +inS.value, e = +inE.value, len = e - s;
      prev = pctx.createBufferSource(); prev.buffer = buf;
      const g = pctx.createGain();
      const t0 = pctx.currentTime;
      if ($('[data-fi]', body).checked) { g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + Math.min(2, len / 4)); }
      if ($('[data-fo]', body).checked) { g.gain.setValueAtTime(1, t0 + len - Math.min(2, len / 4)); g.gain.linearRampToValueAtTime(0, t0 + len); }
      prev.connect(g).connect(pctx.destination);
      prev.start(0, s, len);
      prev.onended = stop;
      $('[data-preview]', body).textContent = '■ Stop';
      ph.classList.remove('hidden');
      const tick = () => { ph.style.left = ((s + pctx.currentTime - t0) / buf.duration * 100) + '%'; raf = requestAnimationFrame(tick); };
      tick();
    }
    async function save() {
      const s = +inS.value, e = +inE.value, len = e - s, rate = buf.sampleRate;
      const off = new OfflineAudioContext(Math.min(2, buf.numberOfChannels), Math.ceil(len * rate), rate);
      const src = off.createBufferSource(); src.buffer = buf;
      const g = off.createGain(), f = Math.min(2, len / 4);
      if ($('[data-fi]', body).checked) { g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(1, f); }
      if ($('[data-fo]', body).checked) { g.gain.setValueAtTime(1, len - f); g.gain.linearRampToValueAtTime(0, len); }
      src.connect(g).connect(off.destination); src.start(0, s, len);
      const out = await off.startRendering();
      const bar = $('.progress', body); bar.classList.remove('hidden');
      const fmtSel = $('[data-fmt]', body).value;
      try {
        const blob = fmtSel === 'mp3' ? await Encode.mp3(out, 192, p => { bar.firstElementChild.style.width = p * 100 + '%'; }) : Encode.wav(out);
        bar.firstElementChild.style.width = '100%';
        download(blob, `${baseName(srcFile)} (ringtone).${fmtSel}`);
        toast('Ringtone saved to your downloads. Set it in your phone’s sound settings.', 4000);
      } catch (err) { toast(err.message + ' — try WAV instead'); }
    }
    inS.oninput = inE.oninput = update;
    canvas.parentElement.onclick = ev => {
      if (!buf) return;
      const r = canvas.getBoundingClientRect(), t = (ev.clientX - r.left) / r.width * buf.duration;
      if (Math.abs(t - inS.value) < Math.abs(t - inE.value)) inS.value = t; else inE.value = t;
      update();
    };
    $('[data-preview]', body).onclick = preview;
    $('[data-save]', body).onclick = save;
    wirePicker(body, 'audio/*,.mid,.midi', load);
    if (track) { $('[data-src]', body).value = track.id; load(track.file); }
  }

  /* ---------------- Video to MP3 ---------------- */
  // fallback when decodeAudioData can't read the container: play it silently in real time and record the audio
  function captureAudio(file, onProgress) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.src = URL.createObjectURL(file);
      const actx = new AudioContext();
      const dest = actx.createMediaStreamDestination();
      actx.createMediaElementSource(v).connect(dest);
      const rec = new MediaRecorder(dest.stream);
      const chunks = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        URL.revokeObjectURL(v.src);
        try { resolve(await actx.decodeAudioData(await new Blob(chunks).arrayBuffer())); } catch (e) { reject(e); } finally { actx.close(); }
      };
      v.ontimeupdate = () => onProgress(v.currentTime / (v.duration || 1));
      v.onended = () => rec.stop();
      v.onerror = () => { actx.close(); reject(new Error('This video format is not supported by your browser')); };
      v.onloadedmetadata = () => { rec.start(1000); v.play().catch(reject); };
    });
  }

  function converter(track) {
    const body = h(`<div>
      ${sourcePicker(t => t.isVideo, 'Video')}
      <p class="muted" data-info>Extract the soundtrack of a video (MP4, MKV, WEBM, MOV, 3GP) as an MP3.</p>
      <div class="field"><label>Format</label><select class="input" data-fmt><option value="mp3">MP3</option><option value="wav">WAV (lossless)</option></select>
        <select class="input" data-kbps><option>128</option><option selected>192</option><option>256</option><option>320</option></select><span class="muted">kbps</span></div>
      <div class="field"><label class="switch"><input type="checkbox" data-add checked> Add the result to my library</label></div>
      <div class="progress"><div></div></div>
      <div class="row-btns"><button class="btn primary" data-go disabled>Convert</button></div>
    </div>`);
    modal({ title: 'Video to MP3', body });
    let file = null;
    const info = $('[data-info]', body), bar = $('.progress > div', body), go = $('[data-go]', body);
    const pick = f => { file = f; go.disabled = false; info.textContent = `Selected: ${f.name} (${(f.size / 1048576).toFixed(1)} MB)`; bar.style.width = '0'; };
    wirePicker(body, 'video/*,.mkv,.webm,.mov,.3gp,.mp4', pick);
    if (track) { $('[data-src]', body).value = track.id; pick(track.file); }
    $('[data-fmt]', body).onchange = e => { $('[data-kbps]', body).disabled = e.target.value === 'wav'; };

    go.onclick = async () => {
      go.disabled = true;
      const fmtSel = $('[data-fmt]', body).value, kbps = +$('[data-kbps]', body).value;
      try {
        info.textContent = 'Reading audio track…';
        let audio;
        try { audio = await Encode.decode(file); }
        catch {
          info.textContent = 'Extracting audio in real time (this format can’t be decoded directly)…';
          audio = await captureAudio(file, p => { bar.style.width = p * 50 + '%'; });
        }
        info.textContent = 'Encoding…';
        const blob = fmtSel === 'mp3'
          ? await Encode.mp3(audio, kbps, p => { bar.style.width = 50 + p * 50 + '%'; })
          : Encode.wav(audio);
        bar.style.width = '100%';
        const name = `${baseName(file)}.${fmtSel}`;
        download(blob, name);
        if ($('[data-add]', body).checked) await app.addFiles([new File([blob], name, { type: blob.type, lastModified: Date.now() })], { quiet: true, folder: 'Converted' });
        info.textContent = `Done: ${name} (${(blob.size / 1048576).toFixed(1)} MB)`;
        toast('Conversion finished');
      } catch (e) {
        info.textContent = 'Conversion failed: ' + (e.message || e);
      }
      go.disabled = false;
    };
  }

  return { bind, equalizer, sleepTimer, consumeEndOfTrack, speed, ringtone, converter };
})();
