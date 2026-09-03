# Regenerates the statement fixtures beside this file. Run it only when one of
# them needs to change; the PDFs are committed so the suite needs nothing
# installed to run.
#
#   pip install reportlab pillow && python3 make-fixtures.py
#
# Four files, because a bank statement arrives in four shapes and the scanner
# has to tell them apart:
#
#   statement-plain.pdf     typed text, opens straight away
#   statement-locked.pdf    the same, behind the user password below
#   statement-scanned.pdf   one page, a picture of paper, no text layer at all
#   statement-mixed.pdf     a typed page and a scanned one in the same file
#   statement-long.pdf      ninety transactions over three pages — long enough
#                           that it has to be read in slices, which is the case
#                           that timed out when it was read in one
#
# The rows are deliberately the sort of thing a real statement carries: cryptic
# card descriptors, a salary credit with no debit column, and a large one-off.

import os
from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.lib import pdfencrypt
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
PASSWORD = 'bayt2026'

ROWS = [
    ("01 Aug 2026", "OPENING BALANCE", "", "12,430.00"),
    ("03 Aug 2026", "TAP*DUB4471 AE", "28.00", "12,402.00"),
    ("04 Aug 2026", "CARREFOUR MALL OF EMIRATES", "412.75", "11,989.25"),
    ("05 Aug 2026", "SALIK TOLL GATE", "4.00", "11,985.25"),
    ("07 Aug 2026", "TLB*ORDER 88213", "96.50", "11,888.75"),
    ("09 Aug 2026", "NETFLIX.COM AMSTERDAM", "56.00", "11,832.75"),
    ("12 Aug 2026", "DEWA UTILITY PAYMENT", "615.40", "11,217.35"),
    ("14 Aug 2026", "SALARY CREDIT ACME FZE", "", "31,217.35"),
    ("15 Aug 2026", "IKEA JEBEL ALI", "1,450.00", "29,767.35"),
    ("18 Aug 2026", "TAP*DUB4471 AE", "31.00", "29,736.35"),
    ("21 Aug 2026", "SPOTIFY P39A2B", "39.00", "29,697.35"),
    ("24 Aug 2026", "ADNOC STATION 118", "180.00", "29,517.35"),
    ("28 Aug 2026", "TALABAT DELIVERY", "77.25", "29,440.10"),
    ("31 Aug 2026", "CLOSING BALANCE", "", "29,440.10"),
]

W, H = A4


def typed_page(c):
    """Text in real columns, which is what the line rebuilding has to recover."""
    c.setFont("Helvetica-Bold", 15)
    c.drawString(50, H - 60, "Emirates Example Bank")
    c.setFont("Helvetica", 9)
    c.drawString(50, H - 76, "Current Account 04-11-887342  ·  AED")
    c.drawString(50, H - 89, "Statement period 01 Aug 2026 to 31 Aug 2026")

    y = H - 125
    c.setFont("Helvetica-Bold", 8.5)
    for x, label in ((50, "DATE"), (140, "DESCRIPTION"), (390, "DEBIT"), (480, "BALANCE")):
        c.drawString(x, y, label)
    c.line(50, y - 5, W - 50, y - 5)

    y -= 20
    c.setFont("Helvetica", 9)
    for date, desc, debit, bal in ROWS:
        c.drawString(50, y, date)
        c.drawString(140, y, desc)
        if debit:
            c.drawRightString(440, y, debit)
        c.drawRightString(545, y, bal)
        y -= 17


def paper_photo(path):
    """Pixels only. A PDF carrying this has no text layer to find."""
    img = Image.new("RGB", (1240, 1754), "white")
    d = ImageDraw.Draw(img)
    d.text((60, 60), "Emirates Example Bank  (scanned copy)", fill="black")
    d.text((60, 90), "Current Account 04-11-887342  ·  AED", fill="black")
    y = 150
    for date, desc, debit, bal in ROWS:
        d.text((60, y), f"{date}    {desc:<34}{debit:>10}{bal:>14}", fill="black")
        y += 34
    d.rectangle([40, 40, 1200, y + 20], outline="black")
    img.save(path)


def out(name):
    return os.path.join(HERE, name)


c = canvas.Canvas(out("statement-plain.pdf"), pagesize=A4)
typed_page(c)
c.save()

c = canvas.Canvas(
    out("statement-locked.pdf"),
    pagesize=A4,
    encrypt=pdfencrypt.StandardEncryption(PASSWORD, canPrint=0),
)
typed_page(c)
c.save()

scan = out("_scan.png")
paper_photo(scan)

c = canvas.Canvas(out("statement-scanned.pdf"), pagesize=A4)
c.drawImage(ImageReader(scan), 0, 0, width=W, height=H, preserveAspectRatio=True, anchor="c")
c.save()

c = canvas.Canvas(out("statement-mixed.pdf"), pagesize=A4)
c.setFont("Helvetica-Bold", 15)
c.drawString(50, H - 60, "Emirates Example Bank")
c.setFont("Helvetica", 9)
c.drawString(50, H - 80, "Statement period 01 Aug 2026 to 31 Aug 2026")
c.drawString(50, H - 95, "Transactions overleaf.")
c.showPage()
c.drawImage(ImageReader(scan), 0, 0, width=W, height=H, preserveAspectRatio=True, anchor="c")
c.save()

# Long enough to need slicing. The descriptions are numbered so the assembled
# rows can be checked for order as well as for count.
c = canvas.Canvas(out("statement-long.pdf"), pagesize=A4)
c.setFont("Helvetica-Bold", 15)
c.drawString(50, H - 60, "Emirates Example Bank")
c.setFont("Helvetica", 9)
c.drawString(50, H - 76, "Current Account 04-11-887342  ·  AED")
c.drawString(50, H - 89, "Statement period 01 Aug 2026 to 31 Aug 2026")
y = H - 125
c.setFont("Helvetica", 9)
for i in range(90):
    if y < 60:
        c.showPage()
        c.setFont("Helvetica", 9)
        y = H - 60
    day = (i % 28) + 1
    c.drawString(50, y, f"{day:02d} Aug 2026")
    c.drawString(140, y, f"MERCHANT NUMBER {i + 1:03d}")
    c.drawRightString(440, y, f"{(i + 1) * 1.5:.2f}")
    y -= 17
c.save()
print("wrote statement-long.pdf")

os.remove(scan)
print("fixtures rewritten in", HERE)
