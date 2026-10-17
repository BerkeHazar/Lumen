/**
 * test-fresh.mjs — "yeni kelime gelmiyor" hatasının regresyonu
 *
 * Neden ayrı dosya: bu hata yalnızca CİHAZDA eski veri varken görünür.
 * Tarayıcıyı temiz açan her test yeşil veriyordu, çünkü sorun kodda değil
 * önbellekteydi. Burada durumu birebir kuruyoruz:
 *
 *   1. uygulama normal açılır, veri iner
 *   2. IndexedDB'ye ESKİ biçimde (etiketsiz) bir parça yazılır — kullanıcının
 *      aylardır taşıdığı kayıt gibi
 *   3. sayfa yenilenir
 *   4. yeni kelime hâlâ bulunmalı
 *
 * Ayrıca yanlış etiketli parçanın yok sayıldığını, eskilerin temizlendiğini
 * ve çevrimdışı çalışmanın bozulmadığını doğrular.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAW = process.env.PLAYWRIGHT_PATH;
if (!RAW) {
  console.error('PLAYWRIGHT_PATH tanımlı değil.');
  process.exit(2);
}
const PW = path.isAbsolute(RAW) ? pathToFileURL(RAW).href : RAW;
const { chromium } = await import(PW);

const BASE = process.env.LUMEN_URL || 'http://127.0.0.1:8777';
const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = path.join(ROOT, '.shots');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `  → ${detail}` : ''}`); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 430, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const wait = (ms) => page.waitForTimeout(ms);

/* --------------------------------------------------- sayfa içi IDB yardımı */

const IDB = {
  keys: () => page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('lumen-dict');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) { db.close(); return res([]); }
      const q = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys();
      q.onsuccess = () => { db.close(); res(q.result); };
      q.onerror = () => { db.close(); rej(q.error); };
    };
  })),

  put: (key, value) => page.evaluate(([k, v]) => new Promise((res, rej) => {
    const r = indexedDB.open('lumen-dict');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const db = r.result;
      const q = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
      q.onsuccess = () => { db.close(); res(true); };
      q.onerror = () => { db.close(); rej(q.error); };
    };
  }), [key, value]),
};

/** Arama yapıp ilk sonucu döndürür. */
async function search(q) {
  if (await page.locator('#q').count() === 0) {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await wait(1800);
  }
  await page.fill('#q', '');
  await wait(250);
  await page.fill('#q', q);
  await wait(1100);
  return {
    count: await page.locator('.result').count(),
    first: await page.locator('.result .w').first().textContent().catch(() => null),
  };
}

/* ================================================= 1. temiz açılış ======= */
console.log('\n1. temiz açılış');
await page.goto(BASE, { waitUntil: 'networkidle' });
await wait(3000);

const first = await search('extravagant');
check('"extravagant" aranınca sonuç var', first.count >= 1, `${first.count} sonuç`);
check('ilk sonuç extravagant', /extravagant/i.test(first.first || ''), first.first || '(yok)');

await page.locator('.result').first().click();
await wait(1500);
check('maddede Türkçe karşılık görünüyor',
  (await page.locator('.wtr .words span').count()) >= 1,
  `${await page.locator('.wtr .words span').count()} karşılık`);

const keysAfter = await IDB.keys();
const tagged = keysAfter.filter((k) => /^d[0-9A-Za-z]+:/.test(String(k)));
check("parçalar etiketli yazıldı", tagged.length >= 1, tagged.slice(0, 3).join(', ') || '(yok)');

/* ==================================== 2. eski (etiketsiz) kayıt ========== */
console.log('\n2. cihazda eski kayıt varken');

/* Kullanıcının taşıdığı eski biçim: etiketsiz "en-tr/e" ve "en-tr/index".
   İçinde extravagant YOK — tıpkı bir yıl önceki veri gibi. */
await IDB.put('en-tr/e', [
  { w: 'elephant', s: [{ pos: 'noun', def: 'Eski kayıttan geliyor.', tr: ['fil'], ex: [] }] },
]);
await IDB.put('en-tr/index', [['elephant', 'noun', 'fil']]);
await IDB.put('en-tr/w', [
  { w: 'window', s: [{ pos: 'noun', def: 'Eski kayıttan geliyor.', tr: ['pencere'], ex: [] }] },
]);

await page.reload({ waitUntil: 'networkidle' });
await wait(3000);

const afterStale = await search('extravagant');
check('eski kayıt yeni aramayı bozmuyor', afterStale.count >= 1, `${afterStale.count} sonuç`);
check('sonuç yine extravagant', /extravagant/i.test(afterStale.first || ''), afterStale.first || '(yok)');

const stale = await search('elephant');
check('eski kayıttaki kelime yine bulunuyor', stale.count >= 1, `${stale.count} sonuç`);

/* maddeyi açıp gerçek verinin geldiğini doğrula */
await page.goto(`${BASE}/#/w/elephant`, { waitUntil: 'networkidle' });
await wait(2200);
const elephantDef = await page.locator('.sense .d').first().textContent().catch(() => '');
check('"elephant" gerçek veriden geliyor',
  !!elephantDef && !/Eski kayıttan/.test(elephantDef), elephantDef.slice(0, 60) || '(tanım yok)');

/* ============================== 3. yanlış etiketli kayıt ================= */
console.log('\n3. yanlış etiketli parça');

/* Geçmiş bir derlemeden kalmış gibi davran: farklı etiket, içi boş. */
await IDB.put('d20000101T000000000Z:en-tr/e', [
  { w: 'extinct', s: [{ pos: 'adj', def: 'Eski nesil.', tr: ['yok olmuş'], ex: [] }] },
]);
await page.reload({ waitUntil: 'networkidle' });
await wait(2800);

const taggedWrong = await search('extinct');
await page.goto(`${BASE}/#/w/extinct`, { waitUntil: 'networkidle' });
await wait(2000);
const extinctDef = await page.locator('.sense .d').first().textContent().catch(() => '');
check('yanlış etiketli parça yok sayıldı',
  !/Eski nesil/.test(extinctDef || ''), extinctDef.slice(0, 60) || '(tanım yok)');

/* ======================================== 4. temizlik ==================== */
console.log('\n4. eski kayıtların temizliği');
await wait(1500);
const keysNow = await IDB.keys();
const legacyLeft = keysNow.filter((k) => /^(en-tr|tr-en|freedict)\//.test(String(k)));
const wrongTagLeft = keysNow.filter((k) => /^d20000101/.test(String(k)));
check('etiketsiz eski parçalar silindi', legacyLeft.length === 0, legacyLeft.join(', '));
check('yanlış etiketli parça silindi', wrongTagLeft.length === 0, wrongTagLeft.join(', '));
check('güncel parçalar duruyor', keysNow.some((k) => /^d[0-9A-Za-z]+:en-tr\//.test(String(k))),
  keysNow.slice(0, 4).join(', '));

/* ======================================== 5. çevrimdışı ================== */
console.log('\n5. çevrimdışı');
await ctx.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await wait(3500);
const offline = await search('extravagant');
check('çevrimdışı arama çalışıyor', offline.count >= 1, `${offline.count} sonuç`);
await page.goto(`${BASE}/#/w/extravagant`, { waitUntil: 'domcontentloaded' });
await wait(2500);
check('çevrimdışı madde açılıyor',
  /extravagant/i.test(await page.locator('.entry h1').textContent().catch(() => '')),
  await page.locator('.entry h1').textContent().catch(() => '(yok)'));
await page.screenshot({ path: path.join(SHOTS, '95-cevrimdisi.png') });
await ctx.setOffline(false);

/* ======================================== sonuç ========================== */
check('konsol hatası yok', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${pass} geçti${fail ? `, ${fail} başarısız` : ''}`);
await browser.close();
process.exit(fail ? 1 : 0);
