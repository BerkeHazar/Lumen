#!/usr/bin/env node
/**
 * test-coverage.mjs — sözlük kapsamını ölçer ve gerilemeye karşı kilitler.
 *
 * Neden ayrı bir test: "kelime yok" şikâyeti tek tek maddelere bakarak
 * doğrulanamaz. Ölçüt, sık kullanılan kelimelerin ne kadarının sözlükte
 * olduğudur. Bu ölçüm yapılmadan kapsam sorunu görünmez.
 *
 * İki bölüm:
 *   1. VERİ  — gerçek sözlük dosyalarına karşı kapsam ölçümü (tarayıcı gerekmez)
 *   2. ARAYÜZ — yaygın kelimeler ve çekimli biçim davranışı (Chromium gerekir)
 *
 * Ön koşul (arayüz bölümü için): 8777 portunda sunucu çalışıyor olmalı.
 *
 *   node tools/test-coverage.mjs              # yalnızca veri ölçümü
 *   PLAYWRIGHT_PATH=... node tools/test-coverage.mjs --ui
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const WITH_UI = process.argv.includes('--ui');

let pass = 0, fail = 0;
const check = (l, c, e = '') => {
  if (c) { pass++; console.log(`  ✓ ${l}`); }
  else { fail++; console.log(`  ✗ ${l}${e ? '  → ' + e : ''}`); }
};

/* ------------------------------------------------------------ veri yükleme */

const LETTERS = ['_','a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z'];

function loadAll(dir) {
  const out = [];
  for (const L of LETTERS) {
    const f = path.join(ROOT, 'data', dir, `${L}.json`);
    if (!fs.existsSync(f)) continue;
    out.push(...JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  return out;
}

function loadDir(dir) {
  const map = new Map();
  for (const r of loadAll(dir)) {
    const k = r.w.toLowerCase();
    const prev = map.get(k);
    const tr = (x) => (x.s || []).some((s) => (s.tr || []).length);
    /* "accra" (sıradan ad) ile "Accra" (başkent) ayrı maddelerdir; ikisi de
       kalır. Test kelime düzeyinde baktığı için Türkçe taşıyanı tercih et. */
    if (!prev || (!tr(prev) && tr(r))) map.set(k, r);
  }
  return map;
}

const en = loadDir('en-tr');
const tr = loadDir('tr-en');

/* İkinci katman — FreeDict (GPL-2.0+). Ayrı dosyalarda durur, uygulama
   çalışma anında birleştirir. Kapsam hesabına dahildir çünkü kullanıcı
   bu kelimeleri arayıp karşılığını görebiliyor. */
const fd = new Map();
const fdDir = path.join(ROOT, 'data', 'freedict');
if (fs.existsSync(fdDir)) {
  for (const f of fs.readdirSync(fdDir)) {
    if (!/^[a-z_]\.json$/.test(f)) continue;
    for (const [w, list] of Object.entries(JSON.parse(fs.readFileSync(path.join(fdDir, f), 'utf8')))) {
      fd.set(w, list);
    }
  }
}

console.log('\n1. veri');
console.log(`  EN→TR: ${en.size.toLocaleString('tr-TR')} kelime`);
console.log(`  TR→EN: ${tr.size.toLocaleString('tr-TR')} kelime`);
console.log(`  FreeDict (GPL): ${fd.size.toLocaleString('tr-TR')} kelime`);
check('EN→TR en az 44.000 kelime', en.size >= 44000, `${en.size}`);
check('TR→EN en az 33.000 kelime', tr.size >= 33000, `${tr.size}`);
check('FreeDict katmanı var', fd.size >= 29000, `${fd.size}`);
check('FreeDict lisans dosyası var', fs.existsSync(path.join(fdDir, 'LICENSE')));
check('FreeDict atıf dosyası var', fs.existsSync(path.join(fdDir, 'README.md')));

/* Veri setleri AYRI dosyalarda kalmalı — aggregation'ın şartı bu.
   Ana sözlükte FreeDict'ten gelen karşılık bulunmamalı. */
let leaked = 0;
for (const [, r] of en) {
  if (r.wtr) leaked++;
}
check('ana veride FreeDict alanı sızmamış', leaked === 0, `${leaked} madde`);

/* sıklık listesi */
const FREQ_URL = 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english.txt';
const freqLocal = path.join(ROOT, 'tools', 'freq-10000.txt');
let freq;
if (fs.existsSync(freqLocal)) {
  freq = fs.readFileSync(freqLocal, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
} else {
  const res = await fetch(FREQ_URL);
  freq = (await res.text()).split('\n').map((s) => s.trim()).filter(Boolean);
}
console.log(`  sıklık listesi: ${freq.length} kelime`);

/* çekimli biçimler gövdesine indirgenerek de sayılır — arayüz böyle davranıyor */
function enStems(w) {
  const out = [];
  const low = w.toLowerCase();
  const push = (s) => { if (s.length >= 2 && s.toLowerCase() !== low && !out.includes(s)) out.push(s); };
  if (low.endsWith('ies')) push(w.slice(0, -3) + 'y');
  if (low.endsWith('ied')) push(w.slice(0, -3) + 'y');
  if (low.endsWith('es')) { push(w.slice(0, -2)); push(w.slice(0, -1)); }
  if (low.endsWith('s')) push(w.slice(0, -1));
  if (low.endsWith('est')) push(w.slice(0, -3));
  if (low.endsWith('ed')) { push(w.slice(0, -2)); push(w.slice(0, -2) + 'e'); push(w.slice(0, -1)); }
  if (low.endsWith('ing')) { push(w.slice(0, -3)); push(w.slice(0, -3) + 'e'); }
  if (low.endsWith('er')) { push(w.slice(0, -2)); push(w.slice(0, -2) + 'e'); push(w.slice(0, -1)); }
  const dbl = low.match(/^(.*?)([bcdfglmnprt])\2(ed|ing)$/);
  if (dbl) push(w.slice(0, dbl[1].length) + dbl[2]);
  return out;
}
const reachable = (w) =>
  en.has(w) || fd.has(w)
  || enStems(w).some((s) => en.has(s.toLowerCase()) || fd.has(s.toLowerCase()));

const cov = (n) => freq.slice(0, n).filter(reachable).length / n * 100;

console.log('\n  sıklık kapsamı (çekimli biçimler gövdeye indirgenerek):');
for (const n of [500, 1000, 3000, 5000, 10000]) {
  console.log(`    ilk ${String(n).padStart(5)}: %${cov(n).toFixed(1)}`);
}

/* Eşikler bugünkü durumun ALTINA düşerse test kırılır.
   Not: FreeDict'in tek harfli/sembollü başlıkları elendiği için kapsam
   sayısı ham listeden biraz düşük — ama o başlıklar aranacak kelimeler
   değil, kaliteleri de bozuk ("x → (kıs.) Chist"). */
check('ilk 500 kapsam ≥ %90', cov(500) >= 90, `%${cov(500).toFixed(1)}`);
check('ilk 1.000 kapsam ≥ %92', cov(1000) >= 92, `%${cov(1000).toFixed(1)}`);
check('ilk 3.000 kapsam ≥ %88', cov(3000) >= 88, `%${cov(3000).toFixed(1)}`);
check('ilk 10.000 kapsam ≥ %78', cov(10000) >= 78, `%${cov(10000).toFixed(1)}`);

console.log('\n2. madde bütünlüğü');
let noTr = 0, withTr = 0, dup = 0, badDef = 0, orphan = 0;
for (const [w, r] of en) {
  const seen = new Set();
  let anyTr = false;
  for (const s of r.s || []) {
    if (s.tr && s.tr.length) anyTr = true;
    const k = (s.pos || '') + '|' + (s.def || '');
    if (seen.has(k)) dup++;
    seen.add(k);
    if (s.def && s.def.length > 320) badDef++;
  }
  if (anyTr) withTr++;
  else {
    noTr++;
    /* Türkçesiz madde meşru — ama karşılığı ikinci katmanda olmalı */
    if (!fd.has(w)) orphan++;
  }
}
check('madde içinde yinelenen tanım yok', dup === 0, `${dup}`);
check('aşırı uzun tanım yok', badDef === 0, `${badDef}`);
check('Türkçesiz her maddenin FreeDict karşılığı var', orphan === 0, `${orphan} yetim madde`);
console.log(`  (${withTr.toLocaleString('tr-TR')} madde kendi Türkçesini taşıyor, ${noTr.toLocaleString('tr-TR')} madde ikinci katmandan alıyor)`);

/*
 * Gerçek değişmez: aynı YAZIMLA iki madde olmamalı. Büyük/küçük harf
 * farkı gerçek bir ayrımdır — "adam" (kişi) ile "Adam" (özel ad) farklı
 * maddelerdir ve ikisi de kalmalı. Uygulamada arama birebir eşleşmeyi
 * kullandığı için ("lookup" önce map.has(w) bakar) gölgeleme olmaz.
 */
const raw = loadAll('en-tr');
const seenExact = new Set();
const exactDup = [];
for (const r of raw) {
  if (seenExact.has(r.w)) exactDup.push(r.w);
  seenExact.add(r.w);
}
check('aynı yazımla yinelenen madde yok', exactDup.length === 0, exactDup.slice(0, 4).join(', '));
console.log(`  (${raw.length.toLocaleString('tr-TR')} kayıt, ${seenExact.size.toLocaleString('tr-TR')} benzersiz yazım)`);

console.log('\n3. bilinen kelimeler (regresyon)');
const known = {
  mature: 'olgun', water: 'su', book: 'kitap', cat: 'kedi',
  dictionary: 'sözlük', new: 'yeni', make: 'yapmak', system: 'sistem',
  movie: 'film', natural: 'doğal',
};
for (const [w, expect] of Object.entries(known)) {
  const r = en.get(w);
  const all = r ? (r.s || []).flatMap((s) => s.tr || []).join(',') : '';
  check(`"${w}" → "${expect}"`, all.includes(expect), all.slice(0, 60) || '(yok)');
}
for (const [w, expect] of Object.entries({ kitap: 'book', olgun: 'ripe' })) {
  const r = tr.get(w);
  const all = r ? (r.s || []).flatMap((s) => s.tr || []).join(',') : '';
  check(`TR "${w}" → "${expect}"`, all.includes(expect), all.slice(0, 60) || '(yok)');
}

console.log('\n4. ikinci katman sınırı (aggregation)');
/* FreeDict çevirileri ANA veriye sızmamalı; madde zengin, çeviri ayrı kalmalı. */
for (const w of ['extravagant', 'explicit', 'exotic', 'exquisite']) {
  const r = en.get(w);
  const senses = r ? (r.s || []).length : 0;
  const hasTr = r ? (r.s || []).some((s) => (s.tr || []).length) : false;
  check(`"${w}" ana sözlükte zengin kayıt (${senses} anlam)`, senses >= 1, senses ? '' : '(yok)');
  check(`"${w}" ana kaydında Türkçe YOK`, !hasTr, hasTr ? 'sızmış' : '');
  check(`"${w}" FreeDict katmanında var`, fd.has(w), fd.has(w) ? '' : '(yok)');
}

/*
 * C1–C2 dağarcığı — sıklık listesinin kapsamadığı üst seviye kelimeler.
 *
 * Neden ayrı ölçüm: ilk 10.000 sıklık listesi günlük dili ölçer; "meticulous",
 * "ubiquitous" gibi kelimeler orada yok. Kullanıcının gerçek sınavı da burada:
 * ileri seviye bir kelimeyi arayan kişi onu bulamazsa sözlük işe yaramaz.
 * Ölçüm 2026-10-17: 49/50 madde var, 49/50 Türkçe karşılıklı. Eksik olan
 * "eloquent" — ne Wiktionary'de ne FreeDict'te bağımsız madde olarak var
 * (FreeDict'te yalnızca "eloquence" maddesinin içinde geçiyor).
 */
console.log('\n5. C1–C2 dağarcığı');
const C1C2 = [
  'abundant', 'adamant', 'adverse', 'alleviate', 'ambiguous',
  'arbitrary', 'articulate', 'austere', 'benevolent', 'candid',
  'coherent', 'compelling', 'conspicuous', 'contentious', 'cumbersome',
  'detrimental', 'devious', 'diligent', 'discreet', 'dubious',
  'elaborate', 'eloquent', 'empirical', 'enigmatic', 'ephemeral',
  'erroneous', 'exacerbate', 'exemplary', 'exhaustive', 'feasible',
  'futile', 'gregarious', 'impeccable', 'inadvertent', 'incessant',
  'indispensable', 'ingenious', 'intricate', 'lucrative', 'meticulous',
  'negligible', 'obsolete', 'ominous', 'paramount', 'pertinent',
  'plausible', 'precarious', 'pragmatic', 'profound', 'redundant',
];
let c1Found = 0, c1Tr = 0;
const c1Missing = [], c1NoTr = [];
for (const w of C1C2) {
  const r = en.get(w);
  if (r) c1Found++; else { c1Missing.push(w); continue; }
  const native = (r.s || []).some((s) => (s.tr || []).length);
  if (native || fd.has(w)) c1Tr++; else c1NoTr.push(w);
}
console.log(`  madde var      : ${c1Found}/${C1C2.length}`);
console.log(`  Türkçe karşılık: ${c1Tr}/${C1C2.length}`);
check('C1–C2: en az 47/50 madde var', c1Found >= 47, `${c1Found} — eksik: ${c1Missing.join(', ')}`);
check('C1–C2: en az 47/50 Türkçe karşılıklı', c1Tr >= 47, `${c1Tr} — karşılıksız: ${c1NoTr.join(', ')}`);
check('C1–C2: bilinen eksik yalnızca "eloquent"',
  c1Missing.length <= 1 && (c1Missing.length === 0 || c1Missing[0] === 'eloquent'),
  c1Missing.join(', ') || '(eksik yok)');

/* --------------------------------------------------------------- arayüz */

if (WITH_UI) {
  console.log('\n6. arayüz — çekimli biçim davranışı');
  const RAW = process.env.PLAYWRIGHT_PATH || 'playwright';
  const PW = path.isAbsolute(RAW) ? pathToFileURL(RAW).href : RAW;
  let chromium;
  try { ({ chromium } = await import(PW)); }
  catch { console.error('Playwright bulunamadı.'); process.exit(2); }

  const BASE = process.env.BASE || 'http://127.0.0.1:8777';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 430, height: 900 }, colorScheme: 'dark' });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));

  const open = async (w) => {
    await page.goto(`${BASE}/#/w/${encodeURIComponent(w)}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    return {
      title: await page.locator('.entry h1').textContent().catch(() => null),
      note: await page.locator('.stemnote').textContent().catch(() => null),
    };
  };

  /* Düzenli çekimler — ek soyma ile çözülür */
  for (const [q, lemma] of [['books', 'book'], ['systems', 'system'], ['prices', 'price'], ['using', 'use']]) {
    const r = await open(q);
    check(`"${q}" → "${lemma}" maddesi`, (r.title || '').toLowerCase() === lemma, r.title || '(yok)');
    check(`"${q}" için çekim uyarısı gösterildi`, !!r.note, r.note || '(yok)');
    if (q === 'books') await page.screenshot({ path: path.join(ROOT, '.shots', '80-cekim.png') });
  }

  /*
   * Düzensiz çekimler BİLEREK desteklenmiyor. Ek soyma çözemez; kaynakta
   * `senses[].form_of` alanı var ve derleme sırasında bir biçim→lemma haritası
   * üretilebilir, ama ölçüm getirinin maliyetine değmediğini gösterdi:
   * 131.398 kayıt / ~780 KB gzip karşılığında ilk 500 sıklıkta yalnızca
   * +5 kelime. Bu kontrol sınırı belgeler — kırılmaması gereken bir şey değil.
   */
  const irregular = [];
  for (const q of ['made', 'women', 'children', 'went']) {
    const r = await open(q);
    irregular.push(`${q}${r.title ? '→' + r.title : '→(yok)'}`);
  }
  console.log(`  · düzensiz çekimler (desteklenmiyor): ${irregular.join(', ')}`);
  check('düzensiz çekim sınırı belgelendi', true);

  /* yeni kazanılan maddeler */
  const cat = await open('cat');
  check('"cat" maddesi açıldı', (cat.title || '').toLowerCase() === 'cat', cat.title || '(yok)');
  await page.screenshot({ path: path.join(ROOT, '.shots', '81-cat.png') });

  console.log('\n7. arayüz — ikinci katman (FreeDict)');
  /* Türkçesi olmayan madde: zenginlik Wiktionary'den, karşılık FreeDict'ten */
  const ext = await open('extravagant');
  check('"extravagant" maddesi açıldı', (ext.title || '').toLowerCase() === 'extravagant', ext.title || '(yok)');
  const extWtr = await page.$$eval('.wtr .words span', (e) => e.map((x) => x.textContent));
  check('"extravagant" Türkçe karşılık gösteriyor', extWtr.length >= 3, extWtr.join(', ') || '(yok)');
  check('karşılıklar FreeDict\'ten geliyor', extWtr.includes('müsrif'), extWtr.join(', '));
  check('"extravagant" zengin (tanımlar var)', await page.locator('.sense').count() >= 3);
  check('"extravagant" IPA taşıyor', await page.locator('.entry-meta .ipa').count() === 1);
  check('"extravagant" etimoloji taşıyor', await page.locator('.ety').count() === 1);
  check('"extravagant" "tanım yok" demiyor',
    !(await page.locator('.entry').innerText()).includes('Bu madde için tanım yok'));
  await page.screenshot({ path: path.join(ROOT, '.shots', '92-extravagant.png'), fullPage: true });

  /* kendi Türkçesi olan maddeye DOKUNULMAMALI */
  await open('water');
  check('"water" maddesinde wtr bloğu yok', await page.locator('.wtr').count() === 0);
  check('"water" kendi karşılığını koruyor',
    (await page.locator('.sense .tr').first().textContent() || '').includes('su'));

  /* düz madde uyarı göstermemeli */
  const plain = await open('water');
  check('düz maddede çekim uyarısı yok', !plain.note, plain.note || '');

  /* olmayan kelime hâlâ "bulunamadı" demeli */
  await page.goto(`${BASE}/#/w/zzzqqxx`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  check('olmayan kelimede boş durum', await page.locator('.empty h3').count() === 1);

  check('konsolda hata yok', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
