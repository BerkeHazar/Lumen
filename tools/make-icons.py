"""icons/ içindeki PWA ikonlarını SVG ile aynı geometriden üretir.

Geometri artık 24'lük ızgarada tanımlı — js/icons.js içindeki logoMark() ve
icons/icon.svg ile aynı sayılar. Önceden bu betik 512 tabanlı ayrı koordinatlar
kullanıyordu ve iki çizim zamanla ayrışmıştı (SVG'de köşe yarıçapı yoktu,
arayüz işaretinde vardı). Tek kaynak: aşağıdaki GRID sabitleri.
"""
import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Pillow kurulu degil:  pip install pillow")

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
BG = (16, 16, 16, 255)        # #101010
FG = (244, 242, 237, 255)     # #F4F2ED
AC = (62, 158, 112, 255)      # #3E9E70

# --- 24'lük ızgara geometrisi (js/icons.js + icon.svg ile birebir) ---------
STEM_L, STEM_R = 6.3, 9.5     # dikey kol
CAP_T, CAP_B = 4.3, 18.3      # büyük harf yüksekliği (14.0)
FOOT_T, FOOT_R = 15.1, 17.3   # yatay ayak
RADIUS = 0.40                 # köşe yarıçapı
DOT_X, DOT_Y, DOT_R = 18.4, 6.5, 2.4

# icon.svg'deki dönüşüm: translate(256 256) scale(21) translate(-13.55 -11.2)
CX, CY, K = 13.55, 11.2, 21.0


def draw(size, scale=1.0, maskable=False):
    """24'lük ızgarayı hedef boyuta ölçeklendirir.

    maskable=True ise çizim %72'ye küçültülür; Android ikonu daire/kovan
    biçiminde kırptığı için güvenli alanda kalması gerekir.
    """
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)

    s = size / 512.0 * scale
    off = (size - 512 * s) / 2.0

    def X(v):
        return off + (256 + (v - CX) * K) * s

    def Y(v):
        return off + (256 + (v - CY) * K) * s

    # L: dikey kol + yatay ayak. İki yuvarlatılmış dikdörtgenin birleşimi
    # tam olarak L'yi verir; iç köşedeki yarıçaplar birleşimde kaybolur.
    r = RADIUS * K * s
    d.rounded_rectangle([X(STEM_L), Y(CAP_T), X(STEM_R), Y(CAP_B)], radius=r, fill=FG)
    d.rounded_rectangle([X(STEM_L), Y(FOOT_T), X(FOOT_R), Y(CAP_B)], radius=r, fill=FG)

    # vurgu noktası
    d.ellipse(
        [X(DOT_X - DOT_R), Y(DOT_Y - DOT_R), X(DOT_X + DOT_R), Y(DOT_Y + DOT_R)],
        fill=AC,
    )

    return img


targets = [
    ("icon-192.png", 192, 1.0, False),
    ("icon-512.png", 512, 1.0, False),
    ("icon-maskable-512.png", 512, 0.72, True),
]

for name, size, scale, maskable in targets:
    out = os.path.join(HERE, name)
    draw(size, scale, maskable).save(out, "PNG", optimize=True)
    print("yazildi: %-26s %dx%d  %6.1f KB" % (name, size, size, os.path.getsize(out) / 1024))
