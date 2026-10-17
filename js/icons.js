/**
 * icons.js — Lumen'ın kendi ikon seti.
 *
 * Neden hazır set kullanmıyoruz:
 *   Lucide, Feather, Heroicons üretken modellerin varsayılanı; bir sözlükte
 *   görüldüklerinde sayfa "AI ile yapılmış" hissi veriyor. Bu set Stage yönüne
 *   göre elle çizildi.
 *
 * Izgara:      24 × 24, çizim alanı 20 × 20 (2px optik boşluk)
 * Çizgi:       1.4px, yuvarlak uç ve birleşim
 * Dolgu:       yalnızca durum bildiren ikonlarda (favori işaretli)
 * Renk:        currentColor
 *
 * Alışılmadık seçimler — bilinçli:
 *   • favori = yıldız değil AYRAÇ (bookmark). Sözlük kitaptır, yıldız değil.
 *   • ayarlar = dişli değil SÜRGÜ (slider). Dişli en yıpranmış metafor.
 *   • tema = güneş/ay değil KONTRAST (yarım dolu daire). Tek ikon, iki durum.
 *   • telaffuz = oynat üçgeni değil HOPARLÖR. "Oynat" değil "seslendir".
 */

const SVG_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" ' +
  'aria-hidden="true" focusable="false"';

/* ------------------------------------------------------------------ çizimler */
const P = {
  /* arama — hafif geniş çember, kısa sap */
  search: '<circle cx="10.6" cy="10.6" r="6.6"/><path d="M15.4 15.4L20 20"/>',

  /* telaffuz — hoparlör gövdesi + iki ses yayı */
  speaker:
    '<path d="M4.5 9.6h3.2L12 6.1v11.8l-4.3-3.5H4.5z"/>' +
    '<path d="M15.4 9.9a3.1 3.1 0 010 4.2"/>' +
    '<path d="M17.9 7.5a6.3 6.3 0 010 9"/>',

  /* favori — ayraç; işaretliyken dolu */
  bookmark: '<path d="M7 4.6h10v14.8l-5-3.7-5 3.7z"/>',
  bookmarkFilled: '<path d="M7 4.6h10v14.8l-5-3.7-5 3.7z" fill="currentColor"/>',

  /* geri */
  back: '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>',

  /* ayarlar — üç sürgü, üç farklı konumda topuz */
  sliders:
    '<path d="M4 7.5h8M16 7.5h4"/><circle cx="14" cy="7.5" r="2"/>' +
    '<path d="M4 12h3M11 12h9"/><circle cx="9" cy="12" r="2"/>' +
    '<path d="M4 16.5h10M18 16.5h2"/><circle cx="16" cy="16.5" r="2"/>',

  /* tema — yarım dolu daire; tek ikon iki durum */
  contrast:
    '<circle cx="12" cy="12" r="8"/>' +
    '<path d="M12 4a8 8 0 010 16z" fill="currentColor" stroke="none"/>',

  /* kapat */
  close: '<path d="M6.6 6.6l10.8 10.8M17.4 6.6L6.6 17.4"/>',

  /* yön değiştir — üstte sağa, altta sola ok */
  swap:
    '<path d="M4.5 9h13"/><path d="M14.5 6l3 3-3 3"/>' +
    '<path d="M19.5 15h-13"/><path d="M9.5 12l-3 3 3 3"/>',

  /* oklar */
  chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
  chevronDown: '<path d="M6 9.5l6 6 6-6"/>',

  /* son aramalar */
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.6V12l3 2"/>',

  /* favorileri temizle */
  clear:
    '<path d="M4.5 7h15"/><path d="M9.5 7V4.6h5V7"/>' +
    '<path d="M6.6 7l1 12.4h8.8L17.4 7"/>',

  /* dış bağlantı — hata durumunda "harici sözlükte aç" */
  external:
    '<path d="M13.6 4.6h5.8v5.8"/><path d="M19.4 4.6l-8.2 8.2"/>' +
    '<path d="M17 13.4v6H4.6V7H10.6"/>',

  /* hata */
  alert:
    '<circle cx="12" cy="12" r="8.4"/>' +
    '<path d="M12 7.6v5.4"/><path d="M12 16.1v.2"/>',

  /* yeniden dene */
  retry:
    '<path d="M20 12a8 8 0 1 1-2.4-5.7"/>' +
    '<path d="M20 4.2v4.6h-4.6"/>',

  /* yükleniyor — yay */
  spinner: '<path d="M12 4.2a7.8 7.8 0 1 1-7.8 7.8"/>',

  /* boş durum — açık kitap */
  book:
    '<path d="M12 6.4C10.4 5.2 8.4 4.6 6 4.6H4v14h2c2.4 0 4.4.6 6 1.8"/>' +
    '<path d="M12 6.4c1.6-1.2 3.6-1.8 6-1.8h2v14h-2c-2.4 0-4.4.6-6 1.8"/>' +
    '<path d="M12 6.4v14"/>',

  /*
   * GitHub — tek dolu ikon.
   *
   * Neden çizgi değil: bu bir marka işareti, arayüzün kendi metaforu değil.
   * Octocat silueti çizgiye indirgendiğinde tanınmıyor; marka işaretleri
   * olduğu gibi kullanılır. Diğer ikonlar 1.4px çizgi — bu yüzden boyutu bir
   * tık küçük tutulur (18px) ki optik ağırlığı dengelensin.
   */
  github:
    '<path fill="currentColor" stroke="none" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>',
};

/* -------------------------------------------------- oynatma göstergesi (çubuk) */
/** Seslendirme sürerken hoparlör yerine geçen üç çubuk; CSS ile canlanır. */
const EQUALIZER =
  '<g class="eq">' +
  '<rect x="7" y="9" width="1.9" height="6" rx=".95"/>' +
  '<rect x="11" cy="12" x="11" y="7" width="1.9" height="10" rx=".95"/>' +
  '<rect x="15" y="9" width="1.9" height="6" rx=".95"/>' +
  '</g>';

/* ------------------------------------------------- marka işareti (logotype) */

/**
 * Üst çubukta "Lumen" yazısının solunda duran işaret.
 * icons/icon.svg ile aynı geometri, 24'lük ızgaraya uyarlanmış.
 *
 * Küçük boyutta okunabilmesi için uygulama ikonundan farklı olarak kollar
 * kalınlaştırıldı; ikon 512'de, bu işaret 20 pikselde görünüyor.
 */
export function logoMark(opt = {}) {
  const { size = 20, cls = '' } = opt;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" class="${cls}" aria-hidden="true" focusable="false">
    <path d="M6.3 4.3h3.1v10.3h7.9v3.1H6.3z" fill="currentColor"/>
    <circle cx="17.9" cy="6.1" r="2.2" fill="var(--accent, #3E9E70)"/>
  </svg>`;
}

/* ------------------------------------------------------------------- API */
/**
 * İkonu SVG metni olarak döndürür.
 * @param {string} name  P içindeki anahtar
 * @param {object} [opt] { size, cls, stroke }
 */
export function icon(name, opt = {}) {
  const { size = 20, cls = '', stroke } = opt;
  const path = P[name];
  if (!path) {
    console.warn('[icons] bilinmeyen ikon:', name);
    return '';
  }
  const sw = stroke ? ` stroke-width="${stroke}"` : '';
  return `${SVG_OPEN} width="${size}" height="${size}" class="${cls}"${sw}>${path}</svg>`;
}

/** Seslendirme sürerken kullanılan canlı gösterge. */
export function equalizer(opt = {}) {
  const { size = 20, cls = '' } = opt;
  return `${SVG_OPEN} width="${size}" height="${size}" class="${cls}">${EQUALIZER}</svg>`;
}

export default { icon, equalizer, logoMark };
