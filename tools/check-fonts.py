#!/usr/bin/env python3
"""
check-fonts.py — Bir yazı tipinin IPA ve Türkçe karakter kapsamasını ölçer.

Neden gerekli:
    Google Fonts, `unicode-range` ile geniş bir aralık BEYAN eder ama font
    dosyası o aralıktaki her karakteri İÇERMEZ. Sadece unicode-range'e bakmak
    yanıltıcıdır — bu betik fontun gerçek cmap tablosunu açar.

    Gerçek örnek: Instrument Sans'ın latin-ext unicode-range'i U+026A'yı
    kapsadığını söyler, ama font dosyasında ɪ glifi yoktur. Tarayıcı sessizce
    yedek fonta düşer ve fonetik karışık görünür.

Kullanım:
    pip install fonttools brotli
    python check-fonts.py "Instrument Sans" "Newsreader" "STIX Two Text"

Çıkış kodu 0 ise tüm fontlar tam kapsıyor, 1 ise eksik var.
"""

import hashlib
import os
import re
import sys
import urllib.request

try:
    from fontTools.ttLib import TTFont
except ImportError:
    sys.exit("fonttools kurulu degil:  pip install fonttools brotli")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".fontcache")

# Sözlük fonetiklerinde geçen IPA karakterleri
IPA = {
    "ɪ": 0x026A, "ʊ": 0x028A, "ɔ": 0x0254, "ə": 0x0259, "ɛ": 0x025B,
    "æ": 0x00E6, "ʌ": 0x028C, "ɑ": 0x0251, "ɒ": 0x0252, "ɜ": 0x025C,
    "ʃ": 0x0283, "ʒ": 0x0292, "θ": 0x03B8, "ð": 0x00F0, "ŋ": 0x014B,
    "ɹ": 0x0279, "ɡ": 0x0261, "ˈ": 0x02C8, "ˌ": 0x02CC, "ː": 0x02D0,
}

# Türkçe'ye özgü harfler
TR = {"ç": 0x00E7, "Ç": 0x00C7, "ğ": 0x011F, "Ğ": 0x011E, "ı": 0x0131,
      "İ": 0x0130, "ö": 0x00F6, "Ö": 0x00D6, "ş": 0x015F, "Ş": 0x015E,
      "ü": 0x00FC, "Ü": 0x00DC}

# Sayfada gerçekten gösterilen diziler — hepsi birebir kapsanmalı
SAMPLES = [
    "/ɪkˈstrɔːdɪnəri/",
    "/ɪkˈstrɔɹdɪnɛɹi/",
    "ex·traor·di·na·ry",
    "olağanüstü, fevkalade, sıra dışı, müstesna, özel",
]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def cmap_of(family):
    """Google Fonts'tan aileyi indirir ve tüm alt kümelerdeki glifleri birleştirir."""
    os.makedirs(CACHE, exist_ok=True)
    url = "https://fonts.googleapis.com/css2?family=" + family.replace(" ", "+") + "&display=swap"
    css = fetch(url).decode("utf-8")

    parts = re.split(r"/\*\s*([a-z0-9-]+)\s*\*/", css)
    cmap = set()
    for i in range(1, len(parts), 2):
        m = re.search(r"url\((https://[^)]+\.woff2)\)", parts[i + 1])
        if not m:
            continue
        u = m.group(1)
        fn = os.path.join(CACHE, hashlib.md5(u.encode()).hexdigest()[:16] + ".woff2")
        if not os.path.exists(fn):
            try:
                open(fn, "wb").write(fetch(u))
            except Exception:
                continue
        try:
            ft = TTFont(fn)
            for t in ft["cmap"].tables:
                cmap |= set(t.cmap.keys())
        except Exception:
            pass
    return cmap


def main():
    families = sys.argv[1:] or ["Instrument Sans", "Instrument Serif", "Archivo", "Newsreader"]
    bad = 0

    for fam in families:
        try:
            cm = cmap_of(fam)
        except Exception as e:
            print("%-22s HATA: %s" % (fam, e))
            bad += 1
            continue
        if not cm:
            print("%-22s indirilemedi" % fam)
            bad += 1
            continue

        miss_ipa = [c for c in IPA if IPA[c] not in cm]
        miss_tr = [c for c in TR if TR[c] not in cm]
        miss_smp = sorted({c for s in SAMPLES for c in s if c.strip() and ord(c) not in cm})

        pct = 100 * (len(IPA) - len(miss_ipa)) / len(IPA)
        status = "TAM" if not (miss_ipa or miss_tr or miss_smp) else "EKSIK"
        print("%-22s IPA %3.0f%%  Turkce %s  %s" % (
            fam, pct, "tam" if not miss_tr else "EKSIK", status))

        if miss_ipa:
            print("     IPA eksik : %s" % " ".join("%s(U+%04X)" % (c, IPA[c]) for c in miss_ipa))
        if miss_tr:
            print("     TR eksik  : %s" % " ".join(miss_tr))
        if miss_smp:
            print("     ornekte   : %s" % " ".join("%s(U+%04X)" % (c, ord(c)) for c in miss_smp))
        if miss_ipa or miss_tr or miss_smp:
            bad += 1

    print()
    if bad:
        print("%d aile fonetik icin uygun degil." % bad)
    else:
        print("Tum aileler fonetik ve Turkce icin tam kapsiyor.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
