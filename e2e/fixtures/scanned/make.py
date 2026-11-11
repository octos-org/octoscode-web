# Scanned-PDF fixtures for e2e/scanned-pdf.spec.ts (T-0568). Regenerate with
# `python3 make.py` (Pillow with libtiff and OpenJPEG, DejaVu Serif, Noto Serif CJK SC).
# Pages carry a scanner's look (slight rotation, blur, speckle) and no text layer.
import io, os, random, subprocess
from PIL import Image, ImageDraw, ImageFilter, ImageFont

here = os.path.dirname(os.path.abspath(__file__))
rng = random.Random(568)
DPI = 200
W, H = int(8.27 * DPI), int(5.8 * DPI)  # top half of an A4 page
latin = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", 34)
cjk_file = subprocess.run(["fc-match", "-f", "%{file}", "Noto Serif CJK SC"], capture_output=True, text=True).stdout
cjk = ImageFont.truetype(cjk_file, 38, index=2) if cjk_file.endswith(".ttc") else ImageFont.truetype(cjk_file, 38)
EN = [
    "Quarterly operations report - scanned copy",
    "Revenue for the quarter was 184,300 dollars, up 12.4 percent.",
    "The warehouse in Ningbo shipped 3,912 orders in October.",
]
ZH = [
    "第三季度运营报告（扫描件）",
    "宁波仓库十月共发出三千九百一十二个订单。",
    "新退货政策实施后，客户投诉由四十一件降至二十七件。",
]


def scan(lines, font):
    page = Image.new("L", (W, H), 250)
    draw = ImageDraw.Draw(page)
    for i, line in enumerate(lines):
        draw.text((DPI, int(0.8 * DPI) + i * int(font.size * 1.9)), line, fill=25, font=font)
    page = page.rotate(0.6, fillcolor=250, resample=Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.6))
    pixels = page.load()
    for _ in range(W * H // 400):
        pixels[rng.randrange(W), rng.randrange(H)] = rng.choice((60, 120, 200))
    return page


def save(image, name, **options):
    image.save(os.path.join(here, name), "PDF", resolution=options.pop("resolution", DPI), **options)


def jpx_pdf(image, name, dpi):
    """A one-page PDF around a grayscale JPEG 2000 stream (Pillow only writes JPX with alpha)."""
    stream = io.BytesIO()
    image.save(stream, "JPEG2000", quality_mode="rates", quality_layers=[24])
    data, (w, h) = stream.getvalue(), image.size
    pw, ph = w * 72 // dpi, h * 72 // dpi
    content = f"q {pw} 0 0 {ph} 0 0 cm /Im0 Do Q".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {pw} {ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>".encode(),
        f"<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /Filter /JPXDecode /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream",
        f"<< /Length {len(content)} >>\nstream\n".encode() + content + b"\nendstream",
    ]
    out, offsets = bytearray(b"%PDF-1.5\n"), []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    open(os.path.join(here, name), "wb").write(out)


# Black-and-white scans are CCITT G4 (Pillow writes mode "1" that way).
save(scan(EN, latin).point(lambda v: 255 if v > 140 else 0).convert("1"), "scan-en.pdf")
save(scan(ZH, cjk).point(lambda v: 255 if v > 140 else 0).convert("1"), "scan-zh.pdf")
jpx_pdf(scan(EN, latin).resize((W // 2, H // 2)), "scan-jpx.pdf", DPI // 2)
photo = Image.new("L", (W // 4, H // 4))
photo.putdata([(x * 7 // (W // 4) * 30 + y * 5 // (H // 4) * 20 + rng.randrange(40)) % 256 for y in range(H // 4) for x in range(W // 4)])
ImageDraw.Draw(photo).ellipse((100, 80, 260, 230), fill=200)
save(photo.filter(ImageFilter.GaussianBlur(2)).convert("RGB"), "photo.pdf", resolution=DPI // 4, quality=70)
for name in sorted(os.listdir(here)):
    print(name, os.path.getsize(os.path.join(here, name)))
