#!/usr/bin/env node
/**
 * test-edge.mjs — kapsamlı hata ayıklama turunda bulunan hataların regresyonu.
 *
 * Buradaki her kontrol, gerçekten yaşanmış bir hatayı kilitler:
 *
 *   1. mark() kaçış/indeks kayması — "Alzheimer's disease" ekranda
 *      "Alzheimer9;s disease" olarak görünüyordu; 342 EN + 122 TR başlık riskli.
 *   2. Yazım önerisi — "şunu mu demek istedin" kutusu hiç çizilmiyordu.
 *   3. Geri düğmesi — paylaşılan kelime bağlantısıyla giren kullanıcı geri'ye
 *      basınca uygulamadan çıkıp boş sayfaya düşüyordu.
 *   4. Geçmişi tümden temizleme — store.clearRecent() ölü koddu, arayüzde
 *      karşılığı yoktu.
 *   5. Service worker veri önbelleği — "Çevrimdışı kopya > Temizle" yalnızca
 *      IndexedDB'yi boşaltıyordu, SW katmanı veriyi servis etmeye devam ediyordu.
 *   6. Sekme başlığı — madde ekranından çıkınca "water — Lumen" kalıyordu.
 *
 * Ön koşul: 8777 portunda sunucu çalışıyor olmalı.
 *   python -m http.server 8777
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAW = process.env.PLAYWRIGHT_PATH || 'playwright';
const PW = path.isAbsolute(RAW) ? pathToFileURL(RAW).href : RAW;

let chromium;
try {
  ({ chromium } = await import(PW));
} catch (e) {
  console.error(`Playwright bulunamadı: ${RAW}`);
  process.exit(2);
}

const BASE = process.env.BASE || 'http://127.0.0.1:8777';
const OUT = path.resolve(import.meta.dirname, '..', '.shots');
const TITLE = 'Lumen — Türkçe İngilizce sözlük';

let pass = 0;
let fail = 0;
const check = (l, c, e = '') => {
  if (c) { pass++; console.log(`  ✓ ${l}`); }
  else { fail++; console.log(`  ✗ ${l}${e ? '  → ' + e : ''}`); }
};

/* Sözlükteki gerçek madde başları — vurgu bozulmasını ölçmek için referans */
const headwords = new Set(
  JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../data/en-tr/index.json'), 'utf8'))
    .map((r) => (Array.isArray(r) ? r[0] : r.w))
);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 430, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

const wait = (ms) => page.waitForTimeout(ms);
/*
 * DİKKAT: page.goto yalnızca hash farklıysa gezinme sayılır; aynı adrese
 * gitmek sayfayı YENİDEN YÜKLEMEZ. Temiz bir açılış (boot) gereken yerlerde
 * reload() kullanılmalı — aksi hâlde uygulamanın bellekteki durumu korunur ve
 * test yanlış sonuç verir.
 */
const goto = async (hash = '#/') => {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await wait(2400);
};
const reload = async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await wait(2400);
};

/* ================================================== 1. mark() vurgusu ====== */
console.log('\n1. mark() vurgusu (kaçış/indeks)');
await goto();
for (const q of ['disease', 'a', 'souls', 'man']) {
  await page.fill('#q', q);
  await wait(600);
  const rows = await page.$$eval('.result .w', (els) => els.map((e) => e.textContent));
  const bogus = rows.filter((w) => !headwords.has(w));
  check(`"${q}" sonuçları bozulmamış (${rows.length} satır)`, bogus.length === 0,
    bogus.slice(0, 3).join(' | '));
  const leaks = rows.filter((w) => /&#|&amp;|&lt;|&gt;|&quot;/.test(w));
  check(`"${q}" içinde çözümlenmemiş varlık yok`, leaks.length === 0, leaks.slice(0, 3).join(' | '));
}

/* kesme işareti taşıyan madde gerçekten bulunuyor mu */
await page.fill('#q', "alzheimer");
await wait(700);
const alz = await page.$$eval('.result .w', (els) => els.map((e) => e.textContent));
check("kesme işaretli madde listeleniyor", alz.some((w) => w.includes("'")), alz.slice(0, 4).join(' | '));
const alzOk = alz.every((w) => headwords.has(w));
check('kesme işaretli madde metni bozulmamış', alzOk, alz.filter((w) => !headwords.has(w)).join(' | '));

/* vurgu hâlâ çalışıyor mu — aksi hâlde düzeltme "hiç vurgulama"ya dönüşmüş olur */
await page.fill('#q', 'disease');
await wait(600);
const marked = await page.locator('.result .w mark').count();
check('eşleşen parça hâlâ işaretleniyor', marked >= 1, `${marked} mark`);

/* ============================================ 2. yazım önerisi ============ */
/*
 * Öneri kutusu yalnızca HİÇ sonuç yokken çizilir (spesifikasyon böyle).
 * Tek kelimelik yazım hatası bu duruma girmez: MiniSearch'ün bulanık araması
 * "extrordinry" için zaten "extraordinary"ı buluyor. Kutu çok kelimeli
 * sorgularda devreye girer — search() AND, suggest() OR ile bağlar.
 */
console.log('\n2. yazım önerisi ("şunu mu demek istedin")');
await page.fill('#q', '');
await wait(300);
await page.fill('#q', 'water zzz');
await wait(1400);
const sugBox = await page.locator('#suggest .notice').count();
const sugWords = await page.$$eval('#suggest .textbtn', (els) => els.map((e) => e.textContent.trim()));
check('öneri kutusu göründü', sugBox === 1, `${sugBox} kutu`);
check('öneri kelime içeriyor', sugWords.length >= 1, sugWords.join(', '));
check('öneri "water" içeriyor', sugWords.some((w) => /water/i.test(w)), sugWords.join(', '));
await page.screenshot({ path: path.join(OUT, '71-oneri.png'), fullPage: true });

/* öneriye tıklamak maddeyi açmalı */
if (sugWords.length) {
  await page.locator('#suggest .textbtn').first().click();
  await wait(1300);
  check('öneriye tıklayınca madde açıldı', await page.locator('.entry h1').count() === 1);
}

/* tek kelimelik yazım hatası bulanık aramayla bulunmalı */
await goto();
await page.fill('#q', 'extrordinry');
await wait(800);
const fuzzy = await page.$$eval('.result .w', (els) => els.map((e) => e.textContent));
check('yazım hatası bulanık aramayla bulunuyor', fuzzy.some((w) => /extraordinary/i.test(w)), fuzzy.join(','));

/* sonuç varken öneri kutusu olmamalı */
await page.fill('#q', 'water');
await wait(700);
check('sonuç varken öneri kutusu yok', await page.locator('#suggest').count() === 0);

/* ============================================== 3. geri düğmesi ========== */
console.log('\n3. geri düğmesi uygulamadan çıkmamalı');
await goto('#/w/water');
check('doğrudan madde adresi açıldı', await page.locator('.entry h1').count() === 1);
await page.click('[data-act="back"]');
await wait(900);
const afterBack = await page.evaluate(() => ({
  hash: location.hash,
  sameOrigin: location.href.startsWith('http'),
  hasField: !!document.getElementById('q'),
}));
check('uygulamadan çıkılmadı', afterBack.sameOrigin, JSON.stringify(afterBack));
check('arama ekranına dönüldü', afterBack.hasField, JSON.stringify(afterBack));
check('adres #/ oldu', afterBack.hash === '#/' || afterBack.hash === '', afterBack.hash);

/* madde -> ilgili kelime -> geri: uygulama içi gezinme korunmalı */
await goto();
await page.fill('#q', 'water');
await wait(500);
await page.keyboard.press('Enter');
await wait(1200);
await page.click('[data-act="back"]');
await wait(900);
check('madde -> geri: aramaya dönüldü', await page.locator('#q').count() === 1);

/* ipucunun vaat ettiği tuşlar gerçekten çalışmalı */
console.log('\n3b. klavye ile geri');
for (const [key, label] of [['ArrowLeft', 'sol ok'], ['Backspace', 'Backspace']]) {
  await goto();
  await page.fill('#q', 'water');
  await wait(500);
  await page.keyboard.press('Enter');
  await wait(1200);
  const inEntry = await page.locator('.entry h1').count() === 1;
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(key);
  await wait(900);
  const back = await page.locator('#q').count() === 1;
  check(`${label} maddeden geri götürüyor`, inEntry && back, `madde:${inEntry} arama:${back}`);
}

/* arama alanında Backspace harf silmeli, gezinmemeli */
await goto();
await page.fill('#q', 'water');
await wait(600);
await page.keyboard.press('Backspace');
await wait(600);
const val = await page.inputValue('#q');
check('arama alanında Backspace harf siliyor', val === 'wate', `"${val}"`);
check('arama alanında Backspace gezinmiyor', await page.locator('#q').count() === 1);

/* ===================================== 4. geçmişi tümden temizleme ======= */
console.log('\n4. geçmişi tümden temizleme');
await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open('lumen-settings');
  req.onsuccess = () => {
    const tx = req.result.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(['water', 'book', 'mature'], 'recent');
    tx.oncomplete = () => res();
  };
}));
await reload();
const seeded = await page.locator('.recent').count();
check('geçmiş tohumlandı', seeded === 3, `${seeded} satır`);

await goto('#/settings');
const labels = await page.$$eval('.set-row .lbl', (els) => els.map((e) => e.textContent));
check('ayarlarda "Son aramalar" satırı var', labels.includes('Son aramalar'), labels.join(' | '));
const hintBefore = await page.$$eval('.set-row .hint', (els) => els.map((e) => e.textContent));
check('satır kaç kelime olduğunu yazıyor', hintBefore.some((h) => /3 kelime/.test(h)), hintBefore.join(' | '));

const clearBtn = await page.locator('[data-act="clearrecent"]').count();
check('"Temizle" düğmesi var', clearBtn === 1, `${clearBtn}`);
await page.screenshot({ path: path.join(OUT, '72-ayarlar-depolama.png'), fullPage: true });
await page.click('[data-act="clearrecent"]');
await wait(700);
const hintAfter = await page.$$eval('.set-row .hint', (els) => els.map((e) => e.textContent));
check('temizlendikten sonra "Kayıt yok"', hintAfter.includes('Kayıt yok'), hintAfter.join(' | '));

await goto();
check('arama ekranında geçmiş listesi boş', await page.locator('.recent').count() === 0);
await reload();
check('temizleme kalıcı', await page.locator('.recent').count() === 0);

/* ============================== 5. service worker veri önbelleği ========= */
console.log('\n5. service worker veri önbelleği');
await page.evaluate(() => navigator.serviceWorker?.ready);
await goto();
await page.fill('#q', 'water');
await wait(500);
await page.keyboard.press('Enter');
await wait(1400);
await goto();
await page.fill('#q', 'book');
await wait(500);
await page.keyboard.press('Enter');
await wait(1400);
await goto('#/settings');

/*
 * Önbellek adı sürümlenir (lumen-data-v2 gibi); şemayla birlikte artar.
 * Test ada bağımlı olmamalı, öneki arar.
 */
const dataCacheCount = () => page.evaluate(async () => {
  const name = (await caches.keys()).find((k) => k.startsWith('lumen-data'));
  if (!name) return 0;
  const c = await caches.open(name);
  return (await c.keys()).length;
});

const before = await dataCacheCount();
check('veri önbelleği doldu', before > 0, `${before} kayıt`);

await page.click('[data-act="clearcache"]');
await wait(1200);
const after = await dataCacheCount();
check('veri önbelleği temizlendi', after === 0, `${after} kayıt kaldı`);

/* temizlik sonrası uygulama hâlâ çalışmalı (yeniden indirebilmeli) */
await goto();
await page.fill('#q', 'water');
await wait(500);
await page.keyboard.press('Enter');
await wait(1600);
check('temizlik sonrası madde yine açılıyor', await page.locator('.entry h1').count() === 1);

/* ================================================= 6. sekme başlığı ====== */
console.log('\n6. sekme başlığı');
await goto('#/w/water');
check('maddede başlık kelimeyi taşıyor', (await page.title()).includes('water'), await page.title());
await goto();
check('aramaya dönünce başlık sıfırlandı', (await page.title()) === TITLE, await page.title());
await goto('#/favorites');
check('favorilerde başlık sıfırlandı', (await page.title()) === TITLE, await page.title());

/* ==================================================== 7. genel =========== */
console.log('\n7. bulunamayan kelime');
await goto();
await page.fill('#q', 'zzzqqxx');
await wait(900);
const outsideLinks = await page.$$eval('.outside a', (els) => els.map((e) => e.getAttribute('href')));
check('sonuçsuz aramada dış bağlantı var', outsideLinks.length === 2, outsideLinks.join(' | '));
check('Wiktionary bağlantısı doğru', outsideLinks.some((h) => /wiktionary\.org\/wiki\/zzzqqxx/.test(h || '')), outsideLinks.join(' | '));

await goto('#/w/zzzqqxx');
const entryLinks = await page.$$eval('.outside a', (els) => els.map((e) => e.getAttribute('href')));
check('bulunamayan maddede dış bağlantı var', entryLinks.length === 2, entryLinks.join(' | '));
await page.screenshot({ path: path.join(OUT, '82-bulunamadi.png'), fullPage: true });
check('dış bağlantılar yeni sekmede açılıyor',
  await page.$$eval('.outside a', (els) => els.every((e) => e.target === '_blank' && e.rel.includes('noopener'))));

console.log('\n8. başlık ve gezinme');

/* marka bir düğme olmalı — tıklanınca aramaya döner */
await goto('#/settings');
const brandTag = await page.$eval('.brand', (e) => e.tagName);
check('marka düğme (span değil)', brandTag === 'BUTTON', brandTag);
check('marka her ekranda var', await page.locator('.brand').count() === 1);

await page.click('.brand');
await wait(1100);
check('markaya basınca aramaya dönüldü', await page.locator('#q').count() === 1);
check('marka tıklanınca arama alanı odaklanır',
  await page.evaluate(() => document.activeElement?.id === 'q'));

/* yön düğmesi yalnızca arama ekranında: ayarlarda yeri yok */
check('aramada yön düğmesi var', await page.locator('.dir').count() === 1);
await goto('#/settings');
check('ayarlarda yön düğmesi yok', await page.locator('.dir').count() === 0);

/* ayarların sayfa başlığı olmalı (arama/favoriler alanla, madde h1 ile başlıyor) */
const title = await page.locator('.page-title').textContent().catch(() => null);
check('ayarlarda sayfa başlığı var', title === 'Ayarlar', title || '(yok)');

/* GitHub bağlantısı — favorilerin sağında */
const gh = await page.$eval('.topbar a.ibtn', (e) => ({
  href: e.getAttribute('href'),
  target: e.getAttribute('target'),
  rel: e.getAttribute('rel'),
  after: e.previousElementSibling?.getAttribute('data-route'),
}));
check('GitHub bağlantısı doğru adrese gidiyor',
  gh.href === 'https://github.com/BerkeHazar/Lumen', gh.href);
check('GitHub yeni sekmede açılıyor', gh.target === '_blank' && /noopener/.test(gh.rel || ''));
check('GitHub düğmesi favorilerin sağında', gh.after === 'favorites', String(gh.after));

/*
 * Kaydırma sıfırlanmalı: hash yönlendirmesinde tarayıcı konumu korur, uzun bir
 * maddeden ayarlara geçen kullanıcı sayfayı ortadan açıyordu.
 */
await goto('#/w/water');
await page.evaluate(() => window.scrollTo(0, 900));
await wait(300);
const scrolled = await page.evaluate(() => window.scrollY);
check('maddede kaydırma yapıldı', scrolled > 400, `${scrolled}`);
await page.click('[data-route="settings"]');
await wait(1000);
check('rota değişince kaydırma sıfırlandı',
  await page.evaluate(() => window.scrollY) === 0,
  `${await page.evaluate(() => window.scrollY)}`);

/* dar ekranda başlık taşmamalı, ikonlar sıkışmamalı */
await page.setViewportSize({ width: 320, height: 700 });
await goto('#/');
await wait(900);
const narrow = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  icon: Math.round(document.querySelector('.ibtn').getBoundingClientRect().width),
}));
check('320 px\'te yatay taşma yok', narrow.overflow <= 0, `${narrow.overflow}px`);
check('320 px\'te ikon hedefi en az 32 px', narrow.icon >= 32, `${narrow.icon}px`);
await page.setViewportSize({ width: 430, height: 950 });

console.log('\n9. genel sağlık');
const nested = await page.evaluate(() => document.querySelectorAll('button button').length);
check('iç içe button yok', nested === 0, `${nested}`);

const real = errs.filter((e) => !/favicon|manifest|sw\.js|404/i.test(e));
check('konsolda beklenmeyen hata yok', real.length === 0, real.slice(0, 3).join(' | '));

await page.screenshot({ path: path.join(OUT, '70-edge.png') });
await browser.close();

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
