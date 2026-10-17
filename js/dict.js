/**
 * dict.js — sözlük verisi katmanı
 *
 * Neden iki katmanlı:
 *   Tam sözlük on binlerce madde ve onlarca megabayt. Tarayıcıya tek seferde
 *   indirilemez. Bu yüzden veri ikiye ayrılır:
 *
 *     index.json   : tüm kelimelerin kısa listesi (kelime, tür, ilk karşılık)
 *                    arama için bir kez indirilir
 *     <harf>.json  : o harfe ait tam maddeler; yalnızca açılan kelime için iner
 *
 *   İndirilen parçalar IndexedDB'ye yazılır, bir daha inmez. Böylece uygulama
 *   ilk kullanımdan sonra çevrimdışı da çalışır.
 *
 * Yol kuralı:
 *   Tüm yollar modül konumuna göre çözülür (import.meta.url). GitHub Pages'te
 *   site bir alt klasörde yayınlandığında da doğru çalışır.
 */

import { getChunk, putChunk, pruneDictCache } from './store.js';

const DATA = new URL('../data/', import.meta.url);

/** Türkçe harfleri ASCII'ye indirger — parça adlarıyla eşleşmek için. */
const TR_FOLD = { ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u' };

export function chunkOf(word) {
  const first = String(word || '').trim().charAt(0);
  if (!first) return '_';
  const folded = (TR_FOLD[first] || first).toLowerCase();
  return /[a-z]/.test(folded) ? folded : '_';
}

/* ------------------------------------------------------------------ getirme */

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) {
    const err = new Error(`Veri alınamadı (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/* ------------------------------------------------------------------ manifest */

let _manifest = null;

export async function loadManifest() {
  if (_manifest) return _manifest;
  _manifest = await fetchJson(new URL('manifest.json', DATA));
  return _manifest;
}

/* ------------------------------------------------------ önbellek etiketi */

/*
 * Cihazdaki parçalar manifest'in üretim zamanıyla etiketlenir.
 *
 * Neden gerekli: parçalar IndexedDB'de sabit anahtarla duruyordu. Veri yeniden
 * derlendiğinde (yeni kelimeler, düzeltilmiş çeviriler) uygulama ağa hiç
 * gitmiyor, eski kopyayı okuyordu — kullanıcı yeni maddeyi hiç görmüyordu.
 * Artık veri tazelenince etiket de değişir: eski parçalar okunmaz, yenisi iner.
 */
let _tag = null;

export async function dataTag() {
  if (_tag) return _tag;
  try {
    const m = await loadManifest();
    const g = String(m.generated || '');
    if (g) _tag = 'd' + g.replace(/[^0-9A-Za-z]/g, '');
  } catch { /* manifest yoksa etiketsiz devam — çevrimdışı ilk açılış */ }
  return _tag || 'd0';
}

let _pruned = false;

/** Eski etiketli parçaları bir kez, arka planda siler. */
async function pruneOnce() {
  if (_pruned) return;
  _pruned = true;
  try {
    const tags = [await dataTag(), await freeDictTag()];
    const n = await pruneDictCache(tags);
    if (n) console.info(`[lumen] ${n} eski sözlük parçası silindi`);
  } catch { /* temizlik başarısız olsa da arama çalışır */ }
}

/* ------------------------------------------------------- dizin (arama listesi) */

const _indexCache = new Map();   // dir -> { words: [...], built: bool }

/**
 * Arama dizinini yükler. Önbellekte varsa oradan, yoksa ağdan.
 * Dönen değer: [{ w, pos, tr }]
 */
export async function loadIndex(dir) {
  if (_indexCache.has(dir)) return _indexCache.get(dir);

  const tag = await dataTag();

  // 1) kalıcı önbellek (yalnızca güncel etiket)
  let rows = await getChunk(dir, 'index', tag);

  // 2) yoksa indir ve sakla
  if (!rows) {
    try {
      const raw = await fetchJson(new URL(`${dir}/index.json`, DATA));
      rows = raw;
      await putChunk(dir, 'index', rows, tag);
    } catch (e) {
      // ağ yok ve önbellek boş — kullanıcıya bildirilecek
      const err = new Error('Sözlük dizini yüklenemedi ve cihazda kopyası yok.');
      err.offline = true;
      err.cause = e;
      throw err;
    }
  }

  const out = rows.map((r) => (Array.isArray(r) ? { w: r[0], pos: r[1] || '', tr: r[2] || '' } : r));
  _indexCache.set(dir, out);
  pruneOnce();          // arka planda: eski etiketli / etiketsiz parçalar
  return out;
}

/* --------------------------------------------------------------- tam madde */

const _chunkCache = new Map();   // `${dir}/${letter}` -> Map(word -> entry)

/**
 * Bir harfin tam maddelerini yükler. Önce IndexedDB, sonra ağ.
 * Dönen değer: Map(word -> entry)
 */
export async function loadChunk(dir, letter) {
  const key = `${dir}/${letter}`;
  if (_chunkCache.has(key)) return _chunkCache.get(key);

  let rows = await getChunk(dir, letter, await dataTag());

  if (!rows) {
    const raw = await fetchJson(new URL(`${dir}/${letter}.json`, DATA));
    rows = raw;
    await putChunk(dir, letter, rows, await dataTag());
  }

  const map = new Map();
  for (const e of rows) {
    if (!e || !e.w) continue;
    // Aynı kelimenin farklı türleri ayrı kayıt olabilir; birleştir.
    //
    // DİKKAT: önce set edip sonra get etmek birleştirmeyi erişilemez kılar —
    // get her zaman az önce yazılan kaydı döndürür, yani `prev === e` olur ve
    // ikinci kayıt birincisini sessizce ezer. Önce bakılır, sonra yazılır.
    const prev = map.get(e.w);
    if (prev) mergeEntries(prev, e);
    else map.set(e.w, e);
  }
  _chunkCache.set(key, map);
  return map;
}

/** Aynı kelimenin iki kaydını tek maddede birleştirir. */
function mergeEntries(a, b) {
  for (const s of b.s || []) if (!a.s.some((x) => x.pos === s.pos && x.def === s.def)) a.s.push(s);
  for (const k of ['syn', 'ant', 'rel', 'der']) {
    if (b[k]) a[k] = [...new Set([...(a[k] || []), ...b[k]])];
  }
  if (!a.ipa && b.ipa) a.ipa = b.ipa;
  if (!a.aud && b.aud) a.aud = b.aud;
  if (!a.ety && b.ety) a.ety = b.ety;
  if (!a.syl && b.syl) a.syl = b.syl;
}

/* ------------------------------------------------- ikinci katman (FreeDict) */

/*
 * FreeDict eng-tur AYRI bir eserdir ve **GPL-2.0+** lisanslıdır
 * (bkz. data/freedict/LICENSE). Ana veri Wiktionary'den ve CC BY-SA 4.0.
 *
 * İkisi HİÇBİR dosyada birleştirilmez. Bir araya gelmeleri yalnızca burada,
 * çalışma anında, bellekte olur — GPLv2 §2'deki "mere aggregation" hükmü
 * tam olarak bunu kapsar: ayrı eserlerin aynı ortamda bulunması diğerini
 * kendi lisansına çekmez.
 *
 * Katman tembel yüklenir: yalnızca bir maddenin hiç Türkçe karşılığı yoksa
 * ya da madde ana sözlükte hiç yoksa indirilir.
 */
const FREEDICT = new URL('../data/freedict/', import.meta.url);
const _fdCache = new Map();     // harf -> nesne | null

/* FreeDict parçaları da kendi manifest'inin üretim zamanıyla etiketlenir. */
let _fdTag = null;

async function freeDictTag() {
  if (_fdTag) return _fdTag;
  try {
    const res = await fetch(new URL('manifest.json', FREEDICT), { cache: 'no-cache' });
    if (res.ok) {
      const g = String((await res.json()).generated || '');
      if (g) _fdTag = 'f' + g.replace(/[^0-9A-Za-z]/g, '');
    }
  } catch { /* manifest yoksa etiketsiz devam */ }
  return _fdTag || 'f0';
}

async function loadFreeDict(letter) {
  if (_fdCache.has(letter)) return _fdCache.get(letter);

  const tag = await freeDictTag();
  let obj = await getChunk('freedict', letter, tag);

  if (!obj) {
    try {
      const res = await fetch(new URL(`${letter}.json`, FREEDICT), { cache: 'no-cache' });
      if (!res.ok) { _fdCache.set(letter, null); return null; }
      obj = await res.json();
      await putChunk('freedict', letter, obj, tag);
    } catch {
      _fdCache.set(letter, null);
      return null;
    }
  }

  _fdCache.set(letter, obj);
  return obj;
}

/** FreeDict'teki Türkçe karşılıklar; yoksa null. */
async function freeDictTr(w) {
  const obj = await loadFreeDict(chunkOf(w));
  if (!obj) return null;
  const hit = obj[w.toLowerCase()];
  return hit && hit.length ? hit : null;
}

/**
 * Maddenin hiç Türkçe karşılığı yoksa FreeDict katmanından ekler.
 *
 * Madde zaten Türkçe taşıyorsa DOKUNULMAZ: FreeDict çevirilerinin anlam
 * etiketi yok, var olan bir maddenin altına dizilirlerse yanlış tanımın
 * altına düşerler. Yalnızca boşluğu doldururlar.
 */
async function withFreeDict(e) {
  if ((e.s || []).some((s) => s.tr && s.tr.length)) return e;
  const tr = await freeDictTr(e.w);
  return tr ? { ...e, wtr: tr } : e;
}

/* ------------------------------------------------------------------ arama */

/**
 * İngilizce çekim eklerini soyarak olası gövdeyi (lemma) üretir.
 *
 * Neden gerekli: Wiktionary madde başlarını (lemma) taşır; çekimli biçimlerin
 * çoğu ya hiç madde değildir ya da çevirisizdir. Ölçüm — ilk 10.000 sıklıkta
 * eksik olan 5.175 kelimenin 2.157'si çekimli biçim:
 *   books→book, years→year, items→item, systems→system, made→make,
 *   said→say, using→use, pages→page, prices→price, women→woman.
 * Bu adım kapsamı %48,3'ten %69,8'e çıkarıyor (ilk 10.000 sıklık).
 *
 * Sıra önemli: uzun ekler önce denenir, yoksa "boxes" için "-s" kuralı
 * "boxe" üretir ve doğru gövde ("box") hiç denenmez.
 */
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

  // çift ünsüz kırpma: running → run, planned → plan
  const dbl = low.match(/^(.*?)([bcdfglmnprt])\2(ed|ing)$/);
  if (dbl) push(w.slice(0, dbl[1].length) + dbl[2]);

  return out;
}

/** Bir harf parçasında birebir, olmazsa harf duyarsız arama. */
function findIn(map, w) {
  if (map.has(w)) return map.get(w);
  const lower = w.toLocaleLowerCase('tr');
  for (const [k, v] of map) {
    if (k.toLocaleLowerCase('tr') === lower) return v;
  }
  return null;
}

/** Kelimeyi doğru harf parçasından getirir. */
async function findWord(dir, w) {
  const map = await loadChunk(dir, chunkOf(w));
  return findIn(map, w);
}

/**
 * Tek bir kelimeyi getirir.
 *
 * Çekimli biçim bulunamazsa gövdeye düşülür ve dönen kayda `via: 'stem'`
 * ile `lemma` eklenir. Bu işaret arayüzde gösterilir: kullanıcı "books"
 * aradığında "book" maddesini gördüğünü bilmeli, aksi hâlde çekimli biçimin
 * kendi maddesi varmış gibi görünür.
 *
 * @returns {Promise<object|null>}
 */
export async function lookup(word, dir) {
  const w = String(word || '').trim();
  if (!w) return null;

  const direct = await findWord(dir, w);
  if (direct) return dir === 'en-tr' ? withFreeDict(direct) : direct;

  if (dir === 'en-tr') {
    for (const stem of enStems(w)) {
      const hit = await findWord(dir, stem);
      if (hit) return withFreeDict({ ...hit, via: 'stem', lemma: hit.w });
    }

    // Ana sözlükte hiç yok. Yalnızca FreeDict'te olabilir — o durumda
    // yalnızca karşılıkları gösterilir (tanım, örnek, IPA yoktur).
    const tr = await freeDictTr(w);
    if (tr) return { w, pos: '', s: [], wtr: tr, via: 'freedict' };
    return null;
  }

  // TR → EN: Türkçe çekim eki fazlalığı için kısaltarak dene (en fazla 3 harf)
  for (let cut = 1; cut <= 3 && w.length - cut > 2; cut++) {
    const hit = await findWord(dir, w.slice(0, -cut));
    if (hit) return { ...hit, via: 'stem', lemma: hit.w };
  }
  return null;
}

/* ------------------------------------------------------------------ yardımcı */

/** Belirli bir yön için kaç kelime var. */
export async function wordCount(dir) {
  try {
    const m = await loadManifest();
    return m?.dirs?.[dir]?.count ?? 0;
  } catch {
    return 0;
  }
}

/** Önbelleği boşaltır (ayarlar ekranından çağrılır). */
export function resetMemoryCache() {
  _indexCache.clear();
  _chunkCache.clear();
  _fdCache.clear();
  _manifest = null;
  _tag = null;
  _fdTag = null;
  _pruned = false;
}

export default { loadManifest, loadIndex, loadChunk, lookup, chunkOf, wordCount, dataTag, resetMemoryCache };
