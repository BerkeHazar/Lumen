/**
 * app.js — Lumen'ın çekirdeği: yönlendirme, görünümler, olaylar.
 *
 * Arama bir komut paleti değil, her zaman ekranda duran bir alandır.
 * Sözlükte iş "yaz ve oku"dur; palet akışı araya iki adım daha koyar.
 *
 * Yönlendirme: hash tabanlı.
 *   #/                 arama
 *   #/w/<kelime>       madde
 *   #/favorites        favoriler
 *   #/settings         ayarlar
 */

import { icon, equalizer, logoMark } from './icons.js';
import * as store from './store.js';
import * as dict from './dict.js';
import * as search from './search.js';
import * as speech from './speech.js';

/* ------------------------------------------------------------------ durum */

const S = {
  route: { name: 'search', word: null },
  direction: 'en-tr',
  theme: 'auto',
  query: '',
  results: [],
  cursor: -1,
  entry: null,
  loading: false,
  favorites: [],
  favoritesQuery: '',
  recent: [],          // son aranan kelimeler (en yeni başta, en fazla 8)
  notice: null,
  speaking: null,      // şu an seslendirilen kelime
  sayStage: null,      // 'loading' | 'playing' | 'fallback'
};

/* ---------------------------------------------------------------- yardımcı */

/** Sekme başlığı. Madde açıkken kelime adıyla değiştirilir, dönüşte geri gelir. */
const TITLE = 'Lumen — Türkçe İngilizce sözlük';

/** HTML kaçışı. Sözlük verisi dış kaynaktan gelir; kaçış zorunlu. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Arama sonucunda eşleşen parçayı işaretler.
 *
 * DİKKAT — burada bir tuzak var: eşleşme indeksi HAM kelime üzerinde
 * hesaplanır, ama dilimleme KAÇIRILMIŞ dize üzerinde yapılırsa indeksler
 * kayar. esc() tek karakteri birden fazla karaktere çevirebilir
 * (' → &#39;, & → &amp;). Ölçülen sonuç: "Alzheimer's disease" içinde
 * "disease" arandığında ekranda "Alzheimer9;s disease" görünüyordu; yani
 * hem vurgu yanlış yere düşüyor hem HTML bozuluyordu. Sözlükte bu
 * karakterleri taşıyan 342 İngilizce + 122 Türkçe madde başı var.
 *
 * Doğrusu: indekse göre HAM dizeyi dilimle, kaçışı her parçaya ayrı uygula.
 */
function mark(word, query) {
  const raw = String(word == null ? '' : word);
  const q = String(query || '').trim();
  if (!q) return esc(raw);

  const fw = search.fold(raw);
  const fq = search.fold(q);
  const i = fw.indexOf(fq);

  // Katlama uzunluğu korumuyorsa indeks birebir değildir; vurgu yapma.
  // (Beklenmeyen bir durum ama sessizce yanlış vurgu üretmektense hiç üretmemek iyi.)
  if (i < 0 || fw.length !== raw.length || fq.length !== q.length) return esc(raw);

  return esc(raw.slice(0, i))
    + `<mark>${esc(raw.slice(i, i + q.length))}</mark>`
    + esc(raw.slice(i + q.length));
}

const POS_TR = {
  noun: 'isim', verb: 'fiil', adj: 'sıfat', adv: 'zarf', prep: 'edat',
  conj: 'bağlaç', pron: 'zamir', interj: 'ünlem', num: 'sayı', det: 'belirteç',
  particle: 'ilgeç', phrase: 'deyim', abbrev: 'kısaltma', name: 'özel ad', prop: 'özel ad',
};
const posTr = (p) => POS_TR[String(p || '').toLowerCase()] || p || '';

/**
 * Bulunamayan kelime için dış sözlük bağlantıları.
 *
 * Sözlüğün sınırı kaynağıdır: Wiktionary'nin İngilizce maddelerinde Türkçe
 * çeviri çoğu zaman yoktur (`extreme`, `extravagant`, `explicit`). Bu kelimeler
 * uydurulamaz, ama kullanıcıyı boş ekranda bırakmak da doğru değil.
 */
function outsideLinks(word, dir) {
  const lang = dir === 'en-tr' ? 'en' : 'tr';
  const tureng = dir === 'en-tr'
    ? `https://tureng.com/tr/turkce-ingilizce/${encodeURIComponent(word)}`
    : `https://tureng.com/tr/ingilizce-turkce/${encodeURIComponent(word)}`;
  return `<p class="outside">
    <a class="textbtn" href="${esc(speech.externalUrl(word, lang))}"
       target="_blank" rel="noopener">Wiktionary'de aç</a>
    <a class="textbtn" href="${esc(tureng)}"
       target="_blank" rel="noopener">Tureng'de ara</a>
  </p>`;
}

/* -------------------------------------------------------------------- tema */

function applyTheme() {
  const t = S.theme === 'auto'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : S.theme;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', t === 'dark' ? '#101010' : '#FBFBF9');
  // index.html ilk boyamadan önce buradan okur (IndexedDB senkron okunamaz)
  try { localStorage.setItem('lumen.theme', S.theme); } catch { /* yok say */ }
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (S.theme === 'auto') applyTheme();
});

/* ------------------------------------------------------------------ bildirim */

let toastTimer = null;

function toast(text, kind = 'error', word = null) {
  const host = document.getElementById('toast');
  if (!host) return;
  const retry = kind === 'error' && word
    ? `<div class="acts">
         <button class="textbtn" data-act="retry" data-word="${esc(word)}">Tekrar dene</button>
         <a class="textbtn" href="${esc(speech.externalUrl(word, S.direction === 'tr-en' ? 'tr' : 'en'))}"
            target="_blank" rel="noopener">Harici sözlükte aç</a>
       </div>`
    : '';
  host.innerHTML = `
    <div class="notice ${kind === 'error' ? 'error' : ''}" role="alert">
      ${icon(kind === 'error' ? 'alert' : 'speaker', { size: 18 })}
      <div class="t">${esc(text)}${retry}</div>
    </div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { host.innerHTML = ''; }, 8000);
}

function clearToast() {
  const host = document.getElementById('toast');
  if (host) host.innerHTML = '';
  clearTimeout(toastTimer);
}

/* --------------------------------------------------------------- görünümler */

function viewSearch() {
  const q = S.query;
  const dirLabel = S.direction === 'en-tr' ? 'İngilizce' : 'Türkçe';

  let body = '';

  if (S.loading) {
    body = `<div class="sk" aria-hidden="true">
      <div class="ln"></div><div class="ln"></div><div class="ln"></div><div class="ln"></div>
    </div>`;
  } else if (!q) {
    const recent = S.recent || [];
    const n = search.size ? search.size() : 0;
    // Dizin hazır değilken rastgele seçim yapılamaz — düğme o zaman gizlenir.
    const randomBtn = n
      ? `<button class="textbtn" data-act="random">Rastgele bir kelime <span aria-hidden="true">→</span></button>`
      : '';

    if (recent.length) {
      // Silme düğmesi açma düğmesinin İÇİNE konamaz (iç içe button geçersiz HTML),
      // bu yüzden satır iki kardeş düğmeden oluşur.
      body = `<ul class="results">
          ${recent.map((w) => `
            <li class="recent">
              <button class="result" data-open="${esc(w)}">
                ${icon('clock', { size: 17 })}
                <span class="w">${esc(w)}</span>
              </button>
              <button class="recent-del" data-act="delrecent" data-word="${esc(w)}"
                      aria-label="${esc(w)} kelimesini geçmişten sil"
                      title="Geçmişten sil">
                ${icon('close', { size: 16 })}
              </button>
            </li>`).join('')}
        </ul>
        ${randomBtn ? `<div class="home-more">${randomBtn}</div>` : ''}`;
    } else {
      /*
       * İlk açılış.
       *
       * Önceden burada "İngilizce sözlük hazır" yazıyordu — bir durum bildirimi.
       * Kullanıcıya ne bulacağını söylemiyor, boş ekranı da doldurmuyordu.
       * Yerine sözlüğün ölçeği (madde sayısı) ve tek bir çıkış yolu kondu:
       * rastgele kelime. Sayı, madde başlıklarıyla aynı serif ailede ve büyük —
       * ana ekranın "kelimesi" o.
       */
      body = `<div class="home">
          ${n ? `<h3 class="home-count">${n.toLocaleString('tr-TR')}</h3>
                 <p class="home-sub">${esc(dirLabel)} madde · çevrimdışı çalışır</p>` : ''}
          ${randomBtn ? `<div class="home-random">${randomBtn}</div>` : ''}
        </div>`;
    }
  } else if (!S.results.length) {
    body = `<div class="empty">
      ${icon('search', { size: 34 })}
      <h3>Sonuç yok</h3>
      <p>"${esc(q)}" için ${esc(dirLabel.toLocaleLowerCase('tr'))} sözlükte karşılık bulunamadı.</p>
      ${outsideLinks(q, S.direction)}
    </div>
    <div id="suggest"></div>`;
  } else {
    body = `<ul class="results" role="listbox" aria-label="Arama sonuçları">
      ${S.results.map((r, i) => `
        <li><button class="result" role="option" aria-selected="${i === S.cursor}"
              data-open="${esc(r.w)}" data-idx="${i}">
          <span class="w">${mark(r.w, q)}</span>
          <span class="pos">${esc(posTr(r.pos))}</span>
          <span class="tr">${esc(r.tr)}</span>
        </button></li>`).join('')}
    </ul>`;
  }

  return `
    <div class="field">
      ${icon('search', { size: 21 })}
      <input id="q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false"
             enterkeyhint="search" aria-label="Kelime ara"
             placeholder="${esc(dirLabel)} ara"
             value="${esc(q)}">
      ${q ? `<span class="count">${S.results.length} sonuç</span>` : ''}
      <button class="ibtn" data-act="clear" aria-label="Aramayı temizle"
              style="${q ? '' : 'visibility:hidden'}">${icon('close', { size: 17 })}</button>
    </div>
    ${body}`;
}

function viewEntry() {
  const e = S.entry;

  if (S.loading) {
    return `<div class="sk" aria-hidden="true">
      <div class="ln"></div><div class="ln"></div><div class="ln"></div><div class="ln"></div>
    </div>`;
  }

  if (!e) {
    return `<div class="empty">
      ${icon('search', { size: 34 })}
      <h3>Kelime bulunamadı</h3>
      <p>Bu madde sözlükte yok. Yazımı kontrol edebilir ya da aramaya dönebilirsin.</p>
      ${outsideLinks(S.route.word || '', S.direction)}
    </div>`;
  }

  const lang = S.direction === 'en-tr' ? 'en' : 'tr';
  const fav = S.favorites.some((f) => f.w === e.w && f.dir === S.direction);
  const busy = S.speaking === e.w;

  /* başlık ve telaffuz */
  const ipa = (e.ipa || [])[0];
  const syl = (e.syl || []).join('·');
  const hasAudio = (e.aud || []).length > 0 || speech.CAN_SPEAK;

  const sayBtn = hasAudio ? `
    <button class="say" data-act="say" data-word="${esc(e.w)}"
            data-state="${busy ? (S.sayStage || 'loading') : 'idle'}"
            aria-label="Telaffuz et">
      ${busy && S.sayStage === 'playing'
        ? equalizer({ size: 16 })
        : icon('speaker', { size: 16 })}
      <span>${busy && S.sayStage === 'playing' ? 'Çalıyor' : 'Dinle'}</span>
    </button>` : '';

  const meta = `
    <div class="entry-meta">
      ${ipa && ipa.v ? `<span class="ipa">/${esc(ipa.v)}/</span>` : ''}
      ${syl ? `<span class="syl">${esc(syl)}</span>` : ''}
      ${sayBtn}
      <span class="entry-actions">
        <button class="ibtn" data-act="fav" data-word="${esc(e.w)}"
                aria-pressed="${fav}" aria-label="${fav ? 'Favoriden çıkar' : 'Favoriye ekle'}">
          ${icon(fav ? 'bookmarkFilled' : 'bookmark', { size: 18 })}
        </button>
      </span>
    </div>`;

  /* anlamlar */
  const senses = (e.s || []).map((s) => {
    const tr = (s.tr || []).length ? `<span class="tr">${esc(s.tr.join(', '))}.</span> ` : '';
    // TR -> EN maddelerinde tanım yoktur; İngilizce karşılığın tanımı `en` alanındadır.
    // Bu tanım, hangi İngilizce kelimenin doğru olduğunu netleştirdiği için gösterilir.
    const def = s.def || (s.en && s.en[0]) || '';
    const ex = (s.ex || [])[0];
    return `
      <li class="sense">
        <span class="k">${esc(posTr(s.pos))}</span>
        <span class="d">
          ${def ? esc(def) + ' ' : ''}${tr}
          ${ex ? `<span class="ex">${esc(ex)}</span>` : ''}
        </span>
      </li>`;
  }).join('');

  /* ilişkiler */
  const relBlock = (title, list) => (list && list.length)
    ? `<div class="rel">
         <h3>${title}</h3>
         <div class="words">${list.map((w) => `<button data-open="${esc(w)}">${esc(w)}</button>`).join('')}</div>
       </div>`
    : '';

  const rels =
    relBlock('Eş anlamlı', e.syn) +
    relBlock('Zıt anlamlı', e.ant) +
    relBlock('İlgili', e.rel) +
    relBlock('Türev', e.der);

  const ety = e.ety
    ? `<div class="ety"><h3>Etimoloji</h3><p>${esc(e.ety)}</p></div>`
    : '';

  /*
   * Çekimli biçim uyarısı. Kullanıcı "books" aradığında "book" maddesi
   * açılır; bunun söylenmesi gerekir, yoksa çekimli biçimin kendi maddesi
   * varmış gibi görünür.
   */
  const stemNote = e.via === 'stem' && e.lemma
    ? `<p class="stemnote">"${esc(S.route.word || '')}" çekimli biçim —
         <b>${esc(e.lemma)}</b> maddesi gösteriliyor.</p>`
    : '';

  /*
   * Madde düzeyinde çeviriler.
   *
   * Bu çevirilerin kaynağında ANLAM ETİKETİ YOK — hangi tanıma ait oldukları
   * bilinmiyor. Bu yüzden ilk anlama yığılmazlar (o zaman yanlış tanımın
   * altında doğru karşılık görünürdü); ayrı ve açıkça etiketli bir blok olarak
   * verilirler. Blok başlığı, bunların kelime düzeyinde karşılıklar olduğunu
   * söyler.
   *
   * Tanım da varsa ayrıca kaynak notu düşülür: ikinci kaynak (FreeDict) yalnızca
   * kendi kapsadığı anlamları çevirir. Ölçüm: "articulate" maddesinde yalnızca
   * fiil/teknik anlamlar var ("mafsal ile birleştirmek"), sıfatın C1 anlamı
   * ("akıcı, düzgün konuşan") hiç yok. Not olmadan bu, sözlüğün hatası gibi
   * görünüyordu.
   */
  const wordTr = (e.wtr || []).length
    ? `<div class="rel wtr">
         <h3>Türkçe karşılıklar</h3>
         <div class="words">${e.wtr.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
         ${senses ? '<p class="srcnote">İkinci kaynaktan (FreeDict) gelir; maddenin bütün anlamlarını kapsamayabilir.</p>' : ''}
       </div>`
    : '';

  /*
   * FreeDict'ten gelen maddelerin tanımı yoktur (yalnızca karşılık). O durumda
   * "tanım yok" satırı gösterilmez — zaten yukarıda karşılıklar var.
   */
  const senseList = senses
    ? `<ul class="senses">${senses}</ul>`
    : (wordTr ? '' : '<ul class="senses"><li class="sense"><span class="d">Bu madde için tanım yok.</span></li></ul>');

  return `
    <div class="entry">
      <div class="entry-head">
        <h1>${esc(e.w)}</h1>
        ${meta}
      </div>
      ${stemNote}
      <div class="rule"></div>
      ${wordTr}
      ${senseList}
      ${rels}
      ${ety}
      <p class="hintbar">
        <span><kbd>Esc</kbd> aramaya dön</span>
        <span><kbd>←</kbd> geri</span>
      </p>
    </div>`;
}

function viewFavorites() {
  const q = S.favoritesQuery;
  const list = q
    ? S.favorites.filter((f) => search.fold(f.w).includes(search.fold(q)))
    : S.favorites;

  let body;
  if (!S.favorites.length) {
    body = `<div class="empty">
      ${icon('bookmark', { size: 38 })}
      <h3>Henüz favori yok</h3>
      <p>Bir maddeyi açıp ayraç simgesine dokunduğunda buraya eklenir.</p>
    </div>`;
  } else if (!list.length) {
    body = `<div class="empty">
      ${icon('search', { size: 32 })}
      <h3>Eşleşme yok</h3>
      <p>Favorilerin içinde "${esc(q)}" bulunamadı.</p>
    </div>`;
  } else {
    body = `<ul class="results">${list.map((f) => `
      <li><button class="result" data-open="${esc(f.w)}" data-dir="${esc(f.dir)}">
        <span class="w">${mark(f.w, q)}</span>
        <span class="pos">${esc(posTr(f.pos))}</span>
        <span class="tr">${esc((f.tr || []).slice(0, 3).join(', '))}</span>
      </button></li>`).join('')}</ul>`;
  }

  return `
    <div class="field">
      ${icon('bookmark', { size: 20 })}
      <input id="fq" type="search" autocomplete="off" spellcheck="false"
             aria-label="Favorilerde ara" placeholder="Favorilerde ara"
             value="${esc(q)}">
      ${S.favorites.length ? `<span class="count">${S.favorites.length} kelime</span>` : ''}
    </div>
    ${body}`;
}

function viewSettings() {
  const dirLabel = S.direction === 'en-tr' ? 'İngilizce → Türkçe' : 'Türkçe → İngilizce';

  const seg = (name, opts, current) => `
    <div class="seg" role="group">
      ${opts.map(([v, l]) => `<button data-set="${name}" data-val="${v}"
        aria-pressed="${current === v}">${l}</button>`).join('')}
    </div>`;

  const key = (k) => `<kbd>${esc(k)}</kbd>`;

  return `
    <div class="settings">
      <h1 class="page-title">Ayarlar</h1>
      <div class="set-group">
        <h2>Görünüm</h2>
        <div class="set-row">
          <div class="info"><div class="lbl">Tema</div></div>
          <div class="ctl">${seg('theme', [['auto', 'Sistem'], ['light', 'Açık'], ['dark', 'Koyu']], S.theme)}</div>
        </div>
      </div>

      <div class="set-group">
        <h2>Arama yönü</h2>
        <div class="set-row">
          <div class="info">
            <div class="lbl">Varsayılan yön</div>
            <div class="hint">${esc(dirLabel)}</div>
          </div>
          <div class="ctl">${seg('direction', [['en-tr', 'EN → TR'], ['tr-en', 'TR → EN']], S.direction)}</div>
        </div>
      </div>

      <div class="set-group">
        <h2>Telaffuz</h2>
        <div class="set-row">
          <div class="info">
            <div class="lbl">Ses kaynağı</div>
            <div class="hint">Wikimedia kaydı, bulunamazsa tarayıcı sesi</div>
          </div>
        </div>
        <div class="set-row">
          <div class="info">
            <div class="lbl">Tarayıcı sesi</div>
            <div class="hint">${speech.CAN_SPEAK ? 'Destekleniyor' : 'Bu tarayıcı desteklemiyor'}</div>
          </div>
        </div>
      </div>

      <div class="set-group">
        <h2>Depolama</h2>
        <div class="set-row">
          <div class="info">
            <div class="lbl">Çevrimdışı kopya</div>
            <div class="hint" id="cacheinfo">Hesaplanıyor…</div>
          </div>
          <div class="ctl"><button class="textbtn" data-act="clearcache">Temizle</button></div>
        </div>
        <div class="set-row">
          <div class="info">
            <div class="lbl">Favoriler</div>
            <div class="hint">${S.favorites.length} kelime kayıtlı</div>
          </div>
          <div class="ctl"><button class="textbtn" data-act="clearfav">Hepsini sil</button></div>
        </div>
        <div class="set-row">
          <div class="info">
            <div class="lbl">Son aramalar</div>
            <div class="hint">${(S.recent || []).length
              ? `${S.recent.length} kelime`
              : 'Kayıt yok'}</div>
          </div>
          <div class="ctl"><button class="textbtn" data-act="clearrecent">Temizle</button></div>
        </div>
      </div>

      <div class="set-group">
        <h2>Kısayollar</h2>
        <div class="set-row">
          <div class="info"><div class="lbl">Aramaya odaklan</div></div>
          <div class="ctl"><div class="keys">${key('/')}</div></div>
        </div>
        <div class="set-row">
          <div class="info"><div class="lbl">Sonuçlar arasında gez</div></div>
          <div class="ctl"><div class="keys">${key('↑')}${key('↓')}</div></div>
        </div>
        <div class="set-row">
          <div class="info"><div class="lbl">Seçili sonucu aç</div></div>
          <div class="ctl"><div class="keys">${key('Enter')}</div></div>
        </div>
        <div class="set-row">
          <div class="info"><div class="lbl">Geri dön</div></div>
          <div class="ctl"><div class="keys">${key('Esc')}</div></div>
        </div>
      </div>

      <!--
        Atıf burada duruyor, alt bilgide değil.
        Önceden her ekranın altında üç satır lisans metni vardı; mobilde sürekli
        görünüyor ve içeriği aşağı itiyordu. Lisans yalnızca "ulaşılabilir"
        olmak zorunda — ayrı bir bölüm bunu karşılıyor. Her maddede zaten
        "ikinci kaynaktan gelir" notu var.
      -->
      <div class="set-group">
        <h2>Hakkında</h2>
        <p class="about">
          Sözlük verisi
          <a href="https://en.wiktionary.org" target="_blank" rel="noopener">Wiktionary</a>'den
          türetilmiştir,
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>
          lisansı altındadır. Türkçe karşılıkların bir bölümü
          <a href="https://github.com/freedict/fd-dictionaries" target="_blank" rel="noopener">FreeDict eng-tur</a>'den
          gelir, GPL-2.0+ lisansı altındadır. Ses kayıtları
          <a href="https://commons.wikimedia.org" target="_blank" rel="noopener">Wikimedia Commons</a>'tan gelir.
        </p>
        <p class="about about-links">
          <a href="https://github.com/BerkeHazar/Lumen" target="_blank" rel="noopener">Kaynak kodu</a>
          · MIT lisansı
        </p>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ kabuk */

function viewShell() {
  const r = S.route;
  const back = r.name !== 'search';
  const dirA = S.direction === 'en-tr';

  return `
    <header class="topbar">
      ${back ? `<button class="ibtn" data-act="back" aria-label="Geri">${icon('back', { size: 19 })}</button>` : ''}
      <button class="brand" data-act="home" aria-label="Ana sayfa">
        ${logoMark({ size: 20 })}<span class="wordmark">Lumen</span>
      </button>
      ${r.name === 'search' ? `
      <button class="dir" data-act="flip" aria-label="Arama yönünü değiştir"
              title="Yönü değiştir">
        <span class="${dirA ? 'on' : 'off'}">EN</span>
        ${icon('swap', { size: 15 })}
        <span class="${dirA ? 'off' : 'on'}">TR</span>
      </button>` : ''}
      <span class="spacer"></span>
      <button class="ibtn" data-route="favorites" aria-label="Favoriler"
              aria-current="${r.name === 'favorites'}">${icon('bookmark', { size: 19 })}</button>
      <a class="ibtn" href="https://github.com/BerkeHazar/Lumen" target="_blank"
         rel="noopener" aria-label="GitHub deposu" title="GitHub">${icon('github', { size: 16 })}</a>
      <button class="ibtn" data-route="settings" aria-label="Ayarlar"
              aria-current="${r.name === 'settings'}">${icon('sliders', { size: 19 })}</button>
      <button class="ibtn" data-act="theme" aria-label="Temayı değiştir">${icon('contrast', { size: 19 })}</button>
    </header>
    <main class="main" id="view"></main>
    <div id="toast"></div>`;
}

/* ------------------------------------------------------------------ çizim */

function currentView() {
  switch (S.route.name) {
    case 'entry': return viewEntry();
    case 'favorites': return viewFavorites();
    case 'settings': return viewSettings();
    default: return viewSearch();
  }
}

function render() {
  const view = document.getElementById('view');
  if (!view) return;

  const active = document.activeElement;
  const wasInput = active && (active.id === 'q' || active.id === 'fq');
  const caret = wasInput ? active.selectionStart : null;
  const which = active ? active.id : null;

  view.innerHTML = currentView();

  // Odak ve imleç konumunu koru — her tuş vuruşunda alan sıfırlanmasın
  if (wasInput) {
    const el = document.getElementById(which);
    if (el) {
      el.focus();
      if (caret != null) { try { el.setSelectionRange(caret, caret); } catch { /* yok say */ } }
    }
  }
}

/** Yalnızca üst çubuğu yeniden çizer (tema/yön değişiminde). */
function renderShell() {
  const app = document.querySelector('.app');
  if (!app) return;
  const header = app.querySelector('.topbar');
  const tmp = document.createElement('div');
  tmp.innerHTML = viewShell();
  header.replaceWith(tmp.querySelector('.topbar'));
}

/* ------------------------------------------------------------------ yönlendirme */

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (!h) return { name: 'search', word: null };
  if (h === 'favorites') return { name: 'favorites', word: null };
  if (h === 'settings') return { name: 'settings', word: null };
  if (h.startsWith('w/')) return { name: 'entry', word: decodeURIComponent(h.slice(2)) };
  return { name: 'search', word: null };
}

/*
 * Uygulama içi gezinme derinliği.
 *
 * "Geri" düğmesi önceden history.length > 1 ölçütünü kullanıyordu; bu yanlış.
 * Paylaşılan bir kelime bağlantısıyla (#/w/water) doğrudan giren kullanıcının
 * tarayıcı geçmişinde uygulamaya ait hiçbir adım yoktur, ama history.length
 * yine de > 1 olur. Ölçüm: geri'ye basınca uygulama about:blank'e düşüyordu —
 * kullanıcı boş sayfada kalıyordu.
 *
 * Doğru ölçüt kaç kez uygulama içi yönlendirme yapıldığı. Tarayıcının kendi
 * geri/ileri düğmesi popstate tetikler; sayaç orada düşürülür.
 */
let navDepth = 0;

function go(hash, replace = false) {
  if (replace) location.replace(hash);
  else { navDepth++; location.hash = hash; }
}

window.addEventListener('popstate', () => { if (navDepth > 0) navDepth--; });

/**
 * Uygulamadan çıkmadan geri gider.
 * Uygulama içi bir adım varsa gerçekten geri gider (kelimeden kelimeye
 * gezinme korunur); yoksa aramaya döner.
 */
function goBack() {
  if (navDepth > 0) history.back();
  else go('#/', true);
}

async function route() {
  const prev = S.route;
  S.route = parseHash();
  speech.stop();
  S.speaking = null;
  S.sayStage = null;
  clearToast();

  /*
   * Kaydırma konumu sıfırlanır — ama yalnızca ROTA DEĞİŞTİĞİNDE.
   *
   * Hash yönlendirmesinde tarayıcı kaydırma konumunu korur. Uzun bir maddeden
   * (ör. "water", 3000 px) ayarlara geçen kullanıcı sayfayı ortadan açıyordu:
   * ölçüm 900 px kaydırmadan sonra ayarların 352 px'te açılması. Aynı rotada
   * yeniden çizimde (tema değişimi, favori ekleme) konum korunmalı.
   */
  const changed = prev.name !== S.route.name || prev.word !== S.route.word;
  if (changed) window.scrollTo(0, 0);

  // Madde başlığı sekmede kalıyordu: kelimeyi açıp aramaya dönünce sekme hâlâ
  // "water — Lumen" yazıyordu. Madde rotası aşağıda openEntry ile üzerine yazar.
  document.title = TITLE;

  // Üst çubuk HER rotada güncellenir. Önce yalnızca aşağıda çağrılıyordu ve
  // madde rotası erken return ettiği için geri düğmesi hiç çizilmiyordu —
  // kullanıcı madde ekranından arayüze dönemiyordu.
  renderShell();

  if (S.route.name === 'entry') {
    await openEntry(S.route.word, false);
    return;
  }

  if (S.route.name === 'favorites') {
    S.favorites = await store.listFavorites();
    S.favoritesQuery = '';
  }

  if (S.route.name === 'settings') {
    S.favorites = await store.listFavorites();
  }

  S.loading = false;
  render();

  // render() SONRASINDA çağrılmalı: #cacheinfo ancak ayarlar görünümü
  // çizildikten sonra DOM'da olur.
  if (S.route.name === 'settings') refreshCacheInfo();

  if (S.route.name === 'search') {
    const q = document.getElementById('q');
    if (q && !matchMedia('(pointer: coarse)').matches) q.focus();
  }
}

/* ------------------------------------------------------------------ arama */

let searchToken = 0;

async function runSearch(q) {
  S.query = q;
  S.cursor = -1;

  if (!q.trim()) {
    S.results = [];
    render();
    return;
  }

  const token = ++searchToken;
  try {
    if (!search.isReady()) {
      S.loading = true; render();
      const rows = await dict.loadIndex(S.direction);
      if (token !== searchToken) return;
      search.build(rows);
      S.loading = false;
    }
    S.results = search.search(q);
    render();
    renderSuggest(q);
  } catch (e) {
    S.loading = false;
    render();
    toast(e.message || 'Sözlük yüklenemedi.');
  }
}

/**
 * Sonuç bulunamadığında "şunu mu demek istedin" kutusunu doldurur.
 *
 * render() SONRASINDA çağrılmalı: #suggest ancak sonuçsuz görünüm
 * çizildikten sonra DOM'da olur.
 *
 * Bu kutu önceden yalnızca runSearch içinde dolduruluyordu. Ama dizin
 * açılışta arka planda hazırlandığı için normal yazma akışı her zaman
 * onInput'un hızlı yolundan geçiyor ve runSearch neredeyse hiç
 * çağrılmıyordu — yani öneri özelliği pratikte ölüydü.
 */
function renderSuggest(q) {
  const host = document.getElementById('suggest');
  if (!host) return;
  const sug = search.suggest(q);
  if (!sug.length) return;
  host.innerHTML = `
    <div class="notice">
      ${icon('search', { size: 18 })}
      <div class="t"><b>Şunu mu demek istedin?</b>
        <div class="words">
          ${sug.map((s) => `<button class="textbtn" data-open="${esc(s.w)}">${esc(s.w)}</button>`).join('')}
        </div>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ madde */

async function openEntry(word, push = true) {
  if (!word) return;
  S.loading = true;
  S.entry = null;
  if (push) {
    S.route = { name: 'entry', word };
    go(`#/w/${encodeURIComponent(word)}`);
  }
  render();

  try {
    const e = await dict.lookup(word, S.direction);
    S.entry = e;
    S.loading = false;
    S.favorites = await store.listFavorites();
    render();
    if (e) {
      store.pushRecent(word).then((r) => { S.recent = r; });
      document.title = `${e.w} — Lumen`;
    } else {
      document.title = TITLE;
    }
  } catch (err) {
    S.loading = false;
    S.entry = null;
    render();
    toast(err.offline
      ? 'Bu kelime cihazda yok ve bağlantı kurulamadı.'
      : 'Kelime yüklenemedi.');
  }
}

/* ------------------------------------------------------------------ telaffuz */

async function doSay(word) {
  if (S.speaking === word && S.sayStage === 'playing') {
    speech.stop();
    S.speaking = null;
    S.sayStage = null;
    render();
    return;
  }

  clearToast();
  S.speaking = word;
  S.sayStage = 'loading';
  render();

  const lang = S.direction === 'en-tr' ? 'en' : 'tr';
  const own = (S.entry && S.entry.w === word ? S.entry.aud : null) || null;

  const res = await speech.say(word, lang, (stage) => {
    S.sayStage = stage === 'fallback' ? 'loading' : stage;
    render();
  }, own);

  if (res.ok) {
    S.sayStage = 'playing';
    render();
    const el = speech; // oynatma bitişini kestiremiyoruz; kısa süre sonra normale dön
    setTimeout(() => {
      if (S.speaking === word) { S.speaking = null; S.sayStage = null; render(); }
    }, 2600);
  } else {
    S.speaking = null;
    S.sayStage = null;
    render();
    toast(res.text || 'Telaffuz çalınamadı.', 'error', word);
  }
}

/* ------------------------------------------------------------------ ayarlar */

/**
 * Service worker'ın veri önbelleğini siler.
 *
 * Neden ayrı bir adım: sözlük parçaları İKİ yerde durur — IndexedDB (store.js)
 * ve service worker'ın HTTP önbelleği (sw.js, `lumen-data`). Yalnızca
 * IndexedDB boşaltılırsa SW katmanı aynı veriyi servis etmeye devam eder:
 * "çevrimdışı kopya silindi" bildirimi yalan olur, kullanıcı yeri boşaltamaz.
 * sw.js bu mesajı baştan beri dinliyordu ama gönderen yoktu.
 */
async function clearServiceWorkerData() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    reg?.active?.postMessage({ type: 'clear-data-cache' });
  } catch { /* sw yoksa uygulama yine çalışır */ }
}

async function refreshCacheInfo() {
  const el = document.getElementById('cacheinfo');
  if (!el) return;
  const n = await store.dictCacheSize();
  const a = await store.audioCacheSize();
  el.textContent = n || a
    ? `${n} sözlük parçası, ${a} ses kaydı adresi cihazda`
    : 'Henüz çevrimdışı kopya yok';
}

async function setTheme(v) {
  S.theme = await store.setSetting('theme', v);
  applyTheme();
  render();
}

/*
 * Dizini arka planda hazırlar.
 *
 * Ana ekrandaki madde sayısı dizin hazır olmadan bilinmiyor; ilk çizim her
 * zaman dizinden önce olduğu için sayı "0" çıkıp gizleniyordu. Dizin kurulunca
 * ekran bir kez tazelenir — ama yalnızca kullanıcı hâlâ boş aramada duruyorsa.
 *
 * `indexToken`: yön hızlıca iki kez değişirse eski kurulumun yenisini ezmesini
 * engeller.
 */
let indexToken = 0;

function warmIndex() {
  const token = ++indexToken;
  dict.loadIndex(S.direction)
    .then((rows) => {
      if (token !== indexToken) return;
      search.build(rows);
      if (S.route.name === 'search' && !S.query) render();
    })
    .catch(() => { /* ilk aramada tekrar denenir */ });
}

async function setDirection(v) {
  S.direction = await store.setSetting('direction', v);
  search.reset?.();
  // yön değişince dizin baştan kurulur
  S.results = [];
  S.query = '';
  S.entry = null;
  renderShell();
  if (S.route.name === 'entry') go('#/');
  else render();
  warmIndex();
}

/* ------------------------------------------------------------------ olaylar */

async function onClick(ev) {
  const t = ev.target.closest('[data-act], [data-open], [data-route], [data-set]');
  if (!t) return;

  /* ayar düğmeleri */
  if (t.dataset.set) {
    const { set, val } = t.dataset;
    if (set === 'theme') setTheme(val);
    if (set === 'direction') setDirection(val);
    return;
  }

  /* yönlendirme */
  if (t.dataset.route) {
    go(`#/${t.dataset.route}`);
    return;
  }

  /*
   * Başlıktaki marka: her ekrandan arama ekranına döner.
   * Zaten aramadaysa sayfa yeniden çizilmez — yalnızca arama alanına odaklanır.
   * (Boşuna bir gezinme adımı eklemek "geri" düğmesini de kirletirdi.)
   */
  if (t.dataset.act === 'home') {
    if (S.route.name === 'search') document.getElementById('q')?.focus();
    else go('#/');
    return;
  }

  /*
   * Kelime açma yönlendirme üzerinden yapılır. Önceden burada doğrudan
   * openEntry çağrılıyordu; hash de değiştiği için route() bir kez daha
   * openEntry çalıştırıyor ve madde iki kez yükleniyordu.
   * Hash zaten hedefle aynıysa hashchange tetiklenmez, o durumda doğrudan açılır
   * (aynı maddenin eş anlamlısına tıklanması gibi).
   */
  if (t.dataset.open) {
    const w = t.dataset.open;
    const target = `#/w/${encodeURIComponent(w)}`;
    if (location.hash === target) openEntry(w, false);
    else go(target);
    return;
  }

  const act = t.dataset.act;
  if (!act) return;

  switch (act) {
    case 'back':
      goBack();
      break;

    case 'clear': {
      S.query = '';
      S.results = [];
      render();
      document.getElementById('q')?.focus();
      break;
    }

    /* Boş ana ekrandan rastgele madde açar. */
    case 'random': {
      const w = search.random ? search.random() : null;
      if (w) go(`#/w/${encodeURIComponent(w)}`);
      break;
    }

    case 'delrecent': {
      S.recent = await store.removeRecent(t.dataset.word);
      render();
      // Klavyeyle gezen kullanıcı odak kaybetmesin
      document.getElementById('q')?.focus();
      break;
    }

    case 'flip': {
      setDirection(S.direction === 'en-tr' ? 'tr-en' : 'en-tr');
      break;
    }

    case 'theme': {
      const order = ['auto', 'light', 'dark'];
      const next = order[(order.indexOf(S.theme) + 1) % order.length];
      setTheme(next);
      break;
    }

    case 'say':
      doSay(t.dataset.word);
      break;

    case 'retry':
      doSay(t.dataset.word);
      break;

    case 'fav': {
      const e = S.entry;
      if (!e) break;
      const on = await store.toggleFavorite({
        w: e.w, dir: S.direction, pos: (e.s && e.s[0] && e.s[0].pos) || '',
        tr: (e.s && e.s[0] && e.s[0].tr) || [],
      });
      S.favorites = await store.listFavorites();
      render();
      toast(on ? `"${e.w}" favorilere eklendi.` : `"${e.w}" favorilerden çıkarıldı.`, 'ok');
      break;
    }

    case 'clearcache': {
      await store.clearDictCache();
      await store.clearAudio();
      dict.resetMemoryCache();
      await clearServiceWorkerData();
      refreshCacheInfo();
      toast('Çevrimdışı kopya silindi.', 'ok');
      break;
    }

    case 'clearfav': {
      await store.clearFavorites();
      S.favorites = [];
      render();
      toast('Favoriler silindi.', 'ok');
      break;
    }

    case 'clearrecent': {
      // store.clearRecent() baştan beri vardı ama hiçbir yerden çağrılmıyordu:
      // geçmişi tümden silmenin arayüzde karşılığı yoktu, yalnızca tek tek
      // satır silinebiliyordu. Bu düğme o boşluğu kapatır.
      S.recent = await store.clearRecent();
      render();
      toast('Son aramalar silindi.', 'ok');
      break;
    }
  }
}

/* `await` içeren onClick için sarmalayıcı */
const on = (ev) => { Promise.resolve(onClick(ev)).catch(() => {}); };

let inputTimer = null;

function onInput(ev) {
  const el = ev.target;
  if (el.id === 'q') {
    S.query = el.value;
    S.cursor = -1;
    // dizin hazırsa anında ara, değilse kısa gecikmeyle
    if (search.isReady()) {
      S.results = search.search(el.value);
      render();
      renderSuggest(el.value);
    } else {
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => runSearch(el.value), 90);
    }
    return;
  }
  if (el.id === 'fq') {
    S.favoritesQuery = el.value;
    render();
  }
}

function onKey(ev) {
  const tag = (ev.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea';

  /* aramaya odakla */
  if (!typing && (ev.key === '/' || ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k'))) {
    ev.preventDefault();
    if (S.route.name !== 'search') go('#/');
    setTimeout(() => document.getElementById('q')?.focus(), 30);
    return;
  }

  if (ev.key === 'Escape') {
    if (typing && ev.target.value) {
      ev.target.value = '';
      ev.target.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (S.route.name !== 'search') { goBack(); return; }
    if (S.speaking) { speech.stop(); S.speaking = null; S.sayStage = null; render(); }
    return;
  }

  /*
   * Madde ekranındaki ipucu "<kbd>←</kbd> geri" yazıyordu ama ne sol ok ne
   * Backspace hiçbir şey yapmıyordu — ipucu yalan söylüyordu. İkisi de geri
   * götürür.
   *
   * `typing` kontrolü şart: arama alanında Backspace harf silmeli, gezinmemeli.
   * (Arama ekranı hariç tutuluyor çünkü orada geri gidilecek yer yok.)
   */
  if (!typing && S.route.name !== 'search'
      && (ev.key === 'ArrowLeft' || ev.key === 'Backspace')) {
    ev.preventDefault();
    goBack();
    return;
  }

  if (S.route.name !== 'search') return;
  if (!S.results.length) return;

  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    const n = S.results.length;
    S.cursor = ev.key === 'ArrowDown'
      ? (S.cursor + 1) % n
      : (S.cursor - 1 + n) % n;
    render();
    document.querySelector(`.result[data-idx="${S.cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
    return;
  }

  if (ev.key === 'Enter') {
    ev.preventDefault();
    const pick = S.cursor >= 0 ? S.results[S.cursor] : S.results[0];
    if (pick) openEntry(pick.w);
  }
}

/* ------------------------------------------------------------------ başlat */

async function boot() {
  const app = document.querySelector('.app');
  app.innerHTML = viewShell();
  document.getElementById('view').innerHTML = viewSearch();

  const s = await store.getAllSettings();
  S.theme = s.theme;
  S.direction = s.direction;
  S.recent = s.recent || [];
  applyTheme();

  app.addEventListener('click', on);
  app.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => { route(); });

  // Dizin arka planda hazırlansın — ilk aramada bekleme olmasın
  warmIndex();

  await route();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

/* Service worker — çevrimdışı çalışma */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url))
      .then((reg) => {
        // Açılışta bir güncelleme denetimi daha: tarayıcı kendi kontrolünü
        // yapar ama sekmeler arası farkları da yakalamak için açıkça istenir.
        reg.update().catch(() => { /* çevrimdışıysa sorun değil */ });
      })
      .catch(() => { /* sw yoksa uygulama yine çalışır */ });
  });

  /*
   * Güncelleme sonrası yenileme index.html'deki satır içi betikte yapılır.
   * Sebep: bu dosya da önbellekten (eski sürümüyle) gelebilir; index.html ise
   * her gezinmede ağdan geldiği için her zaman günceldir.
   */
}
