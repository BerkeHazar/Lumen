"""icons/ içindeki PWA ikonlarını SVG ile aynı geometriden üretir."""
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


def draw(size, scale=1.0, maskable=False):
    """512 tabanlı koordinatlari hedef boyuta olceklendirir.

    maskable=True ise cizim %72'ye kucultulur; Android ikonu daire/kovan
    biciminde kirptigi icin guvenli alanda kalmasi gerekir.
    """
    img = Image.new("RGBA", (size, size), BG if not maskable else BG)
    d = ImageDraw.Draw(img)

    k = size / 512.0 * scale
    ox = oy = (size - 512 * k) / 2.0

    def X(v):
        return ox + v * k

    def Y(v):
        return oy + v * k

    # L govdesi: dikey kol + yatay ayak
    d.rectangle([X(168), Y(116), X(216), Y(356)], fill=FG)
    d.rectangle([X(168), Y(312), X(352), Y(356)], fill=FG)

    # vurgu noktasi
    d.ellipse([X(352 - 23), Y(150 - 23), X(352 + 23), Y(150 + 23)], fill=AC)

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
