#!/usr/bin/env node
/**
 * test-search.mjs — arama katmanı için duman testi.
 *
 * Tarayıcı gerektirmez: search.js yalnızca MiniSearch kullanır, tarayıcı API'si
 * yoktur. Gerçek sözlük dizini yüklenip sorgular denenir.
 *
 * Kullanım:  node tools/test-search.mjs
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as search from '../js/search.js';

const ROOT = path.resolve(import.meta.dirname, '..');

let pass = 0;
let fail = 0;

function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? '  → ' + extra : ''}`); }
}

/* ------------------------------------------------------------- harf katlaması */

console.log('\nharf katlaması');
check('ıslak -> islak', search.fold('ıslak') === 'islak', search.fold('ıslak'));
check('İstanbul -> istanbul', search.fold('İstanbul') === 'istanbul', search.fold('İstanbul'));
check('IŞIK -> isik', search.fold('IŞIK') === 'isik', search.fold('IŞIK'));
check('oğlan -> oglan', search.fold('oğlan') === 'oglan', search.fold('oğlan'));
check('çiçek -> cicek', search.fold('çiçek') === 'cicek', search.fold('çiçek'));

/* ------------------------------------------------------------------ dizin */

console.log('\ndizin yükleniyor');
const raw = JSON.parse(await readFile(path.join(ROOT, 'data/en-tr/index.json'), 'utf8'));
const rows = raw.map((r) => ({ w: r[0], pos: r[1] || '', tr: r[2] || '' }));
console.log(`  ${rows.length.toLocaleString('tr-TR')} kelime`);

search.build(rows);
check('motor hazır', search.isReady());
check('boyut doğru', search.size() === rows.length);

/* ------------------------------------------------------------------ aramalar */

function top(q, n = 1) {
  return search.search(q, n).map((r) => r.w);
}

console.log('\naramalar');
check('"water" bulunuyor', top('water').includes('water'), top('water').join(','));
check('"extraordinary" bulunuyor', top('extraordinary').includes('extraordinary'));
check('"book" tam eşleşme başta', top('book')[0] === 'book', top('book').join(','));

// İki dilli arama: EN->TR dizininde Türkçe yazınca da bulunmalı.
// Çünkü karşılık alanı (tr) da indekslenir — "kitap" yazan "book"a ulaşır.
const kitap = search.search('kitap', 10).map((r) => r.w);
check('"kitap" yazınca İngilizce karşılıklar geliyor',
  kitap.length > 0 && kitap.includes('book'), kitap.slice(0, 6).join(','));

// Türkçe katlaması İngilizce dizinde de çalışmalı (aksanlı İngilizce kelimeler)
check('"cafe" -> café bulur', search.search('cafe', 5).some((r) => r.w === 'café'),
  search.search('cafe', 5).map((r) => r.w).join(','));

// Önek araması
const pre = search.search('extra', 10).map((r) => r.w);
check('"extra" önek sonuçları', pre.length >= 3, pre.join(','));

// Kısa sorgu gürültüsü
const short = search.search('at', 20).map((r) => r.w);
check('kısa sorguda hepsi "at" ile başlıyor',
  short.every((w) => search.fold(w).startsWith('at')), short.join(','));

// Yazım hatası toleransı
console.log('\nyazım önerisi');
const sug = search.suggest('extrordinry', 3).map((r) => r.w);
check('"extrordinry" -> extraordinary öneriliyor', sug.includes('extraordinary'), sug.join(','));

const sug2 = search.suggest('recieve', 5).map((r) => r.w);
check('"recieve" için öneri geliyor', sug2.length > 0, sug2.join(','));

/* -------------------------------------------------------------- TR -> EN */

console.log('\nTR -> EN dizini');
const rawTr = JSON.parse(await readFile(path.join(ROOT, 'data/tr-en/index.json'), 'utf8'));
const rowsTr = rawTr.map((r) => ({ w: r[0], pos: r[1] || '', tr: r[2] || '' }));
console.log(`  ${rowsTr.length.toLocaleString('tr-TR')} kelime`);

search.reset();
search.build(rowsTr);
check('"su" bulunuyor', search.search('su', 5).some((r) => r.w === 'su'),
  search.search('su', 5).map((r) => r.w).join(','));
check('"ıslak" bulunuyor', search.search('ıslak', 5).some((r) => r.w === 'ıslak'),
  search.search('ıslak', 5).map((r) => r.w).join(','));
check('"islak" yazınca da bulunuyor', search.search('islak', 5).some((r) => r.w === 'ıslak'),
  search.search('islak', 5).map((r) => r.w).join(','));

/* ------------------------------------------------------------------ özet */

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
