/**
 * speech.js — telaffuz katmanı
 *
 * AKIŞ (sıralı, sessiz yedek YOK):
 *   1. Wikimedia ses kaydı (wiktionary-sound ile bulunur)
 *   2. Tarayıcının konuşma sentezi (Web Speech API)
 *   3. Hata — kullanıcıya ne olduğu ve ne yapabileceği söylenir
 *
 * Kural: bir yöntem çalışmazsa sessizce sonrakine geçilmez; geçildiği
 * kullanıcıya bildirilir. Hata mesajları teknik değil, insan dilindedir.
 *
 * ---------------------------------------------------------------------------
 * Spesifikasyondaki telaffuz kodu dört yerden kırıktı; burada düzeltildi:
 *
 *  1. İmza hatası. Paket getSound(word, options) bekler; spesifikasyon
 *     getSound(word, "en") çağırıyor. String üzerinde .language undefined olur
 *     ve varsayılan "en" devreye girer — İngilizce'de kazara çalışır, başka
 *     dilde bozulur. Doğrusu: getSound(word, { language: 'en' })
 *
 *  2. Ölü hata dalı. Paket "kayıt bulunamadı" durumunda null dönmez, İSTİSNA
 *     ATAR — üstelik anlamsız bir istisna: "Cannot read properties of undefined
 *     (reading 'pages')". Spesifikasyondaki `else` dalı hiç çalışmaz; kullanıcı
 *     ham TypeError görür. Burada istisnalar insan diline çevrilir.
 *
 *  3. Çalışmayan önbellek. Paketin cache'i erişilemez kod (return, setCached'ten
 *     önce). Ölçüm: iki ardışık çağrı da 345 ms. Burada sonuç IndexedDB'ye yazılır.
 *
 *  4. Rastgele aksan ve format. Paketin seçicisi ogg'a +20 puan verir ve
 *     eşitlikte dizi sırasına düşer — "hello" için Avustralya aksanı dönebilir.
 *     Ayrıca iOS Safari Ogg Vorbis çalamaz. Burada aksan US'e sabitlenir ve
 *     Safari'de Wikimedia'nın mp3 dönüşümü kullanılır.
 * ---------------------------------------------------------------------------
 */

import { getSound } from '../vendor/wiktionary-sound/index.js';
import { getAudio, putAudio } from './store.js';

/* ----------------------------------------------------------------- algılama */

const UA = navigator.userAgent;

/** iOS Safari ve masaüstü Safari Ogg Vorbis çalamaz. */
export const IS_SAFARI = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(UA);

/** Tarayıcı konuşma sentezini destekliyor mu. */
export const CAN_SPEAK = typeof window !== 'undefined' && 'speechSynthesis' in window;

/* ------------------------------------------------------------------ yardımcı */

/** Wikimedia dosya adından mp3 dönüşüm adresini türetir. */
function mp3From(url) {
  const m = String(url).match(
    /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f])\/([0-9a-f]{2})\/(.+)$/i
  );
  if (!m) return null;
  const [, base, a, ab, file] = m;
  return `${base}/transcoded/${a}/${ab}/${file}/${file}.mp3`;
}

/** Paketin döndürdüğü dosya listesinden en uygununu seçer. */
function pickFile(files) {
  const usable = (files || []).filter((f) => f && f.url);
  if (!usable.length) return null;

  const score = (f) => {
    let p = 0;
    // Amerikan aksanı tercih edilir — Türk kullanıcı için en yaygın öğrenilen aksan
    if (f.accent === 'us') p += 300;
    else if (f.accent === 'uk') p += 120;
    // Toplu (LL-Q) kayıtlar yerine yerel Wiktionary kayıtları
    if (!String(f.title || '').toLowerCase().includes('ll-q')) p += 60;
    // Kısa dosya adları genelde daha temiz kayıtlar
    if (String(f.title || '').length < 30) p += 10;
    return p;
  };

  return [...usable].sort((a, b) => score(b) - score(a))[0];
}

/**
 * Sözlük maddesinin kendi taşıdığı ses adreslerini sıralar.
 * Kaikki verisi mp3_url ve ogg_url alanlarını zaten içerdiği için bu durumda
 * ağ üzerinden kayıt aramaya hiç gerek kalmaz.
 */
function orderOwnAudio(list) {
  const usable = (list || []).filter((a) => a && a.u);
  if (!usable.length) return [];

  const rank = (a) => {
    const tags = (a.t || []).map((x) => String(x).toLowerCase());
    const url = String(a.u || '');
    const isMp3 = /\.mp3$/i.test(url);
    let p = 0;
    if (tags.includes('us')) p += 300;
    else if (tags.includes('uk')) p += 120;
    if (tags.includes('general american')) p += 60;
    // Toplu (LL-Q) kayıtlar yerine Wiktionary'nin kendi kayıtları.
    // pickFile() ile aynı kural — iki yol ayrışırsa aynı kelime için
    // madde içinden ve ağdan farklı bir kayıt seçilir.
    if (!/ll-q/i.test(url)) p += 60;
    // Safari ogg çalamaz
    if (IS_SAFARI) p += isMp3 ? 200 : -200;
    else p += isMp3 ? 0 : 40;
    return p;
  };

  return [...usable].sort((a, b) => rank(b) - rank(a)).map((a) => a.u);
}

/** Ham hatayı kullanıcıya gösterilecek mesaja çevirir. */
function humanize(err, word) {
  const msg = String((err && err.message) || err || '');

  if (/Cannot read propert|undefined|not a function/i.test(msg)) {
    return { kind: 'notfound', text: `"${word}" için Wiktionary'de kayıt bulunamadı.` };
  }
  if (/No pronunciation found|No downloadable audio/i.test(msg)) {
    return { kind: 'notfound', text: `Bu kelime için telaffuz kaydı yok.` };
  }
  if (/429|too many/i.test(msg)) {
    return { kind: 'rate', text: 'Ses arşivi şu an istek kabul etmiyor. Birkaç saniye sonra tekrar dene.' };
  }
  if (/Wikimedia error: 5\d\d/i.test(msg)) {
    return { kind: 'server', text: 'Ses arşivi yanıt vermiyor. Sonra tekrar dene.' };
  }
  if (/Failed to fetch|NetworkError|ERR_/i.test(msg)) {
    return { kind: 'network', text: 'Ses kaydına ulaşılamadı. Bağlantını kontrol et.' };
  }
  return { kind: 'unknown', text: 'Telaffuz alınamadı.' };
}

/* -------------------------------------------------------- 1. ses kaydını bul */

/**
 * Kelimenin Wikimedia ses kaydını bulur. Önce cihazdaki önbelleğe bakar.
 * @returns {Promise<{url, alt, accent, title, cached}|null>}
 */
export async function resolveAudio(word, lang = 'en') {
  const key = `${lang}:${word}`;

  const hit = await getAudio(key);
  if (hit) return { ...hit, cached: true };

  const result = await getSound(word, { language: lang, preferredAccent: 'us' });
  const best = pickFile(result && result.files);
  if (!best) {
    const e = new Error('No downloadable audio');
    e.notFound = true;
    throw e;
  }

  const mp3 = mp3From(best.url);
  // Safari'de ogg çalınamaz; mp3 varsa doğrudan onu kullan.
  const primary = IS_SAFARI && mp3 ? mp3 : best.url;
  const alt = IS_SAFARI ? best.url : mp3;

  const rec = {
    url: primary,
    alt: alt && alt !== primary ? alt : null,
    accent: best.accent || null,
    title: best.title || '',
  };

  await putAudio(key, rec);
  return { ...rec, cached: false };
}

/* ----------------------------------------------------------- 2. sesi çalma */

let player = null;

function getPlayer() {
  if (!player) {
    player = new Audio();
    player.preload = 'auto';
  }
  return player;
}

/** Bir adresi çalmayı dener. Başarılıysa çözülür, olmazsa reddeder. */
function playUrl(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const el = getPlayer();
    let done = false;

    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('error', onError);
      fn(arg);
    };

    const onPlaying = () => finish(resolve);
    const onError = () => finish(reject, new Error('Bu ses dosyası çalınamadı.'));

    const timer = setTimeout(() => {
      try { el.pause(); } catch { /* yok say */ }
      finish(reject, new Error('Ses zaman aşımına uğradı.'));
    }, timeoutMs);

    el.addEventListener('playing', onPlaying);
    el.addEventListener('error', onError);
    el.src = url;

    const p = el.play();
    if (p && typeof p.catch === 'function') {
      p.catch((e) => finish(reject, new Error(e && e.name === 'NotAllowedError'
        ? 'Tarayıcı sesi başlatmadı. Düğmeye tekrar dokun.'
        : 'Ses çalınamadı.')));
    }
  });
}

/** Çalmayı durdurur. */
export function stop() {
  if (player) {
    try { player.pause(); player.currentTime = 0; } catch { /* yok say */ }
  }
  if (CAN_SPEAK) {
    try { speechSynthesis.cancel(); } catch { /* yok say */ }
  }
}

/* ------------------------------------------------- 3. konuşma sentezi yedeği */

let voicesReady = null;

/** Ses listesinin yüklenmesini bekler (getVoices asenkron doldurulur). */
function waitVoices(timeoutMs = 1200) {
  if (!CAN_SPEAK) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  if (voicesReady) return voicesReady;

  voicesReady = new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      speechSynthesis.removeEventListener('voiceschanged', done);
      resolve(speechSynthesis.getVoices());
    };
    speechSynthesis.addEventListener('voiceschanged', done);
    setTimeout(done, timeoutMs);
  });
  return voicesReady;
}

/**
 * Web Speech API ile okur.
 * DİKKAT: speechSynthesis.speak() çağrısı bir kullanıcı etkileşiminden sonra
 * yapılmalıdır. Bu yüzden bu fonksiyon doğrudan tıklama işleyicisinden çağrılır.
 */
export async function speak(word, lang = 'en') {
  if (!CAN_SPEAK) {
    return { ok: false, kind: 'unsupported', text: 'Tarayıcın sesli okumayı desteklemiyor.' };
  }

  const tag = lang === 'tr' ? 'tr-TR' : 'en-US';
  const voices = await waitVoices();
  const hasVoice = voices.some((v) => String(v.lang || '').toLowerCase().startsWith(tag.slice(0, 2)));

  if (!hasVoice) {
    return {
      ok: false,
      kind: 'novoice',
      text: `Tarayıcında ${tag} ses paketi kurulu değil. İşletim sisteminin konuşma ayarlarından ekleyebilirsin.`,
    };
  }

  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = tag;
    u.rate = 0.9;
    u.pitch = 1;

    const voice = voices.find((v) => String(v.lang || '').toLowerCase().startsWith(tag.slice(0, 2)));
    if (voice) u.voice = voice;

    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    u.onend = () => finish({ ok: true });
    u.onerror = (e) => {
      const map = {
        'not-allowed': 'Tarayıcı sesli okumaya izin vermedi. Düğmeye tekrar dokun.',
        'audio-busy': 'Ses çıkışı başka bir uygulama tarafından kullanılıyor.',
        interrupted: 'Sesli okuma kesildi.',
        'text-too-long': 'Metin sesli okumak için çok uzun.',
        synthesis: 'Sesli okuma başarısız oldu.',
      };
      finish({ ok: false, kind: e.error || 'error', text: map[e.error] || 'Sesli okuma başarısız oldu.' });
    };

    const timer = setTimeout(() => {
      try { speechSynthesis.cancel(); } catch { /* yok say */ }
      finish({ ok: false, kind: 'timeout', text: 'Sesli okuma başlamadı. Düğmeye tekrar dokun.' });
    }, 3000);

    try {
      speechSynthesis.speak(u);
    } catch {
      finish({ ok: false, kind: 'error', text: 'Sesli okuma başlatılamadı.' });
    }
  });
}

/* ------------------------------------------------------------- ana akış */

/**
 * Telaffuz eder. Sırayla dener, her adımı kullanıcıya bildirir.
 *
 * @param {string} word
 * @param {string} lang  'en' | 'tr'
 * @param {(stage:string)=>void} [onStage]  ara durum bildirimi
 * @param {Array} [ownAudio]  maddenin kendi ses adresleri: [{u, t}]
 * @returns {Promise<{ok:boolean, source?:string, text?:string, kind?:string, word:string}>}
 */
export async function say(word, lang = 'en', onStage = () => {}, ownAudio = null) {
  stop();

  /* --- Adım 1: ses kaydı --- */
  onStage('loading');
  let audioErr = null;

  // 1a. Maddenin kendi adresleri varsa doğrudan onları dene (ağ araması yok)
  const own = orderOwnAudio(ownAudio);
  for (const url of own) {
    try {
      await playUrl(url);
      onStage('playing');
      return { ok: true, source: 'wikimedia', word };
    } catch (e) {
      audioErr = e;
    }
  }

  // 1b. Yoksa Wikimedia'da ara
  if (!own.length) {
    let audio = null;
    try {
      audio = await resolveAudio(word, lang);
    } catch (e) {
      audioErr = e;
    }
    if (audio) {
      try {
        await playUrl(audio.url);
        onStage('playing');
        return { ok: true, source: 'wikimedia', accent: audio.accent, word };
      } catch (first) {
        if (audio.alt) {
          try {
            await playUrl(audio.alt);
            onStage('playing');
            return { ok: true, source: 'wikimedia', accent: audio.accent, word };
          } catch { /* aşağıya düş */ }
        }
        audioErr = first;
      }
    }
  }

  /* --- Adım 2: konuşma sentezi --- */
  onStage('fallback');
  const spoken = await speak(word, lang);
  if (spoken.ok) {
    return { ok: true, source: 'webspeech', word };
  }

  /* --- Adım 3: hata --- */
  const base = audioErr ? humanize(audioErr, word) : { kind: 'notfound', text: 'Telaffuz kaydı bulunamadı.' };
  const text = audioErr ? base.text : spoken.text;

  return { ok: false, kind: base.kind, text, word };
}

/* ------------------------------------------------------- harici sözlük linki */

/** Hata durumunda gösterilen "harici sözlükte aç" bağlantısı. */
export function externalUrl(word, lang = 'en') {
  const w = encodeURIComponent(word);
  return lang === 'tr'
    ? `https://tr.wiktionary.org/wiki/${w}`
    : `https://en.wiktionary.org/wiki/${w}`;
}

export default { say, speak, stop, resolveAudio, externalUrl, IS_SAFARI, CAN_SPEAK };
