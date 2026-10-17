#!/usr/bin/env node
/**
 * test-speech.mjs — telaffuz hattını gerçek tarayıcıda sınar.
 *
 * test-ui.mjs yalnızca "Dinle" düğmesinin VAR OLDUĞUNU doğruluyor; sesin
 * gerçekten çözülüp çalındığını doğrulamıyor. Bu betik o boşluğu kapatır:
 *
 *   1. Wikimedia ses kaydı gerçekten bulunuyor mu (ağ turu + ayrıştırma)
 *   2. Bulunan adres <audio> öğesine veriliyor ve play() çağrılıyor mu
 *   3. Çalınamazsa sessizce yedeğe geçiliyor mu, yoksa kullanıcıya
 *      anlaşılır bir hata mı gösteriliyor (spesifikasyon: sessiz yedek YOK)
 *   4. Hata bildirimi "Tekrar dene" ve "Harici sözlükte aç" içeriyor mu
 *
 * Ön koşul: 8777 portunda sunucu çalışıyor olmalı.
 *   python -m http.server 8777
 *
 * Playwright projenin bağımlılığı değil; kurulu yeri göster:
 *   PLAYWRIGHT_PATH=/yol/node_modules/playwright/index.mjs node tools/test-speech.mjs
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAW = process.env.PLAYWRIGHT_PATH || 'playwright';
const PW = path.isAbsolute(RAW) ? pathToFileURL(RAW).href : RAW;

let chromium;
try {
  ({ chromium } = await import(PW));
} catch (e) {
  console.error(`Playwright bulunamadı: ${RAW}`);
  console.error(String(e.message || e).slice(0, 120));
  process.exit(2);
}

const BASE = process.env.BASE || 'http://127.0.0.1:8777';
const OUT = path.resolve(import.meta.dirname, '..', '.shots');

let pass = 0;
let fail = 0;
const check = (l, c, e = '') => {
  if (c) { pass++; console.log(`  ✓ ${l}`); }
  else { fail++; console.log(`  ✗ ${l}${e ? '  → ' + e : ''}`); }
};

const browser = await chromium.launch({
  // Sessiz ortamda da oynatma başlasın; aksi hâlde Chromium sesi bloke eder
  // ve testi "başarısız" sanırız — oysa sorun test ortamındadır.
  args: ['--autoplay-policy=no-user-gesture-required'],
});

const ctx = await browser.newContext({
  viewport: { width: 430, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});

/* <audio> öğesini gözlemle: speech.js `new Audio()` kullanır ve öğeyi DOM'a
   eklemez, bu yüzden seçiciyle bulunamaz. Yapıcıyı sarıyoruz. */
await ctx.addInitScript(() => {
  const Orig = window.Audio;
  window.__audio = [];
  window.Audio = function (...args) {
    const el = new Orig(...args);
    const rec = { src: '', plays: 0, events: [], errors: [] };
    window.__audio.push(rec);
    el.addEventListener('playing', () => rec.events.push('playing'));
    el.addEventListener('error', () => rec.events.push('error'));
    const origPlay = el.play.bind(el);
    el.play = () => {
      rec.plays++;
      rec.src = el.currentSrc || el.src || '';
      const p = origPlay();
      if (p && typeof p.catch === 'function') {
        p.catch((e) => rec.errors.push(String((e && e.name) || e)));
      }
      return p;
    };
    return el;
  };
  window.Audio.prototype = Orig.prototype;
});

const page = await ctx.newPage();
const errs = [];
const media = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('request', (r) => {
  const u = r.url();
  if (/wikimedia|wiktionary/i.test(u)) media.push(u);
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);

/* ------------------------------------------------------------------ madde */
console.log('\nmadde açılıyor');
await page.fill('#q', 'water');
await page.waitForTimeout(500);
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);

check('madde açıldı', await page.locator('.entry h1').count() === 1);
check('telaffuz düğmesi var', await page.locator('[data-act="say"]').count() === 1);

const entryAud = await page.evaluate(() => {
  // maddenin kendi taşıdığı ses adresleri (Kaikki verisi)
  return window.__lumenProbe || null;
});

/* --------------------------------------------------------------- telaffuz */
console.log('\ntelaffuz deneniyor');
await page.click('[data-act="say"]');
await page.waitForTimeout(6000);

const audio = await page.evaluate(() => window.__audio || []);
const played = audio.filter((a) => a.plays > 0);
const sounding = audio.filter((a) => a.events.includes('playing'));
const toastText = (await page.locator('#toast .notice .t').count())
  ? (await page.locator('#toast .notice .t').innerText()).replace(/\s+/g, ' ').trim()
  : '';

console.log(`  · audio öğesi: ${audio.length}, play() çağrısı: ${played.length}, çalan: ${sounding.length}`);
console.log(`  · Wikimedia isteği: ${media.length}`);
if (played.length) console.log(`  · adres: ${String(played[0].src).slice(0, 96)}`);
if (toastText) console.log(`  · bildirim: ${toastText.slice(0, 140)}`);

check('audio öğesi oluşturuldu', audio.length >= 1);
check('play() çağrıldı', played.length >= 1);
check('bir adres atandı', played.length > 0 && /^https?:/.test(played[0].src), played[0] ? played[0].src : '(yok)');

const source = played.length ? played[0].src : '';
check(
  'adres Wikimedia kaydı ya da mp3 dönüşümü',
  /upload\.wikimedia\.org/.test(source),
  source.slice(0, 90)
);

/* Ses çalmadıysa: sessiz yedek YOK kuralı gereği kullanıcıya bildirim
   gösterilmiş olmalı. Çaldıysa bildirim gösterilmemeli. */
if (sounding.length) {
  check('çalınca hata bildirimi yok', toastText === '', toastText.slice(0, 90));
} else {
  check('çalmayınca kullanıcıya bildirildi', toastText.length > 0, '(bildirim yok — sessiz başarısızlık)');
  const retry = await page.locator('#toast [data-act="retry"]').count();
  const ext = await page.locator('#toast a.textbtn').count();
  check('bildirimde "Tekrar dene" var', retry === 1, `${retry}`);
  check('bildirimde "Harici sözlükte aç" var', ext === 1, `${ext}`);
}

await page.screenshot({ path: path.join(OUT, '61-telaffuz.png') });

/* ---------------------------------------------------------- hata yolu testi */
/* Var olmayan bir kelimede kayıt bulunamayacağı kesin; hattın hata dalı
   gerçekten çalışıyor mu ve mesaj insan dilinde mi. */
console.log('\nhata yolu (olmayan kayıt)');
await page.goto(`${BASE}/#/w/zzzqqx`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
const missing = await page.locator('.empty h3').count();
check('olmayan kelimede boş durum gösterildi', missing === 1);

/* ------------------------------------------------------- konuşma sentezi */
const synth = await page.evaluate(() => {
  if (!('speechSynthesis' in window)) return { supported: false };
  return { supported: true, voices: speechSynthesis.getVoices().length };
});
console.log(`  · speechSynthesis: ${synth.supported ? 'var' : 'yok'}, ses paketi: ${synth.voices ?? '-'}`);

check('konsolda beklenmeyen hata yok', errs.filter((e) => !/favicon|manifest|sw\.js|404/i.test(e)).length === 0,
  errs.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
