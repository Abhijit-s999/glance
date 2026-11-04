/* Glance landing page: the live hero, the dial, the diagrams and the speed comparison. */
(function () {
'use strict';
const G = window.Glance;
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const settings = G.store.get('glance:settings', {});
let wpm = settings.wpm || 400;
let catalog = [];

/* ---------------- hero: a live reader and the dial ---------------- */
const DEMO = 'Glance shows you one word at a time. Keep your eyes on the red letter and let the words come to you. There is no line to follow and no page to scan, so your eyes can rest in one place. Spin the dial to change the speed, and stop where it still feels easy to follow.';
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
const playBtn = $('#hero-play');
let wantPlay = !reduced, visible = true, loopT = 0;
const fl = new G.Flasher($('#hero-stage'), {
  onEnd: () => { loopT = setTimeout(() => { loopT = 0; if (wantPlay && visible) { fl.seek(0); fl.play(); } }, 1200); },
});
fl.load(G.buildTokens([DEMO]));
fl.wpm = wpm;
fl.show(0);
playBtn.innerHTML = wantPlay ? PAUSE : PLAY;
playBtn.addEventListener('click', () => {
  wantPlay = !wantPlay; clearTimeout(loopT); loopT = 0;
  if (wantPlay) fl.play(); else fl.pause();
  playBtn.innerHTML = wantPlay ? PAUSE : PLAY;
  playBtn.setAttribute('aria-label', wantPlay ? 'Pause the demo' : 'Play the demo');
});
function sync() { if (wantPlay && visible && !fl.playing && !loopT) fl.play(); else if ((!wantPlay || !visible) && fl.playing) fl.pause(true); }
new IntersectionObserver(es => { visible = es[0].isIntersecting; sync(); }, { threshold: 0.2 }).observe($('#hero-stage'));
document.addEventListener('visibilitychange', () => { visible = !document.hidden; sync(); });
setTimeout(sync, 700);

const dial = new G.Dial($('#hero-dial'), { value: wpm, onInput: v => setWpm(v, 'dial') });
function heroCompare() {
  const box = $('#hero-compare'); box.textContent = '';
  const r = wpm / G.NORMAL_WPM;
  box.append(el('p', 'big', r >= 1.05 ? G.ratio(wpm) + '× faster' : r > 0.95 ? 'A typical speed' : 'Unhurried'));
  box.append(el('p', null, r >= 1.05 ? 'than a typical reader, who manages about 250 words a minute.' : 'About as fast as, or slower than, most people read a printed page.'));
  const g = catalog.find(b => b.id === 'the-great-gatsby') || { title: 'The Great Gatsby', words: 48127 };
  const p = el('p');
  p.append(el('b', null, g.title), ' in ', el('b', null, G.fmtMin(g.words / wpm)), (r >= 1 ? ' instead of ' : ' compared with ') + G.fmtMin(g.words / G.NORMAL_WPM) + '.');
  box.append(p);
}
function setWpm(v, from) {
  wpm = Math.max(100, Math.min(1000, v));
  fl.wpm = wpm;
  if (from !== 'dial') dial.set(wpm);
  if (from !== 'init') { const s = G.store.get('glance:settings', {}); s.wpm = wpm; G.store.set('glance:settings', s); }   // the reader starts at this speed
  heroCompare(); chart(); year(); shelf();
  $('#step-val').textContent = $('#leg-wpm').textContent = $('#year-wpm').textContent = wpm;
}

/* ---------------- how your eyes move on paper ---------------- */
// [word index, milliseconds, is a jump back]
const FIX = [[0, 190], [2, 230], [4, 260], [6, 210], [7, 240], [10, 280], [7, 200, 1], [11, 220], [13, 190], [15, 250], [18, 230], [20, 210], [22, 260], [24, 220], [26, 230], [28, 270], [29, 200], [30, 300]];
const scanText = $('#scan-text'), svg = $('#scan-svg');
const NS = 'http://www.w3.org/2000/svg';
(function wrapWords() {
  const words = scanText.textContent.trim().split(/\s+/);
  scanText.textContent = '';
  words.forEach((w, i) => { if (i) scanText.append(' '); scanText.append(el('span', null, w)); });
})();
function fixPoints() {
  const spans = scanText.children, box = svg.getBoundingClientRect();
  return FIX.map(([wi, ms, back]) => {
    const r = spans[Math.min(wi, spans.length - 1)].getBoundingClientRect();
    return { x: r.left - box.left + r.width * 0.42, y: r.bottom - box.top + 2, r: 3 + (ms - 150) / 32, ms, back };
  });
}
function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
function drawScan(upto) {
  const pts = fixPoints(); svg.textContent = '';
  const n = upto ?? pts.length;
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1], b = pts[i];
    svg.append(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: b.back ? 'reg' : 'sac' }));
    if (b.back) { const t = svgEl('text', { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 17, 'text-anchor': 'middle', class: 'lbl' }); t.textContent = 'back'; svg.append(t); }
  }
  for (let i = 0; i < n; i++) svg.append(svgEl('circle', { cx: pts[i].x, cy: pts[i].y, r: pts[i].r, class: 'fix' }));
}
let scanTimer = 0;
$('#scan-play').addEventListener('click', e => {
  const btn = e.currentTarget; clearTimeout(scanTimer);
  btn.disabled = true; btn.textContent = 'Playing at real speed';
  let k = 0;
  const next = () => {
    drawScan(++k);
    if (k < FIX.length) scanTimer = setTimeout(next, FIX[k - 1][1] + 30);
    else { btn.disabled = false; btn.textContent = 'Play it again'; }
  };
  drawScan(0); scanTimer = setTimeout(next, 300);
});

/* ---------------- words lined up on their focus letter ---------------- */
(function specimen() {
  const grid = $('#spec');
  for (const w of ['I', 'read', 'words', 'faster', 'without', 'focusing', 'sentences', 'recognition', 'concentration', 'comprehensively']) {
    const p = G.pivotOf(w), row = el('div', 'srow'), pv = el('span', 'pv');
    pv.append(el('span', 'lt', w.slice(0, p)), w[p], el('span', 'rt', w.slice(p + 1)));
    row.append(pv); grid.append(row);
  }
})();

/* ---------------- an example pace test ---------------- */
(function testrun() {
  const s = $('#testrun');
  const W = 560, H = 280, L = 52, R = 112, T = 18, B = 40;
  const data = [[300, 1], [360, 1], [420, 0], [390, 1]];
  const lo = 260, hi = 440;
  const x = i => L + i * (W - L - R) / (data.length - 1);
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  for (const v of [300, 350, 400]) {
    s.append(svgEl('line', { x1: L, x2: W - R + 20, y1: y(v), y2: y(v), class: 'grid' }));
    const t = svgEl('text', { x: L - 12, y: y(v) + 4, 'text-anchor': 'end', class: 'axis-t' }); t.textContent = v; s.append(t);
  }
  data.forEach((d, i) => { const t = svgEl('text', { x: x(i), y: H - 12, 'text-anchor': 'middle', class: 'axis-t' }); t.textContent = 'Passage ' + (i + 1); s.append(t); });
  s.append(svgEl('path', { d: data.map((d, i) => (i ? 'L' : 'M') + x(i) + ' ' + y(d[0])).join(' '), class: 'path' }));
  data.forEach((d, i) => {
    const c = svgEl('circle', { cx: x(i), cy: y(d[0]), r: 6, class: d[1] ? 'pt' : 'pt miss' });
    const t = svgEl('title', {}); t.textContent = 'Passage ' + (i + 1) + ': ' + d[0] + ' wpm, question ' + (d[1] ? 'answered correctly' : 'missed');
    c.append(t); s.append(c);
  });
  const last = data[data.length - 1];
  const end = svgEl('text', { x: x(data.length - 1) + 16, y: y(last[0]) + 5, class: 'end' }); end.textContent = 'Kept ' + last[0]; s.append(end);
})();

/* ---------------- the speed comparison ---------------- */
const tip = $('#tip');
function showTip(e, html) { tip.innerHTML = html; tip.hidden = false; moveTip(e); }
function moveTip(e) {
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 16, y = e.clientY + 16;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 16;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 16;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function chart() {
  if (!catalog.length) return;
  const box = $('#chart'); box.textContent = '';
  const maxMin = Math.max(...catalog.map(b => b.words)) / Math.min(G.NORMAL_WPM, wpm);
  const stepH = maxMin / 60 > 10 ? 2 : 1;
  const top = Math.ceil(maxMin / 60 / stepH) * stepH * 60;
  const pc = m => (100 * m / top).toFixed(2) + '%';
  for (const b of catalog) {
    const n = b.words / G.NORMAL_WPM, g = b.words / wpm;
    const row = el('div', 'crow');
    const bt = el('div', 'bt', b.title); bt.append(el('small', null, b.author));
    const bars = el('div', 'bars');
    const bn = el('i', 'n'), bg = el('i', 'g'); bn.style.width = pc(n); bg.style.width = pc(g);
    bars.append(bn, bg);
    const sv = el('div', 'sv');
    if (g < n) sv.append('saves ', el('b', null, G.fmtMin(n - g)));
    else sv.append('takes ', el('b', null, G.fmtMin(g - n)), ' more');
    row.append(bt, bars, sv);
    const html = '<b>' + esc(b.title) + '</b><br>' + G.fmtNum(b.words) + ' words<br>Reading normally: ' + G.fmtMin(n) + '<br>Glance at ' + wpm + ' wpm: ' + G.fmtMin(g);
    row.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') showTip(e, html); });
    row.addEventListener('pointermove', e => { if (!tip.hidden) moveTip(e); });
    row.addEventListener('pointerleave', () => { tip.hidden = true; });
    box.append(row);
  }
  const grid = el('div', 'chart-grid');
  for (let h = stepH * 60; h < top; h += stepH * 60) { const i = el('i'); i.style.left = pc(h); grid.append(i); }
  box.prepend(grid);
  const axis = $('#axis'); axis.textContent = '';
  const ticks = el('div', 'ticks');
  for (let h = 0; h <= top; h += stepH * 60) { const s = el('span', null, h ? h / 60 + ' h' : '0'); s.style.left = pc(h); ticks.append(s); }
  axis.append(el('div'), ticks, el('div'));
  const t = $('#chart-table'); t.textContent = '';
  const head = el('tr'); for (const h of ['Book', 'Words', 'Reading normally (250 wpm)', 'Glance (' + wpm + ' wpm)']) head.append(el('th', null, h));
  t.append(head);
  for (const b of catalog) { const r = el('tr'); for (const c of [b.title, G.fmtNum(b.words), G.fmtMin(b.words / G.NORMAL_WPM), G.fmtMin(b.words / wpm)]) r.append(el('td', null, c)); t.append(r); }
  const all = catalog.reduce((s, b) => s + b.words, 0);
  $('#all-normal').textContent = G.fmtMin(all / G.NORMAL_WPM);
  $('#all-glance').textContent = G.fmtMin(all / wpm);
}
function year() {
  const perYear = w => Math.round(20 * 365 * w / 90000);
  $('#year-normal').textContent = perYear(G.NORMAL_WPM);
  $('#year-glance').textContent = perYear(wpm);
}
function shelf() {
  if (!catalog.length) return;
  G.renderShelf($('#shelf'), catalog, { wpm, href: b => 'read/?book=' + encodeURIComponent(b.id) });
}
$('#step-down').addEventListener('click', () => setWpm(wpm - 10));
$('#step-up').addEventListener('click', () => setWpm(wpm + 10));

/* ---------------- start ---------------- */
function layout() { drawScan(); fl.fit(); }
window.addEventListener('resize', () => { clearTimeout(layout.t); layout.t = setTimeout(layout, 120); });
fetch('books/catalog.json').then(r => r.json()).then(c => { catalog = c; setWpm(wpm, 'init'); }).catch(() => setWpm(wpm, 'init'));
heroCompare(); year();
$('#step-val').textContent = $('#leg-wpm').textContent = $('#year-wpm').textContent = wpm;
(document.fonts ? document.fonts.ready : Promise.resolve()).then(layout);
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
