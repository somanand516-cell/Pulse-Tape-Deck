/* Small UI helpers shared by the app and tools. */
const UI = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const hh = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return (hh ? hh + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }

  let toastTimer;
  function toast(msg, ms = 2400) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  const open = [];
  function modal({ title, body, wide = false, onClose }) {
    const wrap = h(`<div class="modal-wrap"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-h"><h2>${esc(title)}</h2><button class="icon-btn" data-close title="Close">✕</button></div>
      <div class="modal-b"></div></div></div>`);
    const b = $('.modal-b', wrap);
    if (typeof body === 'string') b.innerHTML = body; else if (body) b.appendChild(body);
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      wrap.remove(); open.splice(open.indexOf(api), 1);
      onClose && onClose();
    };
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    $('#modalRoot').appendChild(wrap);
    const api = { el: b, root: wrap, close };
    open.push(api);
    return api;
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open.length) { open[open.length - 1].close(); e.stopPropagation(); } }, true);

  function menu(title, items) {
    const list = h('<div class="menu-list"></div>');
    const m = modal({ title, body: list });
    for (const it of items) {
      if (!it) continue;
      const b = document.createElement('button');
      b.textContent = it.label;
      b.onclick = () => { m.close(); it.fn(); };
      list.appendChild(b);
    }
    return m;
  }

  function prompt(title, value = '', placeholder = '') {
    return new Promise(resolve => {
      let done = false;
      const m = modal({
        title,
        body: `<input class="input" style="width:100%" value="${esc(value)}" placeholder="${esc(placeholder)}">
               <div class="row-btns"><button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>OK</button></div>`,
        onClose: () => { if (!done) resolve(null); },
      });
      const inp = $('input', m.el);
      const ok = () => { done = true; const v = inp.value.trim(); m.close(); resolve(v || null); };
      $('[data-ok]', m.el).onclick = ok;
      inp.onkeydown = e => { if (e.key === 'Enter') ok(); };
      setTimeout(() => inp.select(), 30);
    });
  }

  function confirm(title, text, okLabel = 'OK') {
    return new Promise(resolve => {
      let done = false;
      const m = modal({
        title,
        body: `<p>${esc(text)}</p><div class="row-btns"><button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`,
        onClose: () => { if (!done) resolve(false); },
      });
      $('[data-ok]', m.el).onclick = () => { done = true; m.close(); resolve(true); };
    });
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  return { $, esc, h, fmt, toast, modal, menu, prompt, confirm, download };
})();
