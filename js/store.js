/**
 * store.js — kalıcı depolama katmanı (IndexedDB / idb-keyval)
 *
 * Üç ayrı store kullanılır:
 *   settings   : tema, dil yönü, son aramalar
 *   favorites  : favoriye eklenen kelimeler
 *   dict       : indirilen sözlük parçalarının önbelleği
 *
 * Sözlük parçaları ayrı tutulur çünkü önbellek temizlendiğinde
 * favorilerin ve ayarların silinmemesi gerekir.
 */

import { createStore, get, set, del, keys, clear } from '../vendor/idb-keyval.js';

/*
 * Her katman AYRI bir veritabanında tutulur.
 *
 * Neden: idb-keyval createStore(dbName, storeName) veritabanını tek sürümde
 * açar ve yalnızca kendisine verilen store'u yaratır. Aynı veritabanı adıyla
 * ikinci bir createStore çağrısı sürüm yükseltmesi tetiklemediği için o store
 * hiç oluşmaz ve işlem "object store was not found" hatası verir. Ayrı
 * veritabanları bu tuzağı tamamen ortadan kaldırır.
 *
 * Ayrıca önbellek temizlendiğinde favorilerin ve ayarların silinmemesi gerekir;
 * ayrı veritabanları bunu da garanti eder.
 */
const settings = createStore('lumen-settings', 'kv');
const favorites = createStore('lumen-favorites', 'kv');
const dict = createStore('lumen-dict', 'kv');
const audio = createStore('lumen-audio', 'kv');

/* ------------------------------------------------------------------ ayarlar */

const DEFAULTS = {
  theme: 'auto',        // 'auto' | 'light' | 'dark'
  direction: 'en-tr',   // 'en-tr' | 'tr-en'
  recent: [],           // son aramalar, en yeni başta, en fazla 8
};

export async function getSetting(key) {
  const v = await get(key, settings);
  return v === undefined ? DEFAULTS[key] : v;
}

export async function setSetting(key, value) {
  await set(key, value, settings);
  return value;
}

export async function getAllSettings() {
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    const v = await get(k, settings);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Son aramalara ekler; aynı kelime varsa başa taşır. */
export async function pushRecent(word) {
  const w = String(word || '').trim();
  if (!w) return [];
  const list = (await get('recent', settings)) || [];
  const next = [w, ...list.filter((x) => x !== w)].slice(0, 8);
  await set('recent', next, settings);
  return next;
}

/** Tek bir kelimeyi son aramalardan çıkarır. */
export async function removeRecent(word) {
  const w = String(word || '').trim();
  const list = (await get('recent', settings)) || [];
  const next = list.filter((x) => x !== w);
  await set('recent', next, settings);
  return next;
}

/** Son aramaları tümden siler. */
export async function clearRecent() {
  await set('recent', [], settings);
  return [];
}

/* ------------------------------------------------------------------ favoriler */

/**
 * Favori kaydı:
 *   { w, dir, pos, tr, at }
 * w + dir birlikte anahtardır — "bank" İngilizce ve Türkçe'de farklı kelimedir.
 */
export const favKey = (w, dir) => `${dir}:${w}`;

export async function listFavorites() {
  const all = (await keys(favorites)) || [];
  const rows = await Promise.all(all.map((k) => get(k, favorites)));
  return rows.filter(Boolean).sort((a, b) => (b.at || 0) - (a.at || 0));
}

export async function isFavorite(w, dir) {
  return (await get(favKey(w, dir), favorites)) !== undefined;
}

export async function addFavorite(entry) {
  await set(favKey(entry.w, entry.dir), { ...entry, at: Date.now() }, favorites);
}

export async function removeFavorite(w, dir) {
  await del(favKey(w, dir), favorites);
}

/** Ekliyse çıkarır, çıktıysa ekler. Yeni durumu döndürür. */
export async function toggleFavorite(entry) {
  const on = await isFavorite(entry.w, entry.dir);
  if (on) await removeFavorite(entry.w, entry.dir);
  else await addFavorite(entry);
  return !on;
}

export async function clearFavorites() {
  await clear(favorites);
}

/* --------------------------------------------------------- sözlük önbelleği */

/*
 * Parça anahtarı bir ETİKET taşır: `<etiket>:<yön>/<harf>`.
 *
 * Neden: sözlük verisi yeniden derlendiğinde (yeni kelimeler, düzeltilmiş
 * çeviriler) eski parçalar cihazda kalıyordu. Anahtar sabit olduğu için
 * uygulama IndexedDB'den eski kopyayı okuyup ağa hiç gitmiyordu — kullanıcı
 * yeni veriyi hiçbir zaman görmüyordu, "kelime hâlâ yok" şikâyeti buradan
 * geliyordu. Etiket manifest'in üretim zamanıdır; veri tazelenince anahtar
 * değişir, eski kayıtlar bir daha okunmaz ve arka planda silinir.
 *
 * Etiketsiz anahtarlar eski (v1) kayıtlardır; okunmaz, temizlikte silinir.
 */
export const chunkKey = (dir, part, tag) => (tag ? `${tag}:${dir}/${part}` : `${dir}/${part}`);

export async function getChunk(dir, part, tag) {
  return get(chunkKey(dir, part, tag), dict);
}

export async function putChunk(dir, part, data, tag) {
  await set(chunkKey(dir, part, tag), data, dict);
  return data;
}

export async function clearDictCache() {
  await clear(dict);
}

/** Önbellekteki parça sayısı — ayarlar ekranında gösterilir. */
export async function dictCacheSize() {
  const k = (await keys(dict)) || [];
  return k.length;
}

/**
 * Güncel etiketlere ait OLMAYAN parçaları siler.
 *
 * @param {string|string[]} keepTags geçerli sayılan etiketler
 * @returns {Promise<number>} silinen kayıt sayısı
 *
 * Yalnızca bu katmanın yönettiği anahtarlara dokunur: `d<sayı>:…` / `f<sayı>:…`
 * (etiketi parçalar) ve etiketsiz eski kayıtlar (`en-tr/index` gibi). Başka bir
 * amaçla yazılmış bir kayıt varsa korunur.
 */
export async function pruneDictCache(keepTags) {
  const keep = (Array.isArray(keepTags) ? keepTags : [keepTags]).filter(Boolean);
  if (!keep.length) return 0;

  const all = (await keys(dict)) || [];
  const stale = all.filter((k) => {
    const s = String(k);
    // Etiket "d20261016T164723828Z" gibidir — harf de içerir, yalnızca rakam değil.
    const managed = /^[a-z][0-9A-Za-z]+:/.test(s) || /^(en-tr|tr-en|freedict)\//.test(s);
    if (!managed) return false;
    return !keep.some((t) => s.startsWith(`${t}:`));
  });

  await Promise.all(stale.map((k) => del(k, dict)));
  return stale.length;
}

/* ------------------------------------------------- telaffuz kaydı önbelleği */

/*
 * Neden kalıcı önbellek gerekiyor:
 *   wiktionary-sound paketinin kendi önbelleği çalışmıyor (kaynak kodda `return`
 *   ifadesi setCached'ten önce geliyor, yazma kodu erişilemez). Ölçüm: ilk çağrı
 *   345 ms, ikinci çağrı yine 345 ms — her telaffuz tıklaması iki ağ turu demek.
 *   Ayrıca Wikimedia hız sınırı koyuyor (429). Bu yüzden bulunan ses adresi
 *   kalıcı olarak saklanır.
 */

export async function getAudio(key) {
  return get(key, audio);
}

export async function putAudio(key, value) {
  await set(key, value, audio);
  return value;
}

export async function clearAudio() {
  await clear(audio);
}

export async function audioCacheSize() {
  const k = (await keys(audio)) || [];
  return k.length;
}

export default {
  getSetting, setSetting, getAllSettings, pushRecent, removeRecent, clearRecent,
  listFavorites, isFavorite, addFavorite, removeFavorite, toggleFavorite, clearFavorites,
  getChunk, putChunk, clearDictCache, dictCacheSize, pruneDictCache, favKey,
  getAudio, putAudio, clearAudio, audioCacheSize,
};
