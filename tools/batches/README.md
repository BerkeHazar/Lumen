# Kelime partileri

Bu klasördeki JSON dosyaları, dış kaynaklardan (Kaikki.org / Wiktionary) gelmeyen
**bize ait** sözlük maddelerini taşır. `tools/apply-batches.mjs` bunları derlenmiş
veriye (`data/<yön>/`) işler.

## Neden ayrı dosyalar

- **Sürüm kontrolü.** Her ekleme git geçmişinde tek tek görünür, geri alınabilir.
- **Yeniden derlemeye dayanıklı.** `tools/build-dict.mjs` veriyi sıfırdan üretir
  ve `data/` klasörünü siler. Partiler bu klasörün dışında durduğu için
  yeniden derlemeden sonra `apply-batches` ile geri uygulanır.
- **Lisans ayrımı.** Buradaki tanımlar özgün yazımdır → CC0-1.0. Wiktionary
  türevi veriler CC BY-SA 4.0 olarak kalır. CC0 hiçbir koşul getirmediği için
  aynı dosyada birleşmeleri CC BY-SA'yı ihlal etmez. (GPL olan FreeDict bu
  yüzden ayrı tutulur; orada durum farklıdır.)

## Biçim

```json
{
  "batch": "001",
  "note": "ne eklendiği, tek cümle",
  "license": "CC0-1.0",
  "entries": {
    "en-tr": [
      {
        "w": "subtle",
        "pos": "adj",
        "s": [
          {
            "pos": "adj",
            "def": "Not immediately obvious or noticeable.",
            "tr": ["ince", "gözden kaçan"],
            "ex": ["There is a subtle difference between the two."]
          }
        ],
        "rel": ["subtlety"]
      }
    ],
    "tr-en": []
  }
}
```

### Alanlar

| Alan | Zorunlu | Not |
|------|---------|-----|
| `w` | ✓ | Madde başı |
| `pos` | ✓ | `noun`, `verb`, `adj`, `adv`, `prep`, `conj`, `pron`, `interj`, `num`, `det`, `particle`, `phrase`, `abbrev`, `name` |
| `s` | ✓ | En az bir anlam |
| `s[].def` | ✓ | Tanım (boş olamaz) |
| `s[].tr` | — | Türkçe karşılıklar |
| `s[].ex` | — | Örnek cümle |
| `ipa`, `syl`, `ety`, `syn`, `ant`, `rel`, `der` | — | Varsa kaynaktaki boşlukları doldurur |

### Birleşme kuralı

`tools/apply-batches.mjs` mevcut maddeyi **silmez**:

- Yeni anlam ekler (aynı `pos` + aynı `def` yoksa).
- Boş `tr` / `ex` alanlarını doldurur.
- Eksik `ipa` / `ety` / ilişki listelerini tamamlar.

Aynı kelime iki partide geçerse sonraki kazanır ve araç uyarı basar.

## Kullanım

```bash
node tools/apply-batches.mjs --dry    # yazmadan raporla
node tools/apply-batches.mjs          # data/ içine işle
```

`manifest.json` içindeki `generated` alanı yalnızca içerik gerçekten
değiştiğinde tazelenir; aksi hâlde her çalıştırma bütün istemcilerin
önbelleğini geçersiz kılardı.
