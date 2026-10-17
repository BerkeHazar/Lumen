/**
 * Geçmiş listesindeki silme davranışını sınar.
 * Ön koşul: 8777 portunda sunucu çalışıyor.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const RAW = process.env.PLAYWRIGHT_PATH || 'playwright';
const PW = path.isAbsolute(RAW) ? pathToFileURL(RAW).href : RAW;
const { chromium } = await import(PW);

let pass = 0;
let fail = 0;
const check = (l, c, e = '') => {
  if (c) { pass++; console.log(`  ✓ ${l}`); }
  else { fail++; console.log(`  ✗ ${l}${e ? '  → ' + e : ''}`); }
};

const b = await chromium.launch();
const c = await b.newContext({
  viewport: { width: 430, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  hasTouch: false,
});
const p = await c.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await p.goto('http://127.0.0.1:8777/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2200);

/* geçmişi doldur */
console.log('\ngeçmiş oluşturuluyor');
for (const w of ['water', 'book', 'mature']) {
  await p.fill('#q', w);
  await p.waitForTimeout(500);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(700);
  await p.click('[data-act="back"]');
  await p.waitForTimeout(500);
}
await p.fill('#q', '');
await p.waitForTimeout(500);

const rows = await p.locator('.recent').count();
check('geçmiş listesi dolu', rows === 3, `${rows} satır`);

const dels = await p.locator('.recent-del').count();
check('her satırda silme düğmesi var', dels === 3, `${dels} düğme`);

/* iç içe button kontrolü — geçersiz HTML olmamalı */
const nested = await p.evaluate(() => document.querySelectorAll('button button').length);
check('iç içe button yok', nested === 0, `${nested} adet`);

/* hover öncesi / sonrası görünürlük */
const before = await p.locator('.recent-del').first().evaluate((el) => getComputedStyle(el).opacity);
await p.locator('.recent').first().hover();
await p.waitForTimeout(400);
const after = await p.locator('.recent-del').first().evaluate((el) => getComputedStyle(el).opacity);
check('hover öncesi gizli', Number(before) === 0, `opacity ${before}`);
check('hover sonrası görünür', Number(after) === 1, `opacity ${after}`);

await p.screenshot({ path: '.shots/60-gecmis-hover.png' });

/* silme */
const firstWord = await p.locator('.recent .result .w').first().textContent();
await p.locator('.recent-del').first().click();
await p.waitForTimeout(600);

const after2 = await p.locator('.recent').count();
check('satır sayısı azaldı', after2 === 2, `${after2} satır`);

const words = await p.$$eval('.recent .result .w', (els) => els.map((e) => e.textContent));
check('silinen kelime listede yok', !words.includes(firstWord), words.join(','));

/* kalıcılık: sayfa yenilenince de silinmiş olmalı */
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(2200);
const afterReload = await p.$$eval('.recent .result .w', (els) => els.map((e) => e.textContent));
check('silme kalıcı', !afterReload.includes(firstWord), afterReload.join(','));
check('kalan kelimeler duruyor', afterReload.length === 2, afterReload.join(','));

/* odak arama alanına dönüyor mu */
const focused = await p.evaluate(() => document.activeElement?.id);
check('silme sonrası odak arama alanında', focused === 'q', focused || '(yok)');

check('konsolda hata yok', errs.length === 0, errs.slice(0, 2).join(' | '));

await b.close();
console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
