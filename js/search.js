/**
 * search.js — MiniSearch sarmalayıcısı
 *
 * Türkçe'ye özel iki karar:
 *
 * 1. Harf katlaması. Kullanıcı "oglan" yazıp "oğlan"ı, "islak" yazıp "ıslak"ı
 *    bulabilmeli. Hem indekslenen terimler hem sorgu aynı fonksiyondan geçer,
 *    böylece ikisi de aynı düzleme iner.
 *
 * 2. tr yerel ayarıyla küçük harfe çevirme. "İ" harfi tr'de "i" olur, "I" ise
 *    "ı" olur. Standart toLowerCase() bunu yanlış yapar ve "İstanbul" ile
 *    "istanbul" eşleşmez.
 */

import MiniSearch from '../vendor/minisearch.js';

const FOLD = { ı: 'i', İ: 'i', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u', ş: 's', Ş: 's', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c', â: 'a', î: 'i', û: 'u' };

/** Arama için normalleştirme: tr küçük harf + aksan katlama. */
export function fold(s) {
  return String(s || '')
    .toLocaleLowerCase('tr')
    .replace(/[ıİğĞüÜşŞöÖçÇâîû]/g, (c) => FOLD[c] || c)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const OPTIONS = {
  // Kelime zaten benzersiz anahtar; ayrıca id alanı üretmeye gerek yok.
  // (MiniSearch varsayılan olarak "id" alanı arar ve bulamazsa hata verir.)
  idField: 'w',
  fields: ['w', 'tr'],
  storeFields: ['w', 'pos', 'tr'],
  processTerm: (t) => fold(t),
  searchOptions: {
    prefix: true,
    fuzzy: 0.2,
    boost: { w: 3 },
    combineWith: 'AND',
  },
};

let engine = null;
let rows = [];

/** Dizini kurar. Aynı yön için tekrar çağrılırsa yeniden kurmaz. */
export function build(indexRows) {
  rows = indexRows;
  engine = new MiniSearch(OPTIONS);
  engine.addAll(indexRows);
  return engine;
}

export function isReady() {
  return engine !== null;
}

/** Dizini boşaltır — arama yönü değiştiğinde çağrılır. */
export function reset() {
  engine = null;
  rows = [];
}

export function size() {
  return rows.length;
}

/**
 * Arama yapar.
 * @param {string} q
 * @param {number} [limit]
 * @returns {Array<{w,pos,tr,score}>}
 */
export function search(q, limit = 30) {
  const query = String(q || '').trim();
  if (!engine || !query) return [];

  let hits = engine.search(query);

  // Kısa sorgularda (1-2 harf) yalnızca baştan eşleşenler anlamlı.
  // "at" aramasında "katılmak" sonucu gelmemeli.
  if (query.length <= 2) {
    const f = fold(query);
    hits = hits.filter((h) => fold(h.w).startsWith(f));
  }

  // Tam eşleşme her zaman en üstte.
  const exact = fold(query);
  hits.sort((a, b) => {
    const ae = fold(a.w) === exact ? 1 : 0;
    const be = fold(b.w) === exact ? 1 : 0;
    if (ae !== be) return be - ae;
    // sonra kısa kelimeler önce
    return a.w.length - b.w.length || b.score - a.score;
  });

  return hits.slice(0, limit).map((h) => ({
    w: h.w, pos: h.pos || '', tr: h.tr || '', score: h.score,
  }));
}

/**
 * Sonuç bulunamadığında "şunu mu demek istedin" önerisi üretir.
 * MiniSearch'ün fuzzy aramasını daha gevşek ayarlarla tekrar çalıştırır.
 */
export function suggest(q, limit = 3) {
  const query = String(q || '').trim();
  if (!engine || query.length < 3) return [];

  const hits = engine.search(query, {
    prefix: true,
    fuzzy: 0.4,
    boost: { w: 3 },
    combineWith: 'OR',
  });

  const seen = new Set();
  const out = [];
  for (const h of hits) {
    const k = fold(h.w);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ w: h.w, pos: h.pos || '', tr: h.tr || '' });
    if (out.length >= limit) break;
  }
  return out;
}

export default { build, search, suggest, fold, isReady, reset, size };
