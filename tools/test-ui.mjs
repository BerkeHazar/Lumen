#!/usr/bin/env node
/**
 * test-ui.mjs — tarayıcıda uçtan uca duman testi.
 *
 * Uygulamayı gerçek Chromium'da açar, ekran görüntüsü alır, konsol hatalarını
 * toplar ve temel akışları dener.
 *
 * Ön koşul: 8777 portunda yerel sunucu çalışıyor olmalı.
 *   python -m http.server 8777
 *
 * Playwright bu projenin bağımlılığı değil (sıfır-build kuralı). Kurulu olduğu
 * yeri PLAYWRIGHT_PATH ile göster:
 *   PLAYWRIGHT_PATH=/yol/node_modules/playwright/index.mjs node tools/test-ui.mjs
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAW = process.env.PLAYWRIGHT_PATH || 'playwright';
// Windows'ta mutlak yol file:// URL'i olmadan import edilemez
const PW = path.isAbsolute(RAW) ? pathToFileURL(RAW).href : RAW;

let chromium;
try {
  ({ chromium } = await import(PW));
} catch (e) {
  console.error(`Playwright bulunamadı: ${RAW}`);
  console.error(String(e.message || e).slice(0, 120));
  console.error('PLAYWRIGHT_PATH ortam değişkeniyle kurulu olduğu yeri göster.');
  process.exit(2);
}

const BASE = process.env.BASE || 'http://127.0.0.1:8777';
const OUT = path.resolve(import.meta.dirname, '..', '.shots');

let pass = 0;
let fail = 0;
const problems = [];

function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? '  → ' + extra : ''}`); }
}

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

/* ------------------------------------------------------------------ açılış */

console.log('\naçılış');
await page.goto(BASE, { waitUntil: 'networkidle' });
check('sayfa yüklendi', await page.title() !== '');
check('başlık Lumen içeriyor', (await page.title()).includes('Lumen'), await page.title());
check('arama alanı var', await page.locator('#q').count() === 1);
check('tema uygulandı', await page.locator('html').getAttribute('data-theme') !== null);

await page.screenshot({ path: path.join(OUT, '01-bos.png') });

/* ------------------------------------------------------------------ arama */

console.log('\narama');
await page.fill('#q', 'extra');
await page.waitForTimeout(400);
const n = await page.locator('.result').count();
check('sonuç listesi doldu', n > 3, `${n} sonuç`);
await page.screenshot({ path: path.join(OUT, '02-arama.png') });

const first = await page.locator('.result .w').first().textContent();
check('ilk sonuç anlamlı', /extra/i.test(first || ''), first || '');

// klavye ile gezinme
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
const sel = await page.locator('.result[aria-selected="true"]').count();
check('ok tuşu seçim yapıyor', sel === 1);

/* ------------------------------------------------------------------ madde */

console.log('\nmadde');
await page.fill('#q', 'extraordinary');
await page.waitForTimeout(400);
await page.keyboard.press('Enter');
await page.waitForTimeout(900);

check('madde açıldı', await page.locator('.entry h1').count() === 1);
const head = await page.locator('.entry h1').textContent();
check('başlık doğru', (head || '').toLowerCase().includes('extraordinary'), head || '');

const ipaCount = await page.locator('.entry-meta .ipa').count();
check('fonetik gösteriliyor', ipaCount === 1);
const ipa = ipaCount ? await page.locator('.entry-meta .ipa').textContent() : '';
check('fonetik IPA karakteri içeriyor', /[ɪɔəːˈ]/.test(ipa || ''), ipa || '');

const senseCount = await page.locator('.sense').count();
check('anlamlar listelendi', senseCount >= 1, `${senseCount} anlam`);

const trCount = await page.locator('.sense .tr').count();
check('Türkçe karşılık var', trCount >= 1);

const sayCount = await page.locator('.say').count();
check('telaffuz düğmesi var', sayCount === 1);

await page.screenshot({ path: path.join(OUT, '03-madde.png') });
await page.screenshot({ path: path.join(OUT, '03-madde-tam.png'), fullPage: true });

/* --------------------------------------------------------------- favoriler */

console.log('\nfavoriler');
await page.click('[data-act="fav"]');
await page.waitForTimeout(500);
const pressed = await page.locator('[data-act="fav"]').getAttribute('aria-pressed');
check('favori işaretlendi', pressed === 'true', pressed || '');

await page.click('[data-route="favorites"]');
await page.waitForTimeout(600);
const favCount = await page.locator('.result').count();
check('favori listede görünüyor', favCount >= 1, `${favCount} kayıt`);
await page.screenshot({ path: path.join(OUT, '04-favoriler.png') });

/* ----------------------------------------------------------------- ayarlar */

console.log('\nayarlar');
await page.click('[data-route="settings"]');
await page.waitForTimeout(500);
check('ayarlar açıldı', await page.locator('.settings').count() === 1);
await page.screenshot({ path: path.join(OUT, '05-ayarlar.png'), fullPage: true });

/* ------------------------------------------------------------- açık tema */

console.log('\naçık tema');
await page.click('[data-set="theme"][data-val="light"]');
await page.waitForTimeout(400);
const theme = await page.locator('html').getAttribute('data-theme');
check('tema açığa geçti', theme === 'light', theme || '');

await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
await page.fill('#q', 'water');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, '06-acik-arama.png') });

await page.keyboard.press('Enter');
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(OUT, '07-acik-madde.png') });

/* --------------------------------------------------------- TR -> EN yönü */

console.log('\nTR → EN');
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
await page.click('[data-act="flip"]');
await page.waitForTimeout(800);
await page.fill('#q', 'kitap');
await page.waitForTimeout(600);
const trN = await page.locator('.result').count();
check('Türkçe arama sonuç veriyor', trN > 0, `${trN} sonuç`);
const trFirst = trN ? await page.locator('.result .w').first().textContent() : '';
check('"kitap" için "kitap" veya türevi', /kitap/i.test(trFirst || ''), trFirst || '');
await page.screenshot({ path: path.join(OUT, '08-tr-arama.png') });

/* ------------------------------------------------------------------ konsol */

console.log('\nkonsol');
const real = errors.filter((e) => !/favicon|manifest|service ?worker|sw\.js|Failed to load resource.*404/i.test(e));
check('konsolda hata yok', real.length === 0, real.slice(0, 3).join(' | '));

if (real.length) {
  console.log('\n  konsol kayıtları:');
  real.slice(0, 8).forEach((e) => console.log('   ', e.slice(0, 160)));
}

await browser.close();

console.log(`\n${pass} geçti, ${fail} kaldı`);
console.log(`ekran görüntüleri: ${OUT}`);
process.exit(fail ? 1 : 0);
