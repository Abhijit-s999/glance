/* Glance core: text → words, the timing engine, the speed dial and the book shelf.
   Shared by the landing page (index.html) and the reader (read/index.html). */
(function () {
'use strict';

/* ---------------- numbers we compare against ---------------- */
// Average adult silent reading: 238 wpm for non-fiction, 260 for fiction (Brysbaert, 2019).
const NORMAL_WPM = 250;

/* ---------------- text → words ---------------- */
const ALNUM = /[\p{L}\p{N}]/u;
const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'vs', 'etc', 'e.g', 'i.e', 'mt', 'prof', 'gen', 'col', 'capt', 'lt', 'sgt', 'rev', 'hon', 'fig', 'vol', 'ch', 'cf', 'approx', 'no']);
const HEADING_MARK = '\u0001';   // EPUB headings are stored with this prefix

function coreBounds(w) {
  let a = 0, b = w.length;
  while (a < b && !ALNUM.test(w[a])) a++;
  while (b > a && !ALNUM.test(w[b - 1])) b--;
  return [a, b];
}
// The focus letter sits a little left of the middle (O'Regan & Jacobs, 1992).
function pivotOf(w) {
  const [a, b] = coreBounds(w), L = b - a;
  if (L <= 0) return Math.max(0, Math.floor((w.length - 1) / 2));
  return a + (L <= 1 ? 0 : L <= 5 ? 1 : L <= 9 ? 2 : L <= 13 ? 3 : 4);
}
// 0 none, 1 clause break, 2 sentence end, 3 paragraph end
function endKind(w) {
  const t = w.replace(/[”"’'\)\]»›*]+$/u, '');
  const c = t.slice(-1);
  if (!c) return 0;
  if (c === '.') {
    const stem = t.slice(0, -1).replace(/^[^\p{L}\p{N}]+/u, '');
    if (ABBR.has(stem.toLowerCase()) || /^\p{Lu}$/u.test(stem)) return 0;
    return 2;
  }
  if ('!?…'.includes(c)) return 2;
  if (',;:—–'.includes(c)) return 1;
  return 0;
}
// Words up to 17 characters stay whole (the reticle shrinks them to fit); longer ones are broken up.
function splitLong(w) {
  if (w.length <= 17) return [w];
  if (w.includes('-')) { const parts = w.split(/(?<=-)/); if (parts.every(p => p.length <= 17)) return parts; }
  const n = Math.ceil(w.length / 12), size = Math.ceil(w.length / n), out = [];
  for (let i = 0; i < w.length; i += size) out.push(w.slice(i, i + size) + (i + size < w.length ? '-' : ''));
  return out;
}
function stripGutenberg(t) {
  const meta = {};
  const s = t.search(/^\*{3} ?START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*$/m);
  if (s >= 0) {
    const head = t.slice(0, s);
    const ti = head.match(/^Title:\s*(.+)$/m), au = head.match(/^Author:\s*(.+)$/m);
    if (ti) meta.title = ti[1].trim();
    if (au) meta.author = au[1].trim();
    t = t.slice(t.indexOf('\n', s) + 1);
  }
  const e = t.search(/^\*{3} ?END OF (?:THE|THIS) PROJECT GUTENBERG/m);
  if (e >= 0) t = t.slice(0, e);
  return { text: t, meta };
}
function toParagraphs(raw) {
  let t = String(raw).replace(/\r\n?/g, '\n').replace(/[­​‌﻿]/g, '').replace(/[   ]/g, ' ');
  t = t.replace(/_([^_]{1,240}?)_/g, '$1');            // _italics_ in plain-text ebooks
  t = t.replace(/[ \t]+$/gm, '');
  let parts;
  if (/\n\s*\n/.test(t)) parts = t.split(/\n\s*\n+/);
  else {
    const lines = t.split('\n').filter(l => l.trim());
    const avg = lines.reduce((s, l) => s + l.length, 0) / Math.max(1, lines.length);
    parts = avg > 90 ? lines : [t];                     // one paragraph per line, or hard-wrapped prose
  }
  return parts.map(p => p.replace(/\s+/g, ' ').trim()).filter(p => ALNUM.test(p));
}

/* ---------------- chapters ---------------- */
const NUMWORD = '(?:[0-9]{1,3}|[ivxlcdm]{1,7}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third|fourth|fifth|last|the\\s+\\w+)';
const H_KEYWORD = new RegExp('^(?:chapter|stave|book|part|letter|section|act|canto|volume)\\s+' + NUMWORD + '\\b[.:]?(?:\\s.{0,70})?$', 'i');
const H_SOLO = /^(?:the\s+)?(?:prologue|epilogue|preface|introduction|afterword|appendix|conclusion|foreword)\.?$/i;
const H_NUMERAL = /^(?:[IVXLCDM]{1,7}|\d{1,3})\.?$/;
const H_NUMTITLE = /^(?:[IVXLCDM]{1,7}|\d{1,3})[.:]\s+\p{Lu}[^.!?]{0,60}\.?$/u;
// 2 = a numbered or named heading ("Chapter IV", "II.", "Preface"), 1 = a short line in capitals, 0 = prose
function headingStrength(p) {
  if (p.length > 90) return 0;
  if (H_KEYWORD.test(p) || H_SOLO.test(p) || H_NUMERAL.test(p) || H_NUMTITLE.test(p)) return 2;
  return !/\p{Ll}/u.test(p) && /\p{Lu}{3}/u.test(p) && p.length <= 60 && !/^[“"‘']/.test(p) && !/[!?,;]$/.test(p) && p.split(' ').length <= 9 ? 1 : 0;
}
const looksLikeHeading = p => headingStrength(p) > 0;
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
function titleCase(t) {
  const ws = t.split(' ');
  return ws.map((w, i) => {
    if (/^[IVXLCDM]+[.:]?$/.test(w)) return w;
    const l = w.toLowerCase(), after = i > 0 && /[.:]$/.test(ws[i - 1]);
    return i > 0 && !after && SMALL.has(l) ? l : l.replace(/^([^\p{L}]*)(\p{L})/u, (m, a, b) => a + b.toUpperCase());
  }).join(' ');
}
function niceTitle(p) {
  let t = p.replace(/[.:]+$/, '').trim();
  if (!/\p{Ll}/u.test(t)) t = titleCase(t);
  else t = t.replace(/^(\p{Lu}{2,})(?=\s)/u, m => m[0] + m.slice(1).toLowerCase());   // "CHAPTER I. Down the..."
  return t.length > 72 ? t.slice(0, 70) + '…' : t;
}

function buildTokens(paras) {
  const words = [], para = [], kind = [], paraStart = [], heads = [];
  paras.forEach((p0, pi) => {
    let p = p0;
    const marked = p.charAt(0) === HEADING_MARK;
    if (marked) p = p.slice(1);
    paraStart.push(words.length);
    const first = words.length;
    const strength = marked ? 2 : headingStrength(p);
    if (strength) heads.push({ pi, start: first, text: p, strong: strength === 2 });
    const raw = p.replace(/([—–])(?=[\p{L}\p{N}“"‘'(])/gu, '$1 ').split(' ');
    for (const w0 of raw) {
      if (!w0) continue;
      if (/^[—–-]+$/.test(w0) && words.length > first) { words[words.length - 1] += '—'; kind[kind.length - 1] = 1; continue; }
      const chunks = splitLong(w0);
      chunks.forEach((c, ci) => { words.push(c); para.push(pi); kind.push(ci === chunks.length - 1 ? endKind(c) : 0); });
    }
    if (words.length > first) kind[words.length - 1] = 3;
  });
  // Short lines in capitals count as headings only in books without numbered ones
  // (otherwise they are usually signatures under letters, like “CAROLINE BINGLEY.”).
  const strong = heads.filter(h => h.strong).length;
  let chapters = [];
  for (const h of heads) {
    if (!h.strong && strong >= 2) continue;
    const prev = chapters[chapters.length - 1];
    if (prev && prev.lastP === h.pi - 1) {
      // a heading split over two paragraphs: "CHAPTER I." then "Down the Rabbit-Hole"
      if (!prev.strong) { prev.title = niceTitle(h.text); prev.strong = h.strong; }
      else if (!H_NUMERAL.test(h.text)) prev.title += ' ' + niceTitle(h.text);
      prev.lastP = h.pi;
    } else chapters.push({ start: h.start, title: niceTitle(h.text), lastP: h.pi, strong: h.strong });
  }
  // a bare numeral is a part of the story above it, or simply a chapter number
  let story = '';
  for (const c of chapters) {
    const m = c.title.match(/^(?:[IVXLCDM]{1,7}|\d{1,3})[.:]\s+(.+)$/);
    if (m) story = m[1];
    else if (H_NUMERAL.test(c.title)) c.title = story ? story + ', part ' + c.title.replace(/\.$/, '') : 'Chapter ' + c.title.replace(/\.$/, '');
    else story = '';
  }
  // drop "chapters" that are really contents-list lines, then name any front matter
  chapters = chapters.filter((c, i) => ((i + 1 < chapters.length ? chapters[i + 1].start : words.length) - c.start) >= 40);
  if (chapters.length >= 2 && chapters[0].start > 60) chapters.unshift({ start: 0, title: 'Opening' });
  if (chapters.length < 2) chapters = [];
  const starts = [0];
  for (let i = 0; i < words.length - 1; i++) if (kind[i] >= 2) starts.push(i + 1);
  return { words, para, kind, paraStart, starts, chapters: chapters.map(c => ({ start: c.start, title: c.title })) };
}

/* ---------------- timing ----------------
   The speed you set is the average for words. Each word's share follows its length, so "it" flashes
   by and "discriminative" stays up longer, while the average word still gets 60000 / wpm ms.
   `weight` blends between the same time for every word (0) and time in proportion to length (1).
   Pauses are fixed milliseconds added after a word. They don't shrink when you speed up, so
   there is always the same moment to blink. */
const MIN_LETTERS = 3;          // shorter words get the time of a three-letter word, so they never just flicker
const DEFAULT_TIMING = { weight: 1, comma: 100, sentence: 200, para: 400 };
function lettersOf(w) { const [a, b] = coreBounds(w); return Math.max(MIN_LETTERS, b - a); }
function costsOf(tok, timing) {
  const t = Object.assign({}, DEFAULT_TIMING, timing || {});
  const w = Math.max(0, Math.min(1, t.weight));
  const n = tok.words.length, L = new Float32Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) { L[i] = lettersOf(tok.words[i]); m += L[i]; }
  m = n ? m / n : 5;
  const cost = new Float32Array(n), pause = new Float32Array(n), sumCost = new Float64Array(n + 1), sumPause = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    cost[i] = (1 - w) + w * L[i] / m;                  // averages exactly 1 beat over the text
    const k = tok.kind[i];
    pause[i] = k === 1 ? t.comma : k === 2 ? t.sentence : k === 3 ? t.para : 0;
    sumCost[i + 1] = sumCost[i] + cost[i];
    sumPause[i + 1] = sumPause[i] + pause[i];
  }
  return { cost, pause, sumCost, sumPause, meanLetters: m, weight: w };
}
// how many clause, sentence and paragraph breaks a text has
function pauseCounts(tok) { const c = [0, 0, 0]; for (const k of tok.kind) if (k) c[k - 1]++; return c; }
// Minutes to read a book (or the unread `1 - frac` of it) at a word speed, pauses included.
function estimate({ tokens, words, pauses }, wpm, timing, frac = 0) {
  const t = Object.assign({}, DEFAULT_TIMING, timing || {});
  const n = tokens || words || 0;
  const p = pauses || [n * 0.065, n * 0.05, n * 0.015];
  return (1 - frac) * (n / wpm + (p[0] * t.comma + p[1] * t.sentence + p[2] * t.para) / 60000);
}

/* ---------------- formatting ---------------- */
function fmtMin(m) {
  m = Math.max(0, Math.round(m));
  if (m < 1) return 'under a minute';
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return h + ' h' + (r ? ' ' + r + ' min' : '');
}
function fmtShort(m) {
  m = Math.max(0, Math.round(m));
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60), r = m % 60;
  return h + 'h' + (r ? ' ' + String(r).padStart(2, '0') + 'm' : '');
}
const fmtNum = n => Math.round(n).toLocaleString('en-US');
const ratio = w => (Math.round((w / NORMAL_WPM) * 10) / 10).toFixed(1).replace(/\.0$/, '');

/* ---------------- the flasher (one word at a time) ---------------- */
const RAMP = [1.8, 1.5, 1.3, 1.15, 1.05];      // ease in for the first words after every start
const PIVOT_X = 0.42;                           // matches --px in CSS
const STAGE_HTML = '<span class="tick t"></span><span class="tick b"></span><div class="word"><span class="pv"><span class="lt"></span><span class="pc"></span><span class="rt"></span></span></div>';

class Flasher {
  constructor(stage, hooks = {}) {
    this.stage = stage; stage.innerHTML = STAGE_HTML;
    this.wordEl = stage.querySelector('.word');
    this.lt = stage.querySelector('.lt'); this.pc = stage.querySelector('.pc'); this.rt = stage.querySelector('.rt');
    this.hooks = hooks; this.playing = false; this.cur = 0; this.wpm = 300; this.tok = null;
    this.timing = hooks.timing || (() => DEFAULT_TIMING);
  }
  load(tok) { this.pause(true); this.tok = tok; this.cur = 0; this.ended = false; this.recost(); }
  recost() {
    if (!this.tok) return;
    const c = costsOf(this.tok, this.timing());
    this.cost = c.cost; this.gap = c.pause; this.sumCost = c.sumCost; this.sumPause = c.sumPause;
    this.meanLetters = c.meanLetters; this.weight = c.weight;
  }
  get n() { return this.tok ? this.tok.words.length : 0; }
  get beat() { return 60000 / this.wpm; }
  // how long a given word would stay up at the current settings, in ms (pauses not included)
  wordMs(w, wpm = this.wpm) {
    const k = Math.max(0, Math.min(1, (this.timing() || DEFAULT_TIMING).weight ?? 1));
    return 60000 / wpm * ((1 - k) + k * lettersOf(w) / (this.meanLetters || 5));
  }
  text(w) {
    const p = pivotOf(w);
    this.lt.textContent = w.slice(0, p); this.pc.textContent = w[p] || ''; this.rt.textContent = w.slice(p + 1);
    this.fit();
  }
  fit() {
    const el = this.wordEl; el.style.fontSize = '';
    const W = this.stage.clientWidth; if (!W) return;
    const X = W * PIVOT_X, half = this.pc.offsetWidth / 2;
    const s = Math.min(1, (X - 6) / (this.lt.offsetWidth + half), (W - X - 6) / (this.rt.offsetWidth + half));
    if (s < 1 && s > 0) el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * s) + 'px';
  }
  show(i) { if (!this.n) return; this.cur = Math.max(0, Math.min(this.n - 1, i)); this.text(this.tok.words[this.cur]); }
  play() {
    if (this.playing || !this.n) return;
    if (this.ended) this.cur = 0;
    this.ended = false; this.playing = true; this.ramp = 0; this.i = this.cur; this.next = performance.now();
    this.hooks.onState && this.hooks.onState(true);
    this.step();
  }
  step() {
    if (!this.playing) return;
    if (this.i >= this.n) { this.playing = false; this.ended = true; this.hooks.onState && this.hooks.onState(false); this.hooks.onEnd && this.hooks.onEnd(); return; }
    this.show(this.i);
    this.hooks.onWord && this.hooks.onWord(this.cur, true);
    this.next += this.beat * this.cost[this.i] * (RAMP[this.ramp++] || 1) + this.gap[this.i];
    this.i++;
    this.timer = setTimeout(() => this.step(), Math.max(0, this.next - performance.now()));
  }
  pause(silent) {
    clearTimeout(this.timer);
    if (!this.playing) return;
    this.playing = false;
    if (!silent && this.hooks.onState) this.hooks.onState(false);
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(i) {
    const was = this.playing; this.pause(true); this.ended = false;
    this.show(i); this.hooks.onWord && this.hooks.onWord(this.cur, false);
    if (was) { this.playing = false; this.play(); }
  }
  sentence(dir) {
    const st = this.tok.starts; let k = 0;
    while (k + 1 < st.length && st[k + 1] <= this.cur) k++;
    if (dir < 0) { if (this.cur - st[k] < 3 && k > 0) k--; this.seek(st[k]); }
    else this.seek(k + 1 < st.length ? st[k + 1] : this.n - 1);
  }
  minutesBetween(a, b, wpm = this.wpm) {
    if (!this.n) return 0;
    b = Math.min(b, this.n);
    return ((this.sumCost[b] - this.sumCost[a]) * 60000 / wpm + (this.sumPause[b] - this.sumPause[a])) / 60000;
  }
  minutesLeft(from = this.cur) { return this.minutesBetween(from, this.n); }
}

/* ---------------- the speed dial ---------------- */
// A drum you spin like the wheel on a phone's alarm clock. Drag, flick, scroll or use the arrow keys.
const DEG = 18;
class Dial {
  constructor(el, o = {}) {
    this.min = o.min ?? 100; this.max = o.max ?? 1000; this.step = o.step ?? 10;
    this.n = Math.round((this.max - this.min) / this.step) + 1;
    this.row = o.row ?? 40; this.onInput = o.onInput; this.onChange = o.onChange;
    this.R = (this.row / 2) / Math.tan((DEG / 2) * Math.PI / 180);
    this.el = el;
    el.classList.add('dial');
    el.style.setProperty('--row', this.row + 'px'); el.style.setProperty('--R', this.R + 'px');
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-orientation', 'vertical');
    el.setAttribute('aria-label', o.label || 'Reading speed');
    el.setAttribute('aria-valuemin', this.min); el.setAttribute('aria-valuemax', this.max);
    el.innerHTML = '<div class="dial-drum"></div><div class="dial-band" aria-hidden="true"><span class="dial-unit"></span></div>';
    this.drum = el.firstChild;
    el.querySelector('.dial-unit').textContent = o.unit ?? 'wpm';
    this.items = [];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < this.n; i++) {
      const d = document.createElement('div'); d.className = 'dial-item'; d.textContent = this.min + i * this.step;
      this.items.push(d); frag.append(d);
    }
    this.drum.append(frag);
    this.idx = -1; this.pos = this.indexOf(o.value ?? 300);
    this.render(true);
    this.bind();
  }
  indexOf(v) { return Math.max(0, Math.min(this.n - 1, Math.round((v - this.min) / this.step))); }
  get value() { return this.min + this.idx * this.step; }
  set(v) { this.stop(); this.pos = this.indexOf(v); this.render(true); }
  render(silent) {
    const p = this.pos;
    for (let i = 0; i < this.n; i++) {
      const d = i - p, it = this.items[i];
      if (Math.abs(d) > 4.8) { if (it._v !== false) { it.style.visibility = 'hidden'; it._v = false; } continue; }
      it._v = true; it.style.visibility = '';
      it.style.transform = 'translateY(-50%) rotateX(' + (-d * DEG) + 'deg) translateZ(' + this.R + 'px)';
      it.style.opacity = String(Math.max(0, 1 - Math.abs(d) * 0.19));
    }
    const idx = Math.max(0, Math.min(this.n - 1, Math.round(p)));
    if (idx !== this.idx) {
      if (this.idx >= 0) this.items[this.idx].classList.remove('on');
      this.items[idx].classList.add('on');
      this.idx = idx;
      this.el.setAttribute('aria-valuenow', this.value);
      this.el.setAttribute('aria-valuetext', this.value + ' words a minute');
      if (!silent && this.onInput) this.onInput(this.value);
    }
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; clearTimeout(this.wheelT); }
  animateTo(target, dur) {
    this.stop();
    target = Math.max(0, Math.min(this.n - 1, target));
    this.target = target;
    const from = this.pos, t0 = performance.now();
    dur = dur ?? Math.min(900, 220 + Math.abs(target - from) * 45);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) dur = 0;
    const tick = now => {
      const t = dur ? Math.min(1, (now - t0) / dur) : 1;
      this.pos = from + (target - from) * (1 - Math.pow(1 - t, 3));
      this.render();
      if (t < 1) this.raf = requestAnimationFrame(tick);
      else { this.raf = 0; this.target = null; this.pos = target; this.render(); this.onChange && this.onChange(this.value); }
    };
    this.raf = requestAnimationFrame(tick);
  }
  bind() {
    const el = this.el, band = () => this.n - 1;
    const rubber = p => p < 0 ? p * 0.35 : p > band() ? band() + (p - band()) * 0.35 : p;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this.stop();
      this.drag = { y: e.clientY, pos: this.pos, moved: false, s: [[e.timeStamp, e.clientY]] };
      el.setPointerCapture(e.pointerId);
      el.classList.add('grabbing');
    });
    el.addEventListener('pointermove', e => {
      const d = this.drag; if (!d) return;
      const dy = e.clientY - d.y;
      if (Math.abs(dy) > 4) d.moved = true;
      this.pos = rubber(d.pos - dy / this.row);
      d.s.push([e.timeStamp, e.clientY]); if (d.s.length > 6) d.s.shift();
      this.render();
    });
    const end = e => {
      const d = this.drag; if (!d) return;
      this.drag = null; el.classList.remove('grabbing');
      if (!d.moved) {
        const r = el.getBoundingClientRect();
        const rel = (e.clientY - (r.top + r.height / 2)) / this.row;
        if (Math.abs(rel) > 0.5) this.animateTo(Math.round(this.pos + Math.max(-4, Math.min(4, rel))));
        else this.animateTo(Math.round(this.pos));
        return;
      }
      const s = d.s.filter(x => e.timeStamp - x[0] < 120);
      let v = 0;
      if (s.length > 1) { const a = s[0], b = s[s.length - 1]; v = -(b[1] - a[1]) / Math.max(1, b[0] - a[0]) / this.row; }
      this.animateTo(Math.round(this.pos + v * 240));
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', e => {
      e.preventDefault();
      this.stop();
      const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      this.pos = Math.max(-0.3, Math.min(band() + 0.3, this.pos + dy / 70));
      this.render();
      this.wheelT = setTimeout(() => this.animateTo(Math.round(this.pos), 200), 130);
    }, { passive: false });
    el.addEventListener('keydown', e => {
      const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
      if (k) { e.preventDefault(); e.stopPropagation(); this.animateTo((this.raf && this.target != null ? this.target : Math.round(this.pos)) + k, 160); }
      else if (e.key === 'Home') { e.preventDefault(); this.animateTo(0); }
      else if (e.key === 'End') { e.preventDefault(); this.animateTo(band()); }
    });
  }
}

/* ---------------- the shelf of free books ---------------- */
// Spine width follows the book's length, so longer books look thicker.
function renderShelf(el, catalog, { wpm, timing, href, onPick, owned } = {}) {
  el.textContent = '';
  const max = Math.max(...catalog.map(b => b.words));
  catalog.forEach((b, i) => {
    const a = document.createElement(href ? 'a' : 'button');
    a.className = 'spine tone-' + (i % 4);
    if (href) a.href = href(b); else a.type = 'button';
    a.style.setProperty('--w', (40 + 46 * Math.sqrt(b.words / max)).toFixed(1) + 'px');
    const mins = estimate(b, wpm, timing);
    a.setAttribute('aria-label', b.title + ' by ' + b.author + ', ' + fmtNum(b.words) + ' words, ' + fmtMin(mins) + ' at ' + wpm + ' words a minute');
    a.innerHTML = '<span class="spine-title"></span><span class="spine-author"></span><span class="spine-time"></span>';
    a.children[0].textContent = b.title;
    a.children[1].textContent = b.author;
    a.children[2].textContent = fmtShort(mins);
    if (owned && owned(b)) a.classList.add('owned');
    if (onPick) a.addEventListener('click', e => { e.preventDefault(); onPick(b); });
    el.append(a);
  });
}

/* ---------------- settings shared by both pages ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

window.Glance = {
  NORMAL_WPM, HEADING_MARK, ALNUM,
  coreBounds, pivotOf, endKind, splitLong, stripGutenberg, toParagraphs, looksLikeHeading, niceTitle, buildTokens, costsOf,
  DEFAULT_TIMING, MIN_LETTERS, lettersOf, pauseCounts, estimate,
  fmtMin, fmtShort, fmtNum, ratio,
  Flasher, Dial, renderShelf, store, PIVOT_X,
};
})();
