#!/usr/bin/env node
/**
 * build-freedict.mjs — FreeDict eng-tur verisinden Lumen'ın ikinci katmanını üretir.
 *
 * ---------------------------------------------------------------------------
 * NEDEN AYRI BİR KATMAN (ve neden ayrı dosyalar)
 *
 * Bu veri **GPL-2.0+** lisanslı; projenin ana verisi Wiktionary'den ve
 * **CC BY-SA 4.0**. İkisi birleşik tek bir eserde uyumsuz olurdu.
 *
 * GPLv2 §2: "mere aggregation of another work not based on the Program with
 * the Program ... on a volume of a storage or distribution medium does not
 * bring the other work under the scope of this License."
 *
 * Bu yüzden iki veri seti AYRI dosyalarda tutulur ve hiçbir dosya ikisini
 * birden içermez. Uygulama ikisini çalışma anında bellekte birleştirir;
 * birleşik hâli hiçbir zaman diske yazılmaz. Ana veri CC BY-SA kalır.
 *
 * ---------------------------------------------------------------------------
 * NEDEN GEREKLİ
 *
 * Wiktionary'nin İngilizce maddelerinde Türkçe çeviri çoğu zaman yok
 * (`extravagant`, `explicit`, `exotic`, `exquisite` — ham vikimetinle
 * doğrulandı). FreeDict bunları kapatıyor: 22.552 kelime bizde yok.
 * Ölçüm: ilk 10.000 sıklık kapsamı %69,8 → %80,7.
 *
 * ---------------------------------------------------------------------------
 * KULLANIM
 *   node tools/build-freedict.mjs
 *   node tools/build-freedict.mjs --out data/freedict
 */

import fs from 'node:fs';
import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';

const SOURCE =
  'https://raw.githubusercontent.com/freedict/fd-dictionaries/master/eng-tur/eng-tur.tei';
const LICENSE_URL = 'https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = path.resolve(arg('out', path.join(ROOT, 'data', 'freedict')));

const log = (...a) => console.log(...a);

/*
 * gnu.org, User-Agent göndermeyen istekleri 403 ile reddediyor; Node'un
 * varsayılan fetch'i kendi UA'sını göndermiyor.
 */
const UA = { headers: { 'User-Agent': 'lumen-build/1.0 (+https://github.com)' } };

/* ------------------------------------------------------------------ sınırlar */

const CAP = {
  tr: 6,        // kelime başına en fazla karşılık
  trLen: 60,    // bundan uzun "karşılık" çeviri değil, yapışmış cümle artığıdır
  wordLen: 24,
};

/*
 * Kaynağın kendi README'si uyarıyor: dönüştürücü Türkçe karşılıkları "," ve ";"
 * ile bölüyor ve "bu yapılmamalıydı, yanlış yerlerden bölebilir". Aşağıdaki
 * süzgeçler bu bozulmanın en görünür izlerini temizler.
 */
const BAD_MARK = /\((kıs|bak|argo|esk|halk|mat|tic|den|müz|ask|huk|kim|fiz|tıp)\.\)/i;
const TR_CHARS = /[a-zA-ZçğıöşüÇĞİÖŞÜâîûÂÎÛ'’\-\s]/;

/** Bir başlık gerçek, aranabilir bir İngilizce kelime mi? */
function isRealWord(w) {
  if (!w || w.length < 3 || w.length > CAP.wordLen) return false;
  if (/\s/.test(w)) return false;                       // çok kelimeli deyim
  if (!/^[a-z][a-z'’-]*$/.test(w)) return false;        // sembol, sayı, büyük harf
  return true;
}

/** Karşılık gerçekten kullanılabilir mi? */
function cleanTr(s) {
  const v = String(s || '').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '');
  if (!v || v.length > CAP.trLen) return null;
  if (BAD_MARK.test(v)) return null;                    // "uzanıp (kıs.)alan" gibi artıklar
  // Kaynakta türev kelimenin çevirisi maddeye yapışmış olabiliyor:
  // "katî. explicitly açıkça" — cümle sınırı varsa çeviri değildir.
  if (/\.\s/.test(v)) return null;
  if (!TR_CHARS.test(v)) return null;
  return v;
}

/* ------------------------------------------------------------------ indirme */

log('▸ FreeDict eng-tur indiriliyor');
const res = await fetch(SOURCE, UA);
if (!res.ok) throw new Error(`Kaynak indirilemedi: HTTP ${res.status}`);
const xml = await res.text();
log(`  ${(xml.length / 1048576).toFixed(1)} MB`);

/* ---------------------------------------------------------------- ayrıştırma */

const entries = new Map();   // word -> [karşılıklar]
let raw = 0, dropped = 0;

for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
  const body = m[1];
  const o = /<orth>([\s\S]*?)<\/orth>/.exec(body);
  if (!o) continue;
  raw++;

  const head = o[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  const key = head.toLowerCase();
  if (!isRealWord(key)) { dropped++; continue; }

  const quotes = [...body.matchAll(/<quote>([\s\S]*?)<\/quote>/g)]
    .map((q) => q[1].replace(/&amp;/g, '&'))
    .map(cleanTr)
    .filter(Boolean);
  if (!quotes.length) { dropped++; continue; }

  if (!entries.has(key)) entries.set(key, []);
  const list = entries.get(key);
  for (const q of quotes) if (!list.includes(q) && list.length < CAP.tr) list.push(q);
}

/* yalnızca karşılığı kalanlar */
for (const [k, v] of [...entries]) if (!v.length) entries.delete(k);

log(`  ${raw.toLocaleString('tr-TR')} kayıt okundu → ${entries.size.toLocaleString('tr-TR')} kelime`);
log(`  elenen: ${dropped.toLocaleString('tr-TR')} (sembol, tek harf, çok kelimeli, karşılıksız)`);

/* -------------------------------------------------------------------- yazma */

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const buckets = new Map(LETTERS.map((l) => [l, {}]));
buckets.set('_', {});

for (const [w, tr] of entries) {
  const first = w[0];
  const b = buckets.get(first) || buckets.get('_');
  b[w] = tr;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let parts = 0, bytes = 0;
for (const [letter, map] of buckets) {
  const n = Object.keys(map).length;
  if (!n) continue;
  const json = JSON.stringify(map);
  await writeFile(path.join(OUT, `${letter}.json`), json);
  parts++; bytes += json.length;
}
log(`  ${parts} parça yazıldı, ${(bytes / 1048576).toFixed(1)} MB`);

/* --------------------------------------------------------- lisans ve manifest */

const lic = await fetch(LICENSE_URL, UA);
if (!lic.ok) throw new Error(`GPL metni indirilemedi: HTTP ${lic.status}`);
await writeFile(path.join(OUT, 'LICENSE'), await lic.text());
await writeFile(path.join(OUT, 'README.md'), `# FreeDict English-Turkish (eng-tur)

Bu klasördeki veri **Lumen'ın kendi verisi değildir.** Ayrı bir eserdir ve
kendi lisansı altında dağıtılır.

- Kaynak: FreeDict eng-tur 0.3 — https://github.com/freedict/fd-dictionaries
- Asıl kaynak: \`gtksozluk2\` (Mehmet Ali Vardar), GPL
- Lisans: **GNU General Public License, sürüm 2 veya sonrası** (bkz. LICENSE)
- Dönüştürme: \`tools/build-freedict.mjs\` (süzme + harfe göre bölme)

Lumen'ın ana sözlük verisi Wiktionary'den türetilmiştir ve **CC BY-SA 4.0**
altındadır (\`data/en-tr/\`, \`data/tr-en/\`). İki veri seti ayrı dosyalarda
tutulur; uygulama bunları yalnızca çalışma anında bellekte birleştirir.
Bu, GPLv2 §2'deki "mere aggregation" hükmüne dayanır.

Karşılıklar kaynaktan olduğu gibi alınmıştır; Lumen bunları düzeltmez.
`);

await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify({
  source: 'FreeDict English-Turkish (eng-tur) 0.3',
  sourceUrl: 'https://github.com/freedict/fd-dictionaries',
  upstream: 'gtksozluk2 — Mehmet Ali Vardar',
  license: 'GPL-2.0-or-later',
  licenseUrl: 'https://www.gnu.org/licenses/old-licenses/gpl-2.0.html',
  generated: new Date().toISOString(),
  count: entries.size,
  letters: [...buckets].filter(([, m]) => Object.keys(m).length).map(([l]) => l),
}, null, 2));

log('  LICENSE (GPL-2.0) ve manifest yazıldı');
log('\nbitti.');
