#!/usr/bin/env node
/**
 * build-dict.mjs — Kaikki.org Wiktionary verisinden Lumen sözlük verisini üretir.
 *
 * Kullanım:
 *   node tools/build-dict.mjs --dir both
 *   node tools/build-dict.mjs --dir en --limit 5000        hızlı deneme
 *   node tools/build-dict.mjs --dir both --out dist/data   CI için hedef klasör
 *
 * Neden bu betik var:
 *   İngilizce Wiktionary verisinin tamamı 3,34 GB (523 MB gzip). Ne repoya
 *   sığar ne tarayıcıya indirilebilir. Betik dosyayı satır satır akış halinde
 *   okur — 3,34 GB'ı asla belleğe almaz — yalnızca Türkçe karşılığı olan
 *   kayıtları tutar, kompakt bir şemaya indirir ve harfe göre ayrı dosyalara
 *   yazar. Tarayıcı yalnızca ihtiyacı olan harfi indirir.
 *
 * Önemli bulgu:
 *   tr.wiktionary kayıtlarında `translations` alanı YOKTUR, yalnızca Türkçe
 *   tanım bulunur. Bu yüzden TR->EN yönü, EN->TR çiftlerinin tersine
 *   çevrilmesiyle üretilir. Bilingual sözlüklerin çoğu böyle çalışır.
 *
 * Çıktı:
 *   <out>/manifest.json          hangi yönler var, kaç kelime
 *   <out>/<dir>/index.json       arama dizini: [kelime, tür, ilk karşılık]
 *   <out>/<dir>/<harf>.json      o harfin tam maddeleri
 *
 * Lisans: kaynak veri CC BY-SA 4.0 (Wiktionary). Uygulamada atıf zorunludur.
 */

import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_EN =
  'https://kaikki.org/dictionary/English/words/kaikki.org-dictionary-English-words.jsonl.gz';

const ROOT = path.resolve(import.meta.dirname, '..');

/* ------------------------------------------------------------------ argümanlar */

const argv = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
};

const DIR = arg('dir', 'both');           // en | tr | both
const OUT = path.resolve(arg('out', path.join(ROOT, 'data')));
const LIMIT = parseInt(arg('limit', '0'), 10) || 0;
const QUIET = argv.includes('--quiet');
const log = (...a) => { if (!QUIET) console.log(...a); };

/* ------------------------------------------------- ikinci katman (FreeDict) */

/*
 * FreeDict eng-tur AYRI bir eserdir ve GPL-2.0+ lisanslıdır; ana veri
 * Wiktionary'den ve CC BY-SA 4.0. İkisi tek dosyada birleştirilmez —
 * GPLv2 §2'deki "mere aggregation" hükmü gereği ayrı tutulur ve uygulama
 * bunları yalnızca çalışma anında bellekte birleştirir.
 *
 * Buradaki rolü şu: Wiktionary'nin Türkçe çevirisi OLMAYAN maddeler normalde
 * atılır. FreeDict'in karşılığı olan kelimeler için kayıt TUTULUR, böylece
 * madde zengin gelir (tanım, örnek, IPA, etimoloji) — Türkçe karşılıklar
 * çalışma anında ikinci katmandan eklenir.
 *
 * Ölçüm: `extravagant`, `explicit`, `exotic`, `exquisite` gibi kelimelerin
 * Wiktionary kaydı dolu, yalnızca Türkçesi yok. Bu adım kapsamı
 * ilk 10.000 sıklıkta %69,8 → %80,7'ye çıkarıyor.
 */
const FREEDICT_DIR = path.join(ROOT, 'data', 'freedict');
const FREEDICT_WORDS = (() => {
  const set = new Set();
  if (!fs.existsSync(FREEDICT_DIR)) return set;
  for (const f of fs.readdirSync(FREEDICT_DIR)) {
    if (!/^[a-z_]\.json$/.test(f)) continue;
    for (const w of Object.keys(JSON.parse(fs.readFileSync(path.join(FREEDICT_DIR, f), 'utf8')))) {
      set.add(w);
    }
  }
  return set;
})();
log(`ikinci katman: ${FREEDICT_WORDS.size.toLocaleString('tr-TR')} FreeDict kelimesi yüklendi`);

/* ------------------------------------------------------------------ sınırlar */
/* Tarayıcıya inen dosyalar şişmesin diye alan bazlı tavanlar. */
const CAP = {
  senses: 10,
  tr: 8,
  ex: 3,
  rel: 8,        // eş/zıt/ilgili/türev listeleri — 15 maddeyi sayfada boğuyordu
  ety: 500,
  def: 300,
  word: 60,
  ipa: 3,
  aud: 3,
};

/* ------------------------------------------------------- Türkçe harf eşlemesi */
/* Parça adları ASCII'ye indirilir ki dosya adları her sistemde sorunsuz olsun. */
const TR_FOLD = {
  ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i',
  ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
};

function chunkOf(word) {
  const first = String(word || '').trim().charAt(0);
  if (!first) return '_';
  const folded = (TR_FOLD[first] || first).toLowerCase();
  return /[a-z]/.test(folded) ? folded : '_';
}

/* ------------------------------------------------------------------ ayıklama */

const POS_KEEP = new Set([
  'noun', 'verb', 'adj', 'adv', 'prep', 'conj', 'pron', 'interj',
  'num', 'det', 'particle', 'phrase', 'abbrev', 'name', 'prop',
]);

const clean = (s, max) => {
  const v = String(s || '').replace(/\s+/g, ' ').trim();
  return max && v.length > max ? v.slice(0, max - 1).trimEnd() + '…' : v;
};

/** Karşılaştırma için tanım normalleştirmesi. */
const normDef = (s) => String(s || '')
  .replace(/\s+/g, ' ').replace(/[.;,]+$/, '').trim().toLowerCase();

/**
 * Üst düzey çeviri tablosundaki kısa `sense` etiketi bir anlamın tanımıyla
 * örtüşüyor mu?
 *
 * Etiketler tanımdan kısa olur ("unit of language" ↔ "the smallest unit of
 * language that has a particular meaning"). Bu yüzden önek/alt dize
 * karşılaştırması gerekir — tam eşitlik ölçüldüğünde eşleşme %0 çıkıyordu.
 *
 * Kısa etiketlerde (ör. "a") önek kuralı neredeyse her tanımla eşleşir;
 * yanlış anlama çeviri bağlamamak için en az 8 karakter şartı var. Eşleşme
 * olmazsa çeviri kaybolmaz — etiket tanım olarak kullanılıp yeni anlam açılır.
 */
function overlaps(label, def) {
  const a = normDef(label), b = normDef(def);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 8) return false;
  if (b.startsWith(a)) return true;
  return a.length >= 14 && b.includes(a);
}

/**
 * Anlamları ve çevirileri EŞLEŞTİREREK çıkarır.
 *
 * Burada bir hatadan dönüldü: Kaikki verisinde Türkçe çeviriler her anlamın
 * KENDİ içinde durur (sense.translations). Çevirileri düzleştirip maddenin ilk
 * anlamına yığmak, tanım ile karşılığı birbirinden koparıyordu. Örnek:
 * "mature" sıfatının 0. anlamı "Profound; careful." (çevirisi yok), 3. anlamı
 * "Fully developed" (6 çevirisi var). Düzleştirilince ekranda "Profound;
 * careful." tanımının altında "olgun, yetişkin" görünüyordu — yanlış eşleşme.
 *
 * Doğrusu: her anlam kendi tanımını, kendi çevirisini ve kendi örneğini taşır.
 * Çevirisi olan anlamlar listenin başına alınır (kullanıcı zaten onları arıyor).
 *
 * ---------------------------------------------------------------------------
 * İKİ ÇEVİRİ KAYNAĞI VAR ve ikisi de okunmalı:
 *
 *   1. sense.translations — anlamın kendi içindeki çeviri (asıl kaynak)
 *   2. entry.translations — maddenin üstünde duran toplu çeviri tablosu
 *
 * İkincisi önceden HİÇ okunmuyordu ve ölçülebilir kayıp yaratıyordu: "cat"
 * (kedi), "dictionary" (sözlük), "new", "make", "system", "policy", "movie"
 * gibi kelimelerin Wiktionary kaydında Türkçe çeviri YALNIZCA üst düzey
 * tabloda duruyor. Ölçüm: 1.737 kayıt yalnızca bu yolla kazanılıyor
 * (+1.505 kelime, ilk-10.000 frekans kapsamı %44,0 → %48,3).
 *
 * Üst düzey tabloda her çevirinin yanında kısa bir `sense` etiketi olur
 * (ör. "unit of language"). Bu etiket bir anlamın tanımıyla örtüşüyorsa
 * çeviri O anlama eklenir; örtüşmüyorsa etiket tanım yerine geçip yeni bir
 * anlam açılır. Böylece yukarıdaki kural korunur — çeviriler ilk anlama
 * yığılmaz, her çeviri kendi tanımıyla eşleşir.
 */
function buildSenses(entry) {
  const all = [];
  const index = new Map();   // "tür\0tanım" -> all içindeki konum

  /** Anlam ekler; aynı tür+tanım zaten varsa çevirileri BİRLEŞTİRİR. */
  const add = (pos, def, tr, ex = []) => {
    if (!def && !tr.length) return;
    const key = pos + '\u0000' + def;
    const at = index.get(key);

    if (at !== undefined) {
      const prev = all[at];
      for (const w of tr) {
        if (prev.tr.length < CAP.tr && !prev.tr.includes(w)) prev.tr.push(w);
      }
      if (!prev.ex.length && ex.length) prev.ex = ex;
      prev._tr = prev.tr.length ? 1 : 0;
      return;
    }

    index.set(key, all.length);
    all.push({ pos, def, tr, ex, _tr: tr.length ? 1 : 0, _i: all.length });
  };

  /** Bir çeviri listesinden Türkçe karşılıkları süzer. */
  const trWordsOf = (list) => {
    const out = [];
    for (const t of list || []) {
      if (t.lang !== 'Turkish' && t.code !== 'tr') continue;
      const w = clean(t.word, 60);
      if (w && !out.includes(w) && out.length < CAP.tr) out.push(w);
    }
    return out;
  };

  /* 1. anlamların kendi içindeki çeviriler */
  for (const sense of entry.senses || []) {
    add(
      normPos(sense.pos || entry.pos || ''),
      clean((sense.glosses || [])[0], CAP.def),
      trWordsOf(sense.translations),
      pickExamples(sense.examples)
    );
  }

  /* 2. maddenin üstündeki toplu çeviri tablosu */
  const entryPos = normPos(entry.pos || '');
  for (const t of entry.translations || []) {
    if (t.lang !== 'Turkish' && t.code !== 'tr') continue;
    const w = clean(t.word, 60);
    if (!w) continue;

    const label = clean(t.sense, CAP.def);
    const target = label ? all.find((s) => s.def && overlaps(label, s.def)) : null;

    if (target) {
      if (target.tr.length < CAP.tr && !target.tr.includes(w)) {
        target.tr.push(w);
        target._tr = 1;
      }
      continue;
    }
    add(entryPos, label, [w]);
  }

  all.sort((a, b) => (b._tr - a._tr) || (a._i - b._i));

  return all.slice(0, CAP.senses).map(({ pos, def, tr, ex }) => ({ pos, def, tr, ex }));
}

/** Telaffuzlar: IPA ve ses dosyası adresleri. */
function soundsOf(entry) {
  const ipa = [];
  const aud = [];
  for (const s of entry.sounds || []) {
    if (s.ipa && ipa.length < CAP.ipa) {
      ipa.push({ v: clean(s.ipa).replace(/^\/|\/$/g, ''), t: (s.tags || []).slice(0, 3) });
    }
    // mp3 varsa onu, yoksa ogg'u al — Safari mp3 ister
    const url = s.mp3_url || s.ogg_url;
    if (url && aud.length < CAP.aud) {
      aud.push({ u: url, t: (s.tags || []).slice(0, 3) });
    }
  }
  return { ipa, aud };
}

function firstGloss(entry) {
  for (const sense of entry.senses || []) {
    const g = (sense.glosses || [])[0];
    if (g) return clean(g, CAP.def);
  }
  return '';
}

/**
 * Örnek cümle seçimi.
 *
 * Wiktionary örnekleri arasında 16. yüzyıldan kalma alıntılar var; uzun-s (ſ),
 * "thou/hath/shalt" gibi arkaik biçimler içeriyorlar. Ekranda okunmuyorlar ve
 * maddeyi şişiriyorlar. Bu yüzden arkaik olanlar ve 150 karakteri aşanlar
 * elenir; kalanlar arasında Wiktionary'nin kendi sırası korunur.
 *
 * DİKKAT — burada bir tuzağa düşmüştüm: karakter kontrolü ayrı tutulmalı.
 * `/[ſƿǽ]/i` yazıldığında Python/JS'in harf duyarsız eşlemesi ſ (U+017F) ile
 * normal "s" harfini aynı sayar, çünkü ſ'in büyük harf eşleniği S'tir. Sonuç:
 * içinde "s" geçen her cümle arkaik sanılıp elenir. Bu yüzden karakter sınıfı
 * harf duyarsız bayrak OLMADAN, kelime listesi ise ayrı bir desen olarak
 * çalıştırılır.
 */
const ARCHAIC_CHAR = /[ſƿǽ]/;
const ARCHAIC_WORD =
  /\b(thou|thee|thy|thine|hath|doth|dost|shalt|wilt|hither|thence|whence|whereof|thereof|unto|verily|alas)\b/i;

function pickExamples(examples) {
  const texts = (examples || [])
    .map((e) => clean(e.text, 200))
    .filter((t) =>
      t &&
      t.length >= 12 &&
      t.length <= 150 &&
      !ARCHAIC_CHAR.test(t) &&
      !ARCHAIC_WORD.test(t)
    );
  return texts.slice(0, CAP.ex);
}

/** Bir kaydı Lumen şemasına indirger. */
function compact(entry) {
  const { ipa, aud } = soundsOf(entry);

  const rec = { w: clean(entry.word, CAP.word), pos: String(entry.pos || '').toLowerCase() };
  if (ipa.length) rec.ipa = ipa;
  if (aud.length) rec.aud = aud;

  // Heceleme: kaynakta parantez/ayraç artıkları olabiliyor
  // (ör. ["ex","tra(",")or","di","na","ry"]) — bunlar "ex·tra(·)or" gibi
  // bozuk görünüme yol açtığı için süzülür.
  const sylRaw = entry.hyphenations?.[0]?.parts;
  if (sylRaw) {
    const cleanParts = sylRaw
      .map((p) => clean(p, 20))
      .filter((p) => p && !/[()[\]{}<>|/\\,;:•·–—]/.test(p));
    // Parçaların birleşimi kelimeyi vermeli; vermiyorsa veri güvenilmez
    const joined = cleanParts.join('');
    const target = clean(entry.word, CAP.word);
    if (cleanParts.length > 1 && cleanParts.length <= 12 && joined === target) {
      rec.syl = cleanParts;
    }
  }

  const ety = clean(entry.etymology_text, CAP.ety);
  if (ety) rec.ety = ety;

  rec.s = buildSenses(entry);

  const words = (list) => [...new Set((list || []).map((x) => clean(x.word, 40)).filter(Boolean))].slice(0, CAP.rel);
  const syn = words(entry.synonyms);
  const ant = words(entry.antonyms);
  const rel = words(entry.related);
  const der = words(entry.derived);
  if (syn.length) rec.syn = syn;
  if (ant.length) rec.ant = ant;
  if (rel.length) rec.rel = rel;
  if (der.length) rec.der = der;

  return rec;
}

/** Sözlük türü kodunu sadeleştirir. */
const normPos = (p) => {
  const v = String(p || '').toLowerCase();
  return POS_KEEP.has(v) ? v : (v || '');
};

/* ------------------------------------------------------------------ akış */

/**
 * Uzak JSONL.gz dosyasını satır satır okur. Dosya belleğe alınmaz.
 * @returns {Promise<number>} işlenen kayıt sayısı
 */
async function streamJsonl(url, onEntry) {
  log(`  indiriliyor: ${url.split('/').pop()}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kaynak indirilemedi: HTTP ${res.status}`);

  let seen = 0;
  const rl = createInterface({
    input: Readable.fromWeb(res.body).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    seen++;
    onEntry(entry);
    if (LIMIT && seen >= LIMIT) { rl.close(); break; }
    if (!QUIET && seen % 50000 === 0) {
      process.stdout.write(`\r  işlenen: ${seen.toLocaleString('tr-TR')}   `);
    }
  }
  if (!QUIET) process.stdout.write('\r' + ' '.repeat(44) + '\r');
  return seen;
}

/* ------------------------------------------------------------ EN -> TR derleme */

async function buildEnTr() {
  log('\n▸ EN → TR derleniyor');
  const records = new Map();   // word -> kayıt

  const total = await streamJsonl(SOURCE_EN, (entry) => {
    const rec = compact(entry);
    if (!rec.w || !rec.s.length) return;

    // Türkçe karşılığı olmayan kayıtlar normalde sözlüğe girmez — bu iki dilli
    // bir sözlük. Ama ikinci katmanda (FreeDict) karşılığı olan kelimeler
    // TUTULUR: madde zenginliği Wiktionary'den gelir, Türkçe karşılık çalışma
    // anında eklenir. Aksi hâlde `extravagant` gibi kelimeler tümüyle düşerdi.
    //
    // İKİNCİ KOŞUL ŞART: kelime tamamen küçük harf olmalı. Aksi hâlde
    // "Water" (yer adı) gibi büyük harfli kayıtlar da gelir — çünkü
    // "water".toLowerCase() FreeDict'te vardır — ve hem dizinde hem aramada
    // "water" maddesinin yanına düşüp onu gölgeler. Ölçüm: bu koşul olmadan
    // 5.948 yinelenen (yalnızca büyük/küçük harfte ayrışan) kayıt oluşuyordu.
    const hasTr = rec.s.some((s) => s.tr.length);
    const supplemented = rec.w === rec.w.toLowerCase()
      && FREEDICT_WORDS.has(rec.w.toLowerCase());
    if (!hasTr && !supplemented) return;

    rec.pos = normPos(rec.pos);

    const prev = records.get(rec.w);
    if (!prev) { records.set(rec.w, rec); return; }

    // Aynı kelimenin farklı türleri: birleştir
    for (const s of rec.s) {
      const dup = prev.s.find((x) => x.pos === s.pos && x.def === s.def);
      if (!dup) prev.s.push(s);
      else for (const t of s.tr) if (!dup.tr.includes(t) && dup.tr.length < CAP.tr) dup.tr.push(t);
    }
    // Birleştirme sonrası tavanı yeniden uygula; çevirisi olanlar önde kalsın
    if (prev.s.length > CAP.senses) {
      prev.s.sort((a, b) => (b.tr.length ? 1 : 0) - (a.tr.length ? 1 : 0));
      prev.s = prev.s.slice(0, CAP.senses);
    }
    for (const k of ['syn', 'ant', 'rel', 'der']) {
      if (rec[k]) prev[k] = [...new Set([...(prev[k] || []), ...rec[k]])].slice(0, CAP.rel);
    }
    if (!prev.ipa && rec.ipa) prev.ipa = rec.ipa;
    if (!prev.aud && rec.aud) prev.aud = rec.aud;
    if (!prev.ety && rec.ety) prev.ety = rec.ety;
  });

  log(`  ${total.toLocaleString('tr-TR')} kayıt tarandı, ${records.size.toLocaleString('tr-TR')} kelime bulundu`);
  return records;
}

/* ------------------------------------------------------ TR -> EN (ters çevirme) */

function invert(enTr) {
  log('\n▸ TR → EN tersine çevriliyor');
  const out = new Map();

  for (const rec of enTr.values()) {
    // Her anlam KENDİ tanımını ve örneğini taşır. Dışarıda tek bir tanım
    // hesaplamak (rec.s[0].def) yanlış eşleşme üretirdi: 3. anlamdan gelen bir
    // Türkçe kelime, 0. anlamın tanımıyla görünürdü.
    for (const s of rec.s || []) {
      const pos = s.pos || rec.pos || '';

      for (const trWord of s.tr || []) {
        const w = clean(trWord, CAP.word);
        if (!w) continue;

        let target = out.get(w);
        if (!target) {
          target = { w, pos, s: [] };
          out.set(w, target);
        }

        const slot = target.s.find((x) => x.pos === pos);
        if (slot) {
          if (!slot.tr.includes(rec.w) && slot.tr.length < CAP.tr) slot.tr.push(rec.w);
        } else if (target.s.length < CAP.senses) {
          target.s.push({
            pos,
            def: '',                       // Türkçe tanım kaynakta yok
            tr: [rec.w],
            en: s.def ? [s.def] : [],      // İngilizce karşılığın tanımı — hangi kelimenin doğru olduğunu netleştirir
            ex: (s.ex || []).slice(0, CAP.ex),
          });
        }
      }
    }
  }

  log(`  ${out.size.toLocaleString('tr-TR')} Türkçe kelime üretildi`);
  return out;
}

/* ------------------------------------------------------------------ yazma */

async function writeDir(dir, records) {
  const target = path.join(OUT, dir);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  const buckets = new Map();
  for (const rec of records.values()) {
    const k = chunkOf(rec.w);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(rec);
  }

  const index = [];
  let bytes = 0;

  for (const [letter, list] of [...buckets].sort()) {
    list.sort((a, b) => a.w.localeCompare(b.w, 'tr'));
    const json = JSON.stringify(list);
    await writeFile(path.join(target, `${letter}.json`), json, 'utf8');
    bytes += Buffer.byteLength(json);

    for (const rec of list) {
      const tr = rec.s?.[0]?.tr?.[0] || '';
      index.push([rec.w, rec.pos || '', tr]);
    }
  }

  const indexJson = JSON.stringify(index);
  await writeFile(path.join(target, 'index.json'), indexJson, 'utf8');

  log(`  ${dir}: ${records.size.toLocaleString('tr-TR')} kelime, ${buckets.size} parça`);
  log(`    parçalar ${(bytes / 1048576).toFixed(1)} MB, dizin ${(Buffer.byteLength(indexJson) / 1048576).toFixed(2)} MB`);

  return { count: records.size, letters: [...buckets.keys()].sort() };
}

async function writeManifest(meta) {
  const manifest = {
    generated: new Date().toISOString(),
    source: 'Kaikki.org / Wiktionary',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    dirs: meta,
  };
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  log(`\n  manifest yazıldı: ${Object.keys(meta).join(', ')}`);
}

/* ------------------------------------------------------------------ main */

async function main() {
  await mkdir(OUT, { recursive: true });
  log(`hedef klasör: ${OUT}`);

  const meta = {};

  if (DIR === 'en' || DIR === 'both') {
    const enTr = await buildEnTr();
    meta['en-tr'] = await writeDir('en-tr', enTr);

    if (DIR === 'both') {
      const trEn = invert(enTr);
      meta['tr-en'] = await writeDir('tr-en', trEn);
    }
  }

  if (DIR === 'tr') {
    // Yalnızca TR->EN isteniyorsa kaynak yine İngilizce veridir
    const enTr = await buildEnTr();
    const trEn = invert(enTr);
    meta['tr-en'] = await writeDir('tr-en', trEn);
  }

  await writeManifest(meta);
  log('\nbitti.');
}

main().catch((e) => {
  console.error('\nhata:', e.message);
  process.exit(1);
});
