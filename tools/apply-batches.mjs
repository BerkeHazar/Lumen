#!/usr/bin/env node
/**
 * apply-batches.mjs — kendi ürettiğimiz kelime verisini sözlüğe işler.
 *
 * NEDEN VAR
 *   Sözlüğün omurgası Kaikki.org'dan (Wiktionary) üretiliyor ve o kaynak
 *   yalnızca yayın sırasında indirilebiliyor. Bu, sitenin "her şeyi kendinden
 *   çek" ilkesini bozuyordu: veri repoda duruyor ama her yayında 523 MB'lık
 *   arşiv yeniden çekiliyordu.
 *
 *   Artık kendi eklediğimiz maddeler `tools/batches/` altında, okunabilir ve
 *   sürüm kontrollü JSON dosyalarında duruyor. Bu betik onları derlenmiş
 *   veriye (`data/<dir>/`) işler, dizini ve manifest'i yeniden yazar.
 *
 *   Böylece:
 *     - veri tamamen repodan gelir (dış servise bağımlılık yok),
 *     - Kaikki yeniden derlense bile kendi maddelerimiz kaybolmaz
 *       (refresh-data.yml bu betiği derlemeden SONRA çalıştırır),
 *     - her ekleme git geçmişinde tek tek görünür.
 *
 * LİSANS
 *   Bu maddeler bize ait, özgün yazılmış tanımlardır → CC0-1.0.
 *   Wiktionary türevi veriler CC BY-SA 4.0 olarak kalır. CC0 hiçbir koşul
 *   getirmediği için aynı dosyada birleşmeleri CC BY-SA'yı ihlal etmez
 *   (GPL olan FreeDict bu yüzden AYRI tutuluyor; orada durum farklı).
 *
 * KULLANIM
 *   node tools/apply-batches.mjs            # data/ içine işle
 *   node tools/apply-batches.mjs --dry      # yazmadan raporla
 *   node tools/apply-batches.mjs --out dist/data
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BATCHES = path.join(HERE, 'batches');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const OUT = (() => {
  const i = argv.indexOf('--out');
  return path.resolve(ROOT, i >= 0 ? argv[i + 1] : 'data');
})();

const DIRS = ['en-tr', 'tr-en'];
const log = (s) => console.log(s);

/* ------------------------------------------------------------------ yardımcı */

/** Türkçe harfleri ASCII'ye indirger — parça (shard) adı kuralı, js/dict.js ile aynı. */
const TR_FOLD = { ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u' };

function chunkOf(word) {
  const first = String(word || '').trim().charAt(0);
  if (!first) return '_';
  const folded = (TR_FOLD[first] || first).toLowerCase();
  return /[a-z]/.test(folded) ? folded : '_';
}

/** Madde anahtarı: aynı kelimenin farklı türleri ayrı kayıttır. */
const keyOf = (rec) => `${rec.w}\u0000${(rec.pos || '').toLowerCase()}`;

/** Bir maddenin ilk Türkçe karşılığı (dizin satırı için). */
function firstTr(rec) {
  for (const s of rec.s || []) {
    if (s.tr && s.tr.length) return s.tr[0];
  }
  return '';
}

/* ------------------------------------------------------------------- yükleme */

async function loadBatches() {
  let names = [];
  try {
    names = await readdir(BATCHES);
  } catch {
    // Parti klasörü henüz yoksa araç hata vermez: hiçbir şey eklenmemiş demektir.
    return { out: { 'en-tr': [], 'tr-en': [] }, files: [] };
  }
  const files = names.filter((f) => f.endsWith('.json')).sort();
  const out = { 'en-tr': [], 'tr-en': [] };
  const seen = { 'en-tr': new Map(), 'tr-en': new Map() };

  for (const f of files) {
    const raw = JSON.parse(await readFile(path.join(BATCHES, f), 'utf8'));
    for (const dir of DIRS) {
      for (const rec of raw.entries?.[dir] || []) {
        validate(rec, `${f} / ${dir}`);

        // Aynı kelime iki ayrı partide geçerse sonraki kazanır — sessizce
        // değil: uyarı basıyoruz, çünkü bu genelde kopyala-yapıştır hatasıdır.
        const prev = seen[dir].get(keyOf(rec));
        if (prev) log(`  ! ${dir}: "${rec.w}" (${rec.pos}) ${prev.file} ve ${f} içinde var — ${f} kazanıyor`);
        seen[dir].set(keyOf(rec), { file: f, rec });
      }
    }
  }

  for (const dir of DIRS) out[dir] = [...seen[dir].values()].map((x) => x.rec);
  return { out, files };
}

/** Şemayı denetler — bozuk madde veriye sızmasın. */
function validate(rec, where) {
  const bad = (m) => { throw new Error(`${where}: ${m} — ${JSON.stringify(rec).slice(0, 160)}`); };
  if (!rec || typeof rec !== 'object') bad('madde nesne değil');
  if (!rec.w || typeof rec.w !== 'string') bad('"w" (kelime) zorunlu');
  if (!rec.pos || typeof rec.pos !== 'string') bad(`"${rec.w}": "pos" zorunlu`);
  if (!Array.isArray(rec.s) || !rec.s.length) bad(`"${rec.w}": en az bir anlam ("s") gerekli`);
  for (const s of rec.s) {
    if (!s || typeof s.def !== 'string' || !s.def.trim()) bad(`"${rec.w}": anlamın "def" alanı boş`);
    if (s.tr && !Array.isArray(s.tr)) bad(`"${rec.w}": "tr" dizi olmalı`);
    if (s.ex && !Array.isArray(s.ex)) bad(`"${rec.w}": "ex" dizi olmalı`);
  }
}

async function loadShards(dir) {
  const target = path.join(OUT, dir);
  const files = (await readdir(target)).filter((f) => f.endsWith('.json') && f !== 'index.json');
  const map = new Map();
  for (const f of files) {
    const rows = JSON.parse(await readFile(path.join(target, f), 'utf8'));
    for (const rec of rows) map.set(keyOf(rec), rec);
  }
  return map;
}

/* ------------------------------------------------------------------- birleşme */

/**
 * Parti maddesini mevcut maddeye katar.
 *
 * Kural: Wiktionary'nin tanımı ASLA silinmez. Parti yalnızca
 *   - yeni anlam ekler (aynı pos+def yoksa),
 *   - boş Türkçe karşılıkları doldurur,
 *   - eksik IPA / örnek cümle alanlarını tamamlar.
 * Böylece kendi eklememiz kaynağı bozamaz.
 */
function mergeInto(target, incoming) {
  let touched = false;
  target.s = target.s || [];

  for (const s of incoming.s || []) {
    const same = target.s.find(
      (x) => (x.pos || '') === (s.pos || '') && x.def.trim().toLowerCase() === s.def.trim().toLowerCase()
    );
    if (same) {
      // Tanım zaten var: yalnızca karşılık/örnek boşsa tamamla
      if ((!same.tr || !same.tr.length) && s.tr?.length) { same.tr = s.tr; touched = true; }
      if ((!same.ex || !same.ex.length) && s.ex?.length) { same.ex = s.ex; touched = true; }
    } else {
      target.s.push(s);
      touched = true;
    }
  }

  for (const k of ['ipa', 'aud', 'ety', 'syl', 'syn', 'ant', 'rel', 'der']) {
    if (incoming[k] && !target[k]) { target[k] = incoming[k]; touched = true; }
  }
  return touched;
}

/* --------------------------------------------------------------------- yazma */

async function writeDir(dir, map, dry = false) {
  const target = path.join(OUT, dir);
  if (!dry) await mkdir(target, { recursive: true });

  const buckets = new Map();
  for (const rec of map.values()) {
    const k = chunkOf(rec.w);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(rec);
  }

  const index = [];
  let bytes = 0;

  for (const [letter, list] of [...buckets].sort()) {
    list.sort((a, b) => a.w.localeCompare(b.w, 'tr'));
    const json = JSON.stringify(list);
    if (!dry) await writeFile(path.join(target, `${letter}.json`), json, 'utf8');
    bytes += Buffer.byteLength(json);
    for (const rec of list) index.push([rec.w, rec.pos || '', firstTr(rec)]);
  }

  const indexJson = JSON.stringify(index);
  if (!dry) await writeFile(path.join(target, 'index.json'), indexJson, 'utf8');

  return { count: map.size, letters: [...buckets.keys()].sort(), bytes, indexBytes: Buffer.byteLength(indexJson) };
}

/* ---------------------------------------------------------------------- main */

async function main() {
  log('\nLumen — kendi kelime partileri işleniyor');
  log(`  kaynak : tools/batches/`);
  log(`  hedef  : ${path.relative(ROOT, OUT)}/\n`);

  const { out, files } = await loadBatches();
  log(`  ${files.length} parti bulundu: ${files.join(', ')}\n`);

  const manifestPath = path.join(OUT, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  let changed = false;
  const stats = {};

  for (const dir of DIRS) {
    const map = await loadShards(dir);
    const before = map.size;

    let added = 0;
    let enriched = 0;

    for (const rec of out[dir]) {
      const k = keyOf(rec);
      const existing = map.get(k);
      if (!existing) {
        map.set(k, rec);
        added++;
        continue;
      }
      if (mergeInto(existing, rec)) enriched++;
    }

    const w = await writeDir(dir, map, DRY);
    stats[dir] = { added, enriched, count: w.count };

    if (added || enriched) changed = true;

    log(`  ${dir}`);
    log(`    yeni madde      : ${added.toLocaleString('tr-TR')}`);
    log(`    zenginleştirilen: ${enriched.toLocaleString('tr-TR')}`);
    log(`    toplam          : ${before.toLocaleString('tr-TR')} → ${w.count.toLocaleString('tr-TR')}`);
    log(`    parça ${(w.bytes / 1048576).toFixed(1)} MB, dizin ${(w.indexBytes / 1048576).toFixed(2)} MB\n`);

    manifest.dirs[dir].count = w.count;
    manifest.dirs[dir].letters = w.letters;
    manifest.dirs[dir].own = out[dir].length;
  }

  // `generated` yalnızca içerik gerçekten değiştiyse tazelenir.
  // Aksi hâlde her çalıştırma tüm istemcilerin önbelleğini geçersiz kılardı.
  if (changed) manifest.generated = new Date().toISOString();
  manifest.ownSource = 'Lumen (özgün)';
  manifest.ownLicense = 'CC0-1.0';

  if (DRY) {
    log('  --dry: hiçbir dosya yazılmadı\n');
    return;
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  log(`  manifest güncellendi${changed ? ' (generated tazelendi)' : ' (içerik değişmedi)'}`);

  const total = DIRS.reduce((n, d) => n + stats[d].count, 0);
  log(`\n  toplam madde: ${total.toLocaleString('tr-TR')}\n`);
}

main().catch((e) => {
  console.error('\nhata:', e.message);
  process.exit(1);
});
