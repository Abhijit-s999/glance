/* Glance reader app. Depends on core.js (window.Glance). */
(function () {
'use strict';
const G = window.Glance;
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/* ================= settings and stats ================= */
const DEFAULTS = { wpm: 350, chosen: false, calibrated: 0, font: 'atkinson', theme: 'system', scale: 1,
  weight: G.DEFAULT_TIMING.weight, pauseComma: G.DEFAULT_TIMING.comma, pauseSentence: G.DEFAULT_TIMING.sentence, pausePara: G.DEFAULT_TIMING.para };
const settings = Object.assign({}, DEFAULTS, G.store.get('glance:settings', {}));
// older versions stored small/medium/large and a pauses on/off switch
if (settings.size) { settings.scale = { s: 0.8, m: 1, l: 1.25 }[settings.size] || 1; delete settings.size; }
if (settings.pauses === false) { settings.pauseComma = settings.pauseSentence = settings.pausePara = 0; }
delete settings.pauses;
const saveSettings = () => G.store.set('glance:settings', settings);
const stats = Object.assign({ words: 0, ms: 0 }, G.store.get('glance:stats', {}));
const saveStats = () => G.store.set('glance:stats', stats);
const timing = () => ({ weight: settings.weight, comma: settings.pauseComma, sentence: settings.pauseSentence, para: settings.pausePara });

/* ================= storage: IndexedDB, with an in-memory fallback ================= */
const DB = (() => {
  let dbp = null, ok = true;
  const mem = { meta: new Map(), text: new Map() };
  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('glance', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('meta', { keyPath: 'id' }); r.result.createObjectStore('text', { keyPath: 'id' }); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('blocked'));
      } catch (e) { rej(e); }
    });
    return dbp;
  }
  async function run(store, mode, fn) {
    if (!ok) throw new Error('no db');
    try {
      const db = await open();
      return await new Promise((res, rej) => {
        const t = db.transaction(store, mode); const req = fn(t.objectStore(store));
        t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    } catch (e) { ok = false; throw e; }
  }
  const wrap = (store, mode, fn, fallback) => run(store, mode, fn).catch(() => fallback());
  return {
    get ok() { return ok; },
    allMeta: () => wrap('meta', 'readonly', s => s.getAll(), () => [...mem.meta.values()]),
    getText: id => wrap('text', 'readonly', s => s.get(id), () => mem.text.get(id)),
    putMeta: m => { mem.meta.set(m.id, m); return wrap('meta', 'readwrite', s => s.put(m), () => {}); },
    putText: t => { mem.text.set(t.id, t); return wrap('text', 'readwrite', s => s.put(t), () => {}); },
    remove: async id => { mem.meta.delete(id); mem.text.delete(id); await wrap('meta', 'readwrite', s => s.delete(id), () => {}); await wrap('text', 'readwrite', s => s.delete(id), () => {}); },
  };
})();

/* ================= views ================= */
const views = { home: $('#v-home'), speed: $('#v-speed'), cal: $('#v-cal'), read: $('#v-read') };
let view = null;
function go(name) {
  view = name;
  for (const k in views) views[k].hidden = k !== name;
  if (name !== 'cal') Cal.stopAll();
  if (name !== 'speed') Choose.stop();
  if (name !== 'read') Reader.close();
  if (name === 'home') Home.render();
  window.scrollTo(0, 0);
}

/* ================= appearance ================= */
const FONTS = {
  atkinson: ['"Atkinson Hyperlegible Next", "Atkinson Hyperlegible", system-ui, sans-serif', 500],
  literata: ['Literata, "Iowan Old Style", Georgia, serif', 500],
  lexend: ['Lexend, system-ui, sans-serif', 400],
  mono: ['"Atkinson Hyperlegible Mono", ui-monospace, Menlo, monospace', 500],
};
function applyLook() {
  const root = document.documentElement, f = FONTS[settings.font] || FONTS.atkinson;
  root.style.setProperty('--font-read', f[0]); root.style.setProperty('--read-weight', f[1]);
  root.style.setProperty('--read-scale', String(settings.scale));
  if (settings.theme === 'light' || settings.theme === 'dark') root.setAttribute('data-theme', settings.theme);
  else root.removeAttribute('data-theme');
  requestAnimationFrame(refit);
}
function refit() { for (const f of [Reader.fl, Cal.fl, Choose.fl]) f && f.fit(); }

/* ================= comparisons: Glance vs reading normally ================= */
let catalog = [];
// A reference text to compare against: words, and how long Glance takes at a word speed (pauses included).
const fromEntry = e => ({ title: e.title, words: e.words, glance: w => G.estimate(e, w, timing()) });
const refBook = () => fromEntry(catalog.find(b => b.id === 'the-great-gatsby') || { title: 'The Great Gatsby', words: 48127 });
function compare(box, wpm, ref) {
  box.textContent = '';
  const normal = ref.words / G.NORMAL_WPM, mine = ref.glance(wpm), r = normal / mine;
  const big = el('p', 'big', r >= 1.05 ? (Math.round(r * 10) / 10).toFixed(1).replace(/\.0$/, '') + '× faster' : r > 0.95 ? 'A typical speed' : 'Unhurried');
  const line = el('p', null, r >= 1.05 ? 'than a typical reader at ' + G.NORMAL_WPM + ' words a minute, counting the pauses.'
    : r > 0.95 ? 'About as fast as most people read a printed page.' : 'A little slower than most people read a printed page, which is good for dense books.');
  const p = el('p');
  p.append(ref.prefix || '', el('b', null, ref.title), ' would take ', el('b', null, G.fmtMin(mine)), (r >= 1 ? ' instead of ' : ' compared with ') + G.fmtMin(normal) + '.');
  const overall = el('p', 'overall', 'With pauses, that works out at about ' + Math.round(ref.words / mine) + ' words a minute overall.');
  box.append(big, line, p, overall);
}

/* ================= library ================= */
const newId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
let books = [];
async function loadBooks() { books = (await DB.allMeta()) || []; sortBooks(); }
const sortBooks = () => books.sort((a, b) => (b.openedAt || b.addedAt) - (a.openedAt || a.addedAt));
async function addBook({ title, author = '', kind, paras, catalogId }) {
  const tok = G.buildTokens(paras);
  if (!tok.words.length) throw new Error('There is no readable text in that file.');
  const dupe = books.find(b => (catalogId && b.catalogId === catalogId) || (b.title === title && b.tokens === tok.words.length));
  if (dupe) return dupe;
  const id = newId(), now = Date.now();
  const words = paras.reduce((s, p) => s + p.split(' ').length, 0);
  const meta = { id, title, author, kind, catalogId: catalogId || null, words, tokens: tok.words.length, pauses: G.pauseCounts(tok), pos: 0, addedAt: now, openedAt: 0 };
  await DB.putText({ id, paras });
  await DB.putMeta(meta);
  books.unshift(meta);
  return meta;
}
const frac = b => (b.pos || 0) / Math.max(1, b.tokens - 1);
const pct = b => Math.floor(100 * frac(b));
const wordsLeft = b => b.words * (1 - frac(b));
const minutesLeft = (b, wpm = settings.wpm) => G.estimate(b, wpm, timing(), frac(b));

async function openFree(entry) {
  const have = books.find(b => b.catalogId === entry.id);
  if (have) return Reader.open(have.id);
  status('Opening ' + entry.title + '…');
  try {
    const res = await fetch('../books/' + entry.file);
    if (!res.ok) throw new Error();
    const b = await addBook({ title: entry.title, author: entry.author, kind: 'free', catalogId: entry.id, paras: G.toParagraphs(await res.text()) });
    status('');
    Reader.open(b.id);
  } catch { status("Couldn't download " + entry.title + '. Check your connection and try again.', true); }
}

const Home = {
  init() {
    $('#home-speed').addEventListener('click', () => Speed.open('home'));
    $('#home-aa').addEventListener('click', () => Settings.open());
    $('#pick').addEventListener('click', () => $('#file').click());
    $('#file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
    $('#paste-open').addEventListener('click', () => { $('#paste').hidden = false; $('#paste-text').focus(); });
    $('#paste-close').addEventListener('click', () => { $('#paste').hidden = true; });
    $('#paste').addEventListener('click', e => { if (e.target.id === 'paste') $('#paste').hidden = true; });
    $('#paste-add').addEventListener('click', async () => {
      const paras = G.toParagraphs($('#paste-text').value);
      if (!paras.length) { $('#paste-text').focus(); return; }
      const title = $('#paste-title').value.trim() || paras[0].split(' ').slice(0, 6).join(' ') + '…';
      try {
        const b = await addBook({ title, kind: 'pasted', paras });
        $('#paste').hidden = true; $('#paste-text').value = ''; $('#paste-title').value = '';
        Reader.open(b.id);
      } catch (err) { $('#paste').hidden = true; status(err.message, true); }
    });
    $('#cont-go').addEventListener('click', () => this.top && Reader.open(this.top.id));
    $('#lib').addEventListener('click', async e => {
      const li = e.target.closest('li'); if (!li) return;
      const id = li.dataset.id;
      if (e.target.closest('.t, .read')) return Reader.open(id);
      const rm = e.target.closest('.rm'); if (!rm) return;
      if (rm.dataset.armed) { await DB.remove(id); books = books.filter(b => b.id !== id); this.render(); }
      else { rm.dataset.armed = '1'; rm.textContent = 'Really remove?'; setTimeout(() => { if (rm.isConnected) { delete rm.dataset.armed; rm.textContent = 'Remove'; } }, 3500); }
    });
    const drop = $('#drop');
    window.addEventListener('dragover', e => { if (view === 'home' && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
    window.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
    window.addEventListener('drop', e => { drop.classList.remove('over'); if (view !== 'home') return; e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) importFile(f); });
  },
  facts(box, b) {
    box.textContent = '';
    const started = (b.pos || 0) > 0, left = wordsLeft(b);
    const add = (bold, rest) => { const s = el('span'); s.append(el('b', null, bold), rest); box.append(s); };
    if (started) add(pct(b) + '%', ' read');
    else add(G.fmtNum(b.words), ' words');
    add(G.fmtMin(minutesLeft(b)), (started ? ' left' : '') + ' at ' + settings.wpm + ' wpm');
    box.append(el('span', null, G.fmtMin(left / G.NORMAL_WPM) + ' reading normally'));
  },
  render() {
    $('#home-wpm').textContent = settings.wpm;
    const top = this.top = books[0];
    $('#continue').hidden = !top;
    if (top) {
      const started = (top.pos || 0) > 0;
      $('#cont-kicker').textContent = started ? 'Continue reading' : 'Up next';
      $('#cont-title').textContent = top.title;
      $('#cont-by').textContent = top.author || '';
      $('#cont-bar').style.width = pct(top) + '%';
      this.facts($('#cont-facts'), top);
      $('#cont-go').textContent = started ? 'Resume' : 'Start reading';
    }
    const st = $('#stats');
    st.hidden = stats.words < 150;
    if (!st.hidden) {
      st.textContent = '';
      st.append("You've read ", el('b', null, G.fmtNum(stats.words) + ' words'), ' with Glance in ', el('b', null, G.fmtMin(stats.ms / 60000)),
        '. At a typical reading speed that would have taken about ' + G.fmtMin(stats.words / G.NORMAL_WPM) + '.');
    }
    $('#lib-section').hidden = !books.length;
    const ul = $('#lib'); ul.textContent = '';
    for (const b of books) {
      const li = el('li'); li.dataset.id = b.id;
      const t = el('button', 't', b.title);
      const facts = el('div', 'facts-row');
      if (b.author) facts.append(el('span', null, b.author));
      facts.append(el('span', null, b.pos ? pct(b) + '% read' : G.fmtNum(b.words) + ' words'));
      facts.append(el('span', null, G.fmtMin(minutesLeft(b)) + ' left'));
      const acts = el('div', 'acts');
      acts.append(el('button', 'btn quiet small read', 'Read'), el('button', 'btn quiet small rm', 'Remove'));
      const bar = el('div', 'bar'); const i = el('i'); i.style.width = pct(b) + '%'; bar.append(i);
      li.append(t, acts, facts, bar); ul.append(li);
    }
    $('#lib-count').textContent = books.length === 1 ? '1 book' : books.length + ' books';
    $('#lib-note').hidden = DB.ok;
    $('#free-section').hidden = !catalog.length;
    if (catalog.length) G.renderShelf($('#shelf'), catalog, { wpm: settings.wpm, timing: timing(), onPick: openFree, owned: c => books.some(b => b.catalogId === c.id) });
  },
};
function status(msg, err) { const s = $('#status'); s.hidden = !msg; s.textContent = msg || ''; s.classList.toggle('err', !!err); if (msg && view !== 'home') go('home'); }

/* ================= importing files ================= */
const scripts = {};
function loadScript(src) {
  return scripts[src] || (scripts[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res;
    s.onerror = () => { delete scripts[src]; rej(new Error("Couldn't load the file reader. Check your connection and try again.")); };
    document.head.appendChild(s);
  }));
}
const VENDOR = '../assets/vendor/';
const niceName = n => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';

async function importFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  status('Reading ' + file.name + '…');
  try {
    let book;
    if (ext === 'pdf' || file.type === 'application/pdf') book = await readPdf(file);
    else if (ext === 'epub' || file.type === 'application/epub+zip') book = await readEpub(file);
    else {
      const raw = await file.text();
      if (/\u0000/.test(raw.slice(0, 2000))) throw new Error("That doesn't look like a text file. Glance opens .txt, .epub and .pdf files.");
      const g = G.stripGutenberg(raw);
      book = { title: g.meta.title || niceName(file.name), author: g.meta.author || '', kind: 'text', paras: G.toParagraphs(g.text) };
    }
    const b = await addBook(book);
    status('');
    Reader.open(b.id);
  } catch (err) {
    console.error(err);
    status(err.message || 'Something went wrong reading that file.', true);
  }
}

function resolvePath(dir, href) {
  const parts = (dir + decodeURIComponent(href.split('#')[0])).split('/'), out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return out.join('/');
}
const BLOCKS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'blockquote', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'dt', 'dd', 'dl', 'table', 'tr', 'td', 'th', 'figcaption', 'figure', 'hr', 'nav', 'main']);
const HEADS = new Set(['h1', 'h2', 'h3']);
function htmlToParas(root) {
  let out = '';
  (function walk(n) {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) out += c.data.replace(/\s+/g, ' ');
      else if (c.nodeType === 1) {
        const tag = (c.localName || '').toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'head' || tag === 'title' || tag === 'svg') continue;
        if (tag === 'br') { out += ' '; continue; }
        const blk = BLOCKS.has(tag);
        if (blk) out += '\n\n' + (HEADS.has(tag) ? G.HEADING_MARK : '');
        walk(c);
        if (blk) out += '\n\n';
      }
    }
  })(root);
  return out.split(/\n\n+/).map(p => p.replace(/\s+/g, ' ').trim()).filter(p => G.ALNUM.test(p));
}
async function readEpub(file) {
  await loadScript(VENDOR + 'jszip.min.js');
  let zip;
  try { zip = await window.JSZip.loadAsync(await file.arrayBuffer()); } catch { throw new Error("That EPUB couldn't be opened. It may be damaged."); }
  const read = p => { const f = zip.file(p); return f ? f.async('string') : null; };
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const containerSrc = await read('META-INF/container.xml');
  const opfPath = containerSrc && xml(containerSrc).getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
  const opfSrc = opfPath && await read(opfPath);
  if (!opfSrc) throw new Error("That EPUB is missing its contents list, so it can't be read.");
  const enc = await read('META-INF/encryption.xml');
  if (enc && /EncryptedData/.test(enc)) throw new Error("That EPUB is copy-protected (DRM), so its text can't be read.");
  const opf = xml(opfSrc), dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const title = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent.trim();
  const author = opf.getElementsByTagNameNS('*', 'creator')[0]?.textContent.trim();
  const manifest = new Map();
  for (const it of opf.getElementsByTagNameNS('*', 'item')) manifest.set(it.getAttribute('id'), { href: it.getAttribute('href') || '', type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' });
  const paras = [], refs = [...opf.getElementsByTagNameNS('*', 'itemref')];
  for (let k = 0; k < refs.length; k++) {
    const ref = refs[k];
    if (ref.getAttribute('linear') === 'no') continue;
    const item = manifest.get(ref.getAttribute('idref'));
    if (!item || (item.type && !/html|xml/.test(item.type)) || /\bnav\b/.test(item.props)) continue;
    const src = await read(resolvePath(dir, item.href)); if (!src) continue;
    let doc = new DOMParser().parseFromString(src, 'application/xhtml+xml');
    if (doc.getElementsByTagName('parsererror').length) doc = new DOMParser().parseFromString(src, 'text/html');
    const body = doc.body || doc.getElementsByTagNameNS('*', 'body')[0] || doc.documentElement;
    paras.push(...htmlToParas(body));
    status('Reading ' + file.name + '… ' + Math.round(100 * (k + 1) / refs.length) + '%');
  }
  return { title: title || niceName(file.name), author: author || '', kind: 'epub', paras };
}

async function readPdf(file) {
  await loadScript(VENDOR + 'pdf.min.js');
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = new URL(VENDOR + 'pdf.worker.min.js', location.href).href;
  let doc;
  try { doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
  catch (e) { throw new Error(/password/i.test((e && e.name) || '') ? 'That PDF is password-protected.' : "That PDF couldn't be opened. It may be damaged."); }
  let title = '';
  try { title = ((await doc.getMetadata()).info || {}).Title || ''; } catch {}
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const lines = []; let cur = null;
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
      if (!cur || Math.abs(y - cur.y) > h * 0.6) { cur = { y, h, x0: x, x1: x, text: '' }; lines.push(cur); }
      else if (it.str && cur.text && !/\s$/.test(cur.text) && !/^\s/.test(it.str) && x - cur.x1 > h * 0.12) cur.text += ' ';
      cur.text += it.str;
      if (it.str.trim()) cur.x1 = Math.max(cur.x1, x + (it.width || 0));
      cur.h = Math.max(cur.h, h);
      if (it.hasEOL) cur = null;
    }
    pages.push(lines.filter(l => l.text.trim()).map(l => (l.text = l.text.replace(/\s+/g, ' ').trim(), l)));
    page.cleanup();
    if (n % 5 === 0 || n === doc.numPages) status('Reading ' + file.name + '… ' + Math.round(100 * n / doc.numPages) + '%');
  }
  doc.destroy();
  const paras = pdfParagraphs(pages);
  if (paras.join(' ').split(' ').length < 20) throw new Error("This PDF has no text layer. It's probably a scan, so try an EPUB or text version of the book.");
  const junk = /^(untitled|document\d*|microsoft word|firefox|chrome|print|scan)|\.(docx?|indd|pdf|tex)$/i;
  return { title: (title && title.trim().length > 2 && !junk.test(title.trim())) ? title.trim() : niceName(file.name), author: '', kind: 'pdf', paras };
}
function pdfParagraphs(pages) {
  const norm = s => s.replace(/\d+/g, '#').toLowerCase();
  const seen = new Map();
  for (const ls of pages) for (const k of new Set([ls[0], ls[1], ls[ls.length - 2], ls[ls.length - 1]].filter(Boolean).map(l => norm(l.text)))) seen.set(k, (seen.get(k) || 0) + 1);
  const limit = Math.max(3, pages.length * 0.25);
  const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  const paras = []; let buf = '';
  const flush = () => { const t = buf.replace(/\s+/g, ' ').trim(); if (G.ALNUM.test(t)) paras.push(t); buf = ''; };
  const join = s => {
    if (!buf) { buf = s; return; }
    if (/\p{L}-$/u.test(buf) && /^\p{Ll}/u.test(s)) buf = buf.slice(0, -1) + s; else buf += ' ' + s;
  };
  let prevShort = false;
  pages.forEach(ls0 => {
    const ls = ls0.filter((l, i) => {
      const edge = i < 2 || i >= ls0.length - 2;
      return !(edge && (/^[\s\-–—|.]*(\d{1,4}|[ivxlcdm]{1,7})[\s\-–—|.]*$/i.test(l.text) || /^page \d+/i.test(l.text) || seen.get(norm(l.text)) >= limit));
    });
    if (!ls.length) return;
    const gaps = []; for (let i = 1; i < ls.length; i++) { const g = ls[i - 1].y - ls[i].y; if (g > 0 && g < ls[i].h * 3) gaps.push(g); }
    const gap = median(gaps) || (ls[0].h * 1.2);
    const left = median(ls.map(l => l.x0)), right = Math.max(...ls.map(l => l.x1)), width = right - left;
    const shortEnd = l => /[.!?:”"’)]$/.test(l.text) && l.x1 < right - width * 0.12;
    ls.forEach((l, i) => {
      if (i === 0) { if (prevShort) flush(); }
      else {
        const p = ls[i - 1], g = p.y - l.y;
        if (g > gap * 1.3 || shortEnd(p) || (l.x0 > left + l.h * 0.8 && /[.!?:”"’]$/.test(p.text))) flush();
      }
      join(l.text);
    });
    prevShort = shortEnd(ls[ls.length - 1]);
  });
  flush();
  return paras;
}

/* ================= the speed dial sheet ================= */
const Speed = {
  dial: null, mode: 'home',
  init() {
    this.dial = new G.Dial($('#sheet-dial'), { value: settings.wpm, onInput: v => this.input(v) });
    $('#speed-close').addEventListener('click', () => this.close());
    $('#sheet-save').addEventListener('click', () => { settings.wpm = this.dial.value; saveSettings(); this.sync(); });
    $('#sheet-test').addEventListener('click', () => { this.close(); Cal.open(); });
    document.addEventListener('pointerdown', e => {
      if (!$('#speed').hidden && !e.target.closest('.speed-card') && !e.target.closest('#r-speed, #home-speed')) this.close();
    }, true);
  },
  open(mode) {
    this.mode = mode;
    this.dial.set(mode === 'read' ? Reader.fl.wpm : settings.wpm);
    $('#speed').hidden = false;
    this.sync();
    requestAnimationFrame(() => this.dial.el.focus({ preventScroll: true }));
  },
  close() { $('#speed').hidden = true; },
  toggle(mode) { $('#speed').hidden ? this.open(mode) : this.close(); },
  input(v) {
    if (this.mode === 'read') Reader.setWpm(v);
    else { settings.wpm = v; saveSettings(); Home.render(); }
    this.sync();
  },
  sync() {
    const v = this.dial.value;
    let ref = null;
    const fl = Reader.fl;
    if (this.mode === 'read' && Reader.book) ref = { prefix: 'The rest of ', title: Reader.book.title, words: Math.max(1, fl.n - fl.cur), glance: w => fl.minutesBetween(fl.cur, fl.n, w) };
    else if (books[0]) ref = { title: books[0].title, words: Math.max(1, wordsLeft(books[0])), glance: w => minutesLeft(books[0], w) };
    else ref = refBook();
    compare($('#sheet-compare'), v, ref);
    const save = $('#sheet-save');
    save.hidden = !(this.mode === 'read' && v !== settings.wpm);
    save.textContent = 'Make ' + v + ' my usual speed';
  },
};

/* ================= first visit: choose a speed ================= */
const PREVIEW = 'This is how your speed feels. Keep your eyes on the red letter and let the words come to you. Turn the dial to go faster or slower, and stop where it still feels easy to follow.';
const Choose = {
  fl: null, dial: null, loopT: 0, pending: null,
  init() {
    this.fl = new G.Flasher($('#speed-stage'), { timing, onEnd: () => { this.loopT = setTimeout(() => this.loop(), 900); } });
    this.dial = new G.Dial($('#speed-dial'), { value: settings.wpm, onInput: v => { this.fl.wpm = v; this.sync(); } });
    $('#speed-go').addEventListener('click', () => {
      settings.wpm = this.dial.value; settings.chosen = true; saveSettings();
      this.finish();
    });
    $('#speed-test').addEventListener('click', () => Cal.open());
  },
  finish() {
    const p = this.pending; this.pending = null;
    go('home');
    if (p) openFree(p);
  },
  open() {
    go('speed');
    this.dial.set(settings.wpm);
    this.fl.load(G.buildTokens([PREVIEW]));
    this.fl.wpm = this.dial.value;
    this.fl.show(0);
    this.sync();
    clearTimeout(this.loopT);
    this.loopT = setTimeout(() => this.loop(), 700);
    requestAnimationFrame(() => this.dial.el.focus({ preventScroll: true }));
  },
  loop() { if (view !== 'speed') return; this.fl.seek(0); this.fl.play(); },
  stop() { clearTimeout(this.loopT); this.fl && this.fl.pause(true); },
  sync() { compare($('#speed-compare'), this.dial.value, this.pending ? fromEntry(this.pending) : refBook()); },
};

/* ================= the reader ================= */
const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
const Reader = {
  fl: null, book: null, saveT: 0, ctxPara: -1, wake: null, awakeT: 0, last: -1, playT: 0, chap: -1,
  init() {
    this.fl = new G.Flasher($('#r-stage'), {
      timing,
      onWord: (i, playing) => this.onWord(i, playing),
      onState: p => this.onState(p),
      onEnd: () => this.onEnd(),
    });
    $('#r-toggle').innerHTML = PLAY_SVG;
    $('#r-back').addEventListener('click', () => go('home'));
    $('#r-aa').addEventListener('click', () => Settings.open());
    $('#r-fs').addEventListener('click', () => this.fullscreen());
    $('#r-toc').addEventListener('click', () => Toc.open());
    $('#r-toggle').addEventListener('click', () => this.fl.toggle());
    $('#r-prev').addEventListener('click', () => this.fl.sentence(-1));
    $('#r-next').addEventListener('click', () => this.fl.sentence(1));
    $('#r-slower').addEventListener('click', () => this.speed(-10));
    $('#r-faster').addEventListener('click', () => this.speed(10));
    $('#r-speed').addEventListener('click', () => Speed.toggle('read'));
    $('#r-mid').addEventListener('click', e => { if (!e.target.closest('.r-context') && Date.now() - (this.pinchedAt || 0) > 400) this.fl.toggle(); });
    $('#r-context').addEventListener('click', e => {
      const s = e.target.closest('span[data-i]'); if (s) this.fl.seek(+s.dataset.i);
      if (e.target.closest('#r-again')) this.fl.seek(0);
      if (e.target.closest('#r-lib')) go('home');
    });
    const prog = $('#r-prog');
    prog.addEventListener('input', () => { this.fl.pause(); this.fl.show(+prog.value); this.onWord(this.fl.cur, false); });
    views.read.addEventListener('mousemove', () => {
      views.read.classList.add('awake'); clearTimeout(this.awakeT);
      this.awakeT = setTimeout(() => views.read.classList.remove('awake'), 1600);
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && view === 'read') { this.fl.pause(); this.save(); } });
    window.addEventListener('pagehide', () => { this.save(); saveStats(); });
  },
  async open(id) {
    const meta = books.find(b => b.id === id); if (!meta) return;
    const rec = await DB.getText(id);
    if (!rec) { status("That book's text is missing from this browser. Add it again.", true); return; }
    this.book = meta;
    const tok = G.buildTokens(rec.paras);
    this.fl.load(tok);
    $('#r-prog').max = Math.max(0, tok.words.length - 1);
    $('#r-book').textContent = meta.title;
    $('#r-toc').hidden = !tok.chapters.length;
    const marks = $('#r-marks'); marks.textContent = '';
    tok.chapters.slice(1).forEach(c => { const i = el('i'); i.style.left = (100 * c.start / Math.max(1, tok.words.length - 1)) + '%'; marks.append(i); });
    meta.openedAt = Date.now(); meta.tokens = tok.words.length; meta.pauses = G.pauseCounts(tok);
    sortBooks();
    DB.putMeta(meta);
    go('read');
    this.ctxPara = -1; this.chap = -1; this.last = -1;
    this.setWpm(settings.wpm);
    requestAnimationFrame(() => { this.fl.show(Math.min(meta.pos || 0, tok.words.length - 1)); this.onWord(this.fl.cur, false); this.onState(false); });
  },
  close() {
    if (!this.book) return;
    this.fl.pause(); this.save(); this.releaseWake();
    views.read.classList.remove('playing'); this.book = null; Speed.close();
  },
  recost() { for (const f of [this.fl, Cal.fl, Choose.fl]) f && f.recost(); if (this.book) this.where(); },
  size(d) { setScale(settings.scale + d); },
  save() {
    if (!this.book) return;
    this.book.pos = this.fl.cur;
    DB.putMeta(this.book);
  },
  speed(d) { const v = Math.max(100, Math.min(1000, this.fl.wpm + d)); this.setWpm(v); if (!$('#speed').hidden) { Speed.dial.set(v); Speed.sync(); } },
  setWpm(w) { this.fl.wpm = w; $('#r-wpm').textContent = w; this.where(); },
  chapterAt(i) {
    const ch = this.fl.tok.chapters; let k = -1;
    for (let j = 0; j < ch.length && ch[j].start <= i; j++) k = j;
    return k;
  },
  where() {
    const fl = this.fl; if (!fl.n) return;
    $('#r-pct').textContent = Math.floor(100 * fl.cur / Math.max(1, fl.n - 1)) + '%';
    const ch = fl.tok.chapters, k = this.chapterAt(fl.cur);
    if (k >= 0) {
      const end = k + 1 < ch.length ? ch[k + 1].start : fl.n;
      $('#r-left').textContent = G.fmtMin(fl.minutesBetween(fl.cur, end)) + ' left in this chapter';
    } else $('#r-left').textContent = G.fmtMin(fl.minutesLeft()) + ' left in the book';
    if (k !== this.chap) { this.chap = k; $('#r-chap').textContent = k >= 0 ? ch[k].title : ''; }
  },
  onWord(i, playing) {
    const prog = $('#r-prog'); prog.value = i; prog.style.setProperty('--fill', (100 * i / Math.max(1, this.fl.n - 1)) + '%');
    if (playing && i === this.last + 1) stats.words++;
    this.last = i;
    if (!this.fl.playing) this.context();
    if (!playing || i % 20 === 0) this.where();
    const now = Date.now(); if (now - this.saveT > 5000) { this.saveT = now; this.save(); saveStats(); }
  },
  onState(playing) {
    views.read.classList.toggle('playing', playing);
    $('#r-toggle').innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
    $('#r-toggle').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    if (playing) { this.playT = performance.now(); this.wakeLock(); views.read.classList.remove('awake'); }
    else {
      if (this.playT) { stats.ms += performance.now() - this.playT; this.playT = 0; saveStats(); }
      this.releaseWake(); this.context(); this.where(); this.save();
    }
  },
  onEnd() {
    this.where();
    const c = $('#r-context'); c.textContent = '';
    c.append(el('p', 'done', "That's the end of the book."));
    const h = el('p', 'help');
    const again = el('button', 'link', 'Read it again'); again.id = 'r-again';
    const lib = el('button', 'link', 'Back to your library'); lib.id = 'r-lib';
    h.append(again, '   ', lib); c.append(h);
    this.ctxPara = -2;
  },
  // When paused, show the paragraph around the current word so you can look back.
  context() {
    const fl = this.fl, tok = fl.tok; if (!tok || !fl.n) return;
    const c = $('#r-context'), pi = tok.para[fl.cur];
    if (this.ctxPara !== pi) {
      this.ctxPara = pi;
      c.textContent = '';
      for (const q of [pi - 1, pi]) {
        if (q < 0) continue;
        const p = el('p', q === pi ? 'cur' : null);
        const a = tok.paraStart[q], b = q + 1 < tok.paraStart.length ? tok.paraStart[q + 1] : fl.n;
        const frag = document.createDocumentFragment();
        for (let i = a; i < b; i++) {
          const s = el('span', null, tok.words[i]); s.dataset.i = i;
          frag.append(s, i + 1 < b && tok.kind[i] === 0 && /\p{L}-$/u.test(tok.words[i]) ? '' : ' ');
        }
        p.append(frag); c.append(p);
      }
      c.append(el('p', 'help', matchMedia('(pointer: coarse)').matches ? 'Tap a word to carry on from there.' : 'Click a word to carry on from there, or press Space.'));
    }
    const old = c.querySelector('.cw'); if (old) old.classList.remove('cw');
    const cw = c.querySelector('span[data-i="' + fl.cur + '"]');
    if (cw) {
      cw.classList.add('cw');
      const cr = c.getBoundingClientRect(), r = cw.getBoundingClientRect();
      if (r.top < cr.top + 20 || r.bottom > cr.bottom) c.scrollTop += r.top - cr.top - cr.height / 3;
    }
  },
  async wakeLock() { try { this.wake = await navigator.wakeLock.request('screen'); } catch { this.wake = null; } },
  releaseWake() { try { this.wake && this.wake.release(); } catch {} this.wake = null; },
  fullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else { const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); p && p.catch && p.catch(() => {}); }
    } catch {}
  },
};

/* ================= chapters ================= */
const Toc = {
  init() {
    $('#toc-close').addEventListener('click', () => this.close());
    $('#toc').addEventListener('click', e => {
      if (e.target.id === 'toc') return this.close();
      const b = e.target.closest('button[data-i]'); if (b) { this.close(); Reader.fl.seek(+b.dataset.i); }
    });
  },
  open() {
    const fl = Reader.fl, ch = fl.tok.chapters; if (!ch.length) return;
    fl.pause();
    const here = Reader.chapterAt(fl.cur), list = $('#toc-list'); list.textContent = '';
    ch.forEach((c, k) => {
      const end = k + 1 < ch.length ? ch[k + 1].start : fl.n;
      const li = el('li', k < here ? 'done' : k === here ? 'here' : null);
      const b = el('button'); b.dataset.i = c.start;
      b.append(el('span', 'dot'), el('span', 'tt', c.title), el('span', 'tm', G.fmtMin(fl.minutesBetween(c.start, end))));
      li.append(b); list.append(li);
    });
    $('#toc').hidden = false;
    const cur = list.querySelector('.here button');
    if (cur) { cur.scrollIntoView({ block: 'center' }); cur.focus({ preventScroll: true }); }
  },
  close() { $('#toc').hidden = true; },
};

/* ================= settings ================= */
const Settings = {
  init() {
    const seg = (id, key) => $(id).addEventListener('click', e => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      settings[key] = b.dataset.v; saveSettings(); applyLook(); this.sync();
    });
    seg('#seg-font', 'font'); seg('#seg-theme', 'theme');
    $('#set-size').addEventListener('input', e => setScale(+e.target.value / 100));
    $('#size-down').addEventListener('click', () => setScale(settings.scale - 0.1));
    $('#size-up').addEventListener('click', () => setScale(settings.scale + 0.1));
    $('#set-weight').addEventListener('input', e => { settings.weight = +e.target.value / 100; saveSettings(); Reader.recost(); this.sync(); });
    for (const [id, key] of [['#p-comma', 'pauseComma'], ['#p-sentence', 'pauseSentence'], ['#p-para', 'pausePara']])
      $(id).addEventListener('input', e => { settings[key] = +e.target.value; saveSettings(); Reader.recost(); this.sync(); });
    $('#set-close').addEventListener('click', () => this.close());
    $('#settings').addEventListener('click', e => { if (e.target.id === 'settings') this.close(); });
    document.addEventListener('pointerdown', e => {
      if (!$('#settings').hidden && $('#settings').classList.contains('clear') && !e.target.closest('#settings .sheet-card, #r-aa')) this.close();
    }, true);
    $('#set-speed').addEventListener('click', () => { this.close(); Speed.open(view === 'read' ? 'read' : 'home'); });
    let deferred = null;
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#install-field').hidden = false; });
    $('#install').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); try { await deferred.userChoice; } catch {} deferred = null; $('#install-field').hidden = true; });
  },
  sync() {
    for (const [id, key] of [['#seg-font', 'font'], ['#seg-theme', 'theme']])
      for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === settings[key]));
    const range = (id, v, min, max) => { const r = $(id); r.value = v; r.style.setProperty('--fill', (100 * (v - min) / (max - min)) + '%'); };
    range('#set-size', Math.round(settings.scale * 100), 50, 400);
    $('#size-out').textContent = Math.round(settings.scale * 100) + '%';
    range('#set-weight', Math.round(settings.weight * 100), 0, 100);
    $('#weight-out').textContent = settings.weight <= 0 ? 'Even' : Math.round(settings.weight * 100) + '%';
    const wpm = view === 'read' && Reader.book ? Reader.fl.wpm : settings.wpm;
    const probe = Reader.book ? Reader.fl : Choose.fl;
    const ms = w => Math.round(probe.wordMs(w, wpm));
    $('#weight-eg').textContent = 'At ' + wpm + ' wpm, “it” shows for ' + ms('it') + ' ms and “discriminative” for ' + ms('discriminative') + ' ms. The average word gets ' + Math.round(60000 / wpm) + ' ms.';
    for (const [id, key, max] of [['#p-comma', 'pauseComma', 1000], ['#p-sentence', 'pauseSentence', 1000], ['#p-para', 'pausePara', 1500]]) {
      range(id, settings[key], 0, max);
      $(id + '-out').textContent = settings[key] ? settings[key] + ' ms' : 'off';
    }
    $('#set-pace').textContent = settings.wpm + ' words a minute' + (settings.calibrated ? ', from your pace test' : '');
  },
  open() {
    Reader.fl && Reader.fl.pause();
    $('#settings').classList.toggle('clear', view === 'read');   // keep the word visible while you adjust it
    this.sync(); $('#settings').hidden = false; $('#set-close').focus();
  },
  close() { $('#settings').hidden = true; },
};

/* ================= the pace test ================= */
const PASSAGES = [
  { t: 'Every autumn, the keeper of the Hallam lighthouse painted one stair of the spiral staircase a new colour. After thirty years the tower held thirty colours, and visitors climbed it slowly, reading the years under their feet. The keeper said the brightest step, a sharp yellow, was the year his daughter was born.',
    q: 'What did the brightest step mark?', a: ['The year his daughter was born', 'His first winter at the lighthouse', 'A storm that broke the lamp'] },
  { t: 'The bakery on Corran Street opens at four in the morning, but the owner arrives at two. She spends the first hour listening to the radio and feeding a sourdough starter she has kept alive for nineteen years. Regulars swear the bread tastes different on days when the radio plays jazz.',
    q: 'How long has she kept the starter alive?', a: ['Nineteen years', 'Nine years', 'Four years'] },
  { t: 'A group of students tried to build a kite that could lift a camera above the school field. Their first three kites spun into the ground. The fourth one flew, but only after they cut its tail in half and moved the camera closer to the frame. The photos showed the field, the car park and a very surprised cat.',
    q: 'What made the fourth kite fly?', a: ['A shorter tail and the camera moved closer', 'A bigger sail and a heavier string', 'Launching it from the school roof'] },
  { t: 'Old maps of the river show a small island that no longer exists. Fishermen remember it as a strip of sand covered in reeds, where herons nested every spring. A flood in the sixties washed it away overnight, and the herons moved two kilometres downstream to an abandoned railway bridge.',
    q: 'Where did the herons go?', a: ['An abandoned railway bridge', 'A new island upstream', 'The roof of an old mill'] },
  { t: 'Marta learned to juggle during a power cut that lasted three days. With no screens and no music, she found three oranges in the kitchen and a library book full of diagrams. By the time the lights came back she could keep four oranges in the air, although most of them were badly bruised.',
    q: 'How did Marta learn to juggle?', a: ['With oranges and a library book', 'From a video her brother made', 'At a weekend circus class'] },
  { t: 'The town council wanted to replace the clock in the square, which ran eleven minutes slow. Residents objected. Shops had set their opening hours by it for decades, and couples met under it knowing everyone would be late. In the end the council left the clock alone and changed the bus timetable instead.',
    q: 'What did the council do in the end?', a: ['Changed the bus timetable', 'Replaced the clock', 'Set the clock to the right time'] },
  { t: 'In a box at the back of the archive, a librarian found a cookbook with notes in the margins from three different owners. The first wrote in pencil, the second in blue ink and the third in green. They all disagreed about how much salt the bread needed, and the green-ink cook simply crossed out the recipe.',
    q: 'What did the owner with green ink do?', a: ['Crossed out the recipe', 'Added more salt to it', 'Wrote the first notes in pencil'] },
  { t: 'Night trains once carried newspapers from the capital to the coast. The driver slowed down at each village, and a guard threw a tied bundle onto the platform without stopping. One village had a dog that learned the schedule. It waited on the platform every night and carried the bundle to the shop.',
    q: 'Who carried the bundle to the shop?', a: ['A dog', 'The guard', "The shopkeeper's son"] },
  { t: 'A violin maker keeps a wooden board in her workshop covered in hundreds of small pencil marks. Each mark is the height of a child who came in to be measured for a smaller violin. Some names appear four or five times, climbing the board over the years, until the child is tall enough for a full-size instrument.',
    q: 'What do the pencil marks record?', a: ["Children's heights", 'The prices of violins', 'Dates of repairs'] },
  { t: 'The mountain hut has a rule that every visitor must carry one stone up from the valley. Over forty years the stones have become a wall around the garden, then a second wall, and now a small tower. Hikers who come back often search for the stone they carried years before, but almost nobody finds it.',
    q: 'What have the stones turned into?', a: ['Two walls and a small tower', 'A path up to the summit', 'A bridge over the stream'] },
];
const MAX_ROUNDS = 8;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const Cal = {
  fl: null,
  init() {
    this.fl = new G.Flasher($('#cal-stage'), { timing, onEnd: () => setTimeout(() => this.ended(), 350) });
    $('#cal-go').addEventListener('click', () => this.begin());
    $('#cal-dial').addEventListener('click', () => Choose.open());
    $('#cal-close').addEventListener('click', () => { if (!settings.chosen) Choose.open(); else go('home'); });
    $('#cal-slower').addEventListener('click', () => this.choose(-1));
    $('#cal-faster').addEventListener('click', () => this.choose(1));
    $('#cal-keep').addEventListener('click', () => this.finish(this.wpm));
    $('#cal-again').addEventListener('click', () => this.play(true));
    $('#done-go').addEventListener('click', () => Choose.finish());
    $('#done-redo').addEventListener('click', () => this.open());
    $('#cal-opts').addEventListener('click', e => { const b = e.target.closest('.opt'); if (b && !b.disabled) this.answer(b); });
  },
  show(part) { for (const id of ['cal-intro', 'cal-run', 'cal-done']) $('#' + id).hidden = id !== part; },
  open() { go('cal'); this.show('cal-intro'); $('#cal-go').focus({ preventScroll: true }); },
  stopAll() { clearTimeout(this.startT); this.fl && this.fl.pause(true); },
  begin() {
    this.stopAll();
    this.wpm = Math.round((settings.chosen ? settings.wpm : 300) / 10) * 10;
    this.step = 60; this.lastDir = 0; this.round = 0;
    this.order = shuffle([...PASSAGES.keys()]);
    this.show('cal-run'); this.next();
  },
  next() {
    this.p = PASSAGES[this.order[this.round % this.order.length]];
    this.fl.load(G.buildTokens(G.toParagraphs(this.p.t)));
    $('#cal-n').textContent = this.round + 1;
    this.play(false);
  },
  play(replay) {
    this.replay = replay;
    $('#cal-ask').hidden = true; $('#cal-verdict').hidden = true;
    this.fl.wpm = this.wpm; $('#cal-wpm').textContent = this.wpm;
    this.fl.text('•');
    clearTimeout(this.startT);
    this.startT = setTimeout(() => { this.fl.seek(0); this.fl.play(); }, 1100);
  },
  ended() {
    if (view !== 'cal') return;
    this.fl.text(' ');
    if (this.replay) { $('#cal-verdict').hidden = false; return; }
    $('#cal-q').textContent = this.p.q;
    const opts = $('#cal-opts'); opts.textContent = '';
    for (const i of shuffle([0, 1, 2])) { const b = el('button', 'opt', this.p.a[i]); b.dataset.ok = i === 0 ? '1' : ''; opts.append(b); }
    $('#cal-ask').hidden = false;
    opts.firstChild.focus({ preventScroll: true });
  },
  answer(btn) {
    const ok = !!btn.dataset.ok;
    for (const b of $('#cal-opts').children) { b.disabled = true; if (b.dataset.ok) b.classList.add('right'); }
    if (!ok) btn.classList.add('wrong');
    const last = this.round >= MAX_ROUNDS - 1;
    const res = $('#cal-result'); res.textContent = '';
    if (ok) res.textContent = 'Right.';
    else res.append(el('span', 'no', 'Not quite.'), ' It was “' + this.p.a[0] + '”.');
    $('#cal-hint').textContent = last
      ? 'That was the last passage. Nudge it once more, or keep ' + this.wpm + ' wpm.'
      : ok ? 'If that felt easy, try faster. If you were straining to keep up, go slower.'
           : 'Missing details usually means the words went by too fast, so slower is a good bet.';
    $('#cal-keep').textContent = 'Keep ' + this.wpm + ' wpm';
    setTimeout(() => { $('#cal-verdict').hidden = false; $('#' + (ok ? 'cal-faster' : 'cal-slower')).focus({ preventScroll: true }); }, 250);
  },
  choose(dir) {
    if (this.lastDir && dir !== this.lastDir) this.step = Math.max(10, Math.round(this.step / 2 / 5) * 5);
    const w = Math.max(100, Math.min(1000, this.wpm + dir * this.step));
    this.lastDir = dir;
    if (this.round >= MAX_ROUNDS - 1) return this.finish(w);
    this.wpm = w; this.round++; this.next();
  },
  finish(w) {
    this.stopAll();
    settings.wpm = Math.round(w / 10) * 10; settings.calibrated = Date.now(); settings.chosen = true; saveSettings();
    $('#done-wpm').textContent = settings.wpm;
    compare($('#done-compare'), settings.wpm, Choose.pending ? fromEntry(Choose.pending) : refBook());
    this.show('cal-done');
    $('#done-go').focus({ preventScroll: true });
  },
};

/* ================= keyboard ================= */
document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, textarea, .dial')) return;
  if ((!$('#settings').hidden && !$('#settings').classList.contains('clear')) || !$('#paste').hidden || !$('#toc').hidden) {
    if (e.key === 'Escape') { Settings.close(); Toc.close(); $('#paste').hidden = true; }
    return;
  }
  if (!$('#speed').hidden && e.key === 'Escape') { Speed.close(); return; }
  if (!$('#settings').hidden && e.key === 'Escape') { Settings.close(); return; }
  if (view !== 'read' || e.metaKey || e.ctrlKey || e.altKey) return;
  const fl = Reader.fl;
  switch (e.key) {
    case ' ': case 'k':
      e.preventDefault();
      if (e.target.closest && e.target.closest('button')) e.target.blur();
      fl.toggle(); break;
    case 'ArrowLeft': fl.sentence(-1); e.preventDefault(); break;
    case 'ArrowRight': fl.sentence(1); e.preventDefault(); break;
    case ',': fl.seek(fl.cur - 1); break;
    case '.': fl.seek(fl.cur + 1); break;
    case 'ArrowUp': Reader.speed(10); e.preventDefault(); break;
    case 'ArrowDown': Reader.speed(-10); e.preventDefault(); break;
    case 's': case 'S': Speed.toggle('read'); break;
    case '-': case '_': Reader.size(-0.1); break;
    case '=': case '+': Reader.size(0.1); break;
    case 'c': case 'C': Toc.open(); break;
    case 'f': case 'F': Reader.fullscreen(); break;
    case 'Escape': if (fl.playing) fl.pause(); else go('home'); break;
  }
});
window.addEventListener('resize', refit);

/* ================= word size: slider, keys, pinch, ctrl+scroll ================= */
function setScale(v) {
  settings.scale = Math.round(Math.max(0.5, Math.min(4, v)) * 100) / 100;
  saveSettings(); applyLook();
  if (!$('#settings').hidden) Settings.sync();
}
(function pinch() {
  const mid = $('#r-mid'); let start = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  mid.addEventListener('touchstart', e => { if (e.touches.length === 2) start = { d: dist(e.touches), s: settings.scale }; }, { passive: true });
  mid.addEventListener('touchmove', e => {
    if (!start || e.touches.length !== 2) return;
    e.preventDefault();
    settings.scale = Math.max(0.5, Math.min(4, start.s * dist(e.touches) / start.d));
    document.documentElement.style.setProperty('--read-scale', String(settings.scale));
    Reader.fl.fit();
  }, { passive: false });
  mid.addEventListener('touchend', e => { if (start && e.touches.length < 2) { Reader.pinchedAt = Date.now(); start = null; setScale(settings.scale); } });
  // a trackpad pinch arrives as ctrl + wheel
  mid.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); setScale(settings.scale * Math.exp(-e.deltaY / 300)); }, { passive: false });
})();

/* ================= start ================= */
async function boot() {
  applyLook();
  Settings.init(); Speed.init(); Home.init(); Reader.init(); Cal.init(); Choose.init(); Toc.init();
  const [, cat] = await Promise.all([
    loadBooks(),
    fetch('../books/catalog.json').then(r => r.ok ? r.json() : []).catch(() => []),
  ]);
  catalog = Array.isArray(cat) ? cat : [];
  const q = new URLSearchParams(location.search);
  const want = q.get('book') && catalog.find(b => b.id === q.get('book'));
  if (q.has('book') || q.has('pace') || q.has('test')) history.replaceState(null, '', location.pathname);
  if (q.has('test')) { Choose.pending = want || null; Cal.open(); }
  else if (!settings.chosen || q.has('pace')) { Choose.pending = want || null; Choose.open(); }
  else { go('home'); if (want) openFree(want); }
  if (document.fonts) document.fonts.ready.then(refit);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('../sw.js').catch(() => {});
}
window.__glance = { G, settings, stats, get books() { return books; }, get catalog() { return catalog; }, Reader, Cal, Choose, Speed, Toc, go, importFile, openFree, htmlToParas, pdfParagraphs };
boot();
})();
