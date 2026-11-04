#!/usr/bin/env node
// Adds token and pause counts to books/catalog.json using the reader's own tokenizer,
// so time estimates on the site match what the reader does. Run after prepare_books.py.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/core.js'), 'utf8'), ctx);
const G = ctx.window.Glance;
const file = path.join(root, 'books/catalog.json');
const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const b of catalog) {
  const tok = G.buildTokens(G.toParagraphs(fs.readFileSync(path.join(root, 'books', b.file), 'utf8')));
  b.tokens = tok.words.length;
  b.pauses = G.pauseCounts(tok);
  b.chapters = tok.chapters.length;
  console.log(b.id.padEnd(22), b.tokens, JSON.stringify(b.pauses), b.chapters + ' chapters');
}
fs.writeFileSync(file, JSON.stringify(catalog, null, 1) + '\n');
