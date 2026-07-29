# -*- coding: utf-8 -*-
"""Pidır — DOCX görüntüleyici köprüsü.

DOCX'i PDF'e çevirir; Pidır onu normal bir PDF gibi açar. Böylece arama,
yakınlaştırma, işaretleme, OCR — bütün mevcut yetenekler docx'te de çalışır.

Yol: docx → (mammoth) → HTML → (PyMuPDF Story) → PDF
Harici program GEREKTİRMEZ. LibreOffice/Word kurulu olmasa da çalışır.

Kullanım:
    python pidir_docx.py <girdi.docx> <cikti.pdf> [json-ayar]
    python pidir_docx.py --saha
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import fitz

MM = 72 / 25.4
A4 = fitz.paper_rect("a4")

# Word'den gelen HTML'i basılabilir hale getiren asgari biçem.
# Story sınırlı CSS anlar: yazı tipi, boyut, ağırlık, hizalama, kenar boşluğu.
BICEM = """
  body   { font-family: sans-serif; font-size: 10.5pt; line-height: 1.45; }
  h1     { font-size: 18pt; margin: 14pt 0 6pt; }
  h2     { font-size: 14pt; margin: 12pt 0 5pt; }
  h3     { font-size: 12pt; margin: 10pt 0 4pt; }
  p      { margin: 0 0 6pt; }
  li     { margin: 0 0 3pt; }
  table  { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #999; padding: 3pt 5pt; font-size: 9.5pt; }
  th     { background: #eee; }
  img    { max-width: 100%; }
  pre    { font-family: monospace; font-size: 9pt; background: #f4f4f4; padding: 4pt; }
"""


def docx_html(kaynak: Path) -> tuple[str, list[str]]:
    """DOCX'i HTML'e çevirir. Görseller data: URI olarak gömülür."""
    import mammoth

    with open(kaynak, "rb") as f:
        sonuc = mammoth.convert_to_html(f)
    uyarilar = [m.message for m in sonuc.messages]
    return sonuc.value, uyarilar


def html_pdf(html: str, hedef: Path, ayar: dict | None = None) -> int:
    """HTML'i sayfalara akıtıp PDF yazar. Dönen değer: sayfa sayısı."""
    ayar = ayar or {}
    kenar = float(ayar.get("kenarMm", 18)) * MM
    sayfa = fitz.paper_rect(ayar.get("kagit", "a4"))
    alan = sayfa + (kenar, kenar, -kenar, -kenar)

    hikaye = fitz.Story(html=f"<style>{BICEM}</style>{html}")
    yazici = fitz.DocumentWriter(str(hedef))
    n = 0
    while True:
        aygit = yazici.begin_page(sayfa)
        # place() DEVAMI VAR MI döndürür (more), "bitti" değil — ters okumak
        # sonsuz döngüye sokuyor.
        devam, _ = hikaye.place(alan)
        hikaye.draw(aygit)
        yazici.end_page()
        n += 1
        if not devam:
            break
        if n > 2000:                      # kaçak döngü koruması
            raise RuntimeError("sayfa sınırı aşıldı (2000)")
    yazici.close()
    return n


def cevir(kaynak: Path, hedef: Path, ayar: dict | None = None) -> dict:
    html, uyarilar = docx_html(kaynak)
    if not html.strip():
        raise RuntimeError("belge boş veya okunamadı")
    sayfa = html_pdf(html, hedef, ayar)
    return {"ok": True, "sayfa": sayfa, "uyari": uyarilar[:20],
            "boyut": hedef.stat().st_size}


# ─────────────────────────── saha testi ───────────────────────────

def _ornek_docx(yol: Path) -> Path:
    """Gerçek bir .docx üretir — OOXML'i elle kurar, python-docx gerekmez."""
    import zipfile

    govde = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Pidır DOCX Sınaması</w:t></w:r></w:p>
<w:p><w:r><w:t>Türkçe karakterler: ığüşöçİĞÜŞÖÇ — düzgün görünmeli.</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Kalın metin. </w:t></w:r>
     <w:r><w:rPr><w:i/></w:rPr><w:t>Eğik metin.</w:t></w:r></w:p>
<w:p><w:r><w:t>ARANACAK_ANAHTAR_KELIME</w:t></w:r></w:p>
</w:body></w:document>"""
    tipler = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""
    kok_rel = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""
    with zipfile.ZipFile(yol, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", tipler)
        z.writestr("_rels/.rels", kok_rel)
        z.writestr("word/document.xml", govde)
    return yol


def saha_testi() -> int:
    """Gerçek bir docx üretip PDF'e çevirir ve çıktının okunabilirliğini ölçer."""
    import tempfile

    print("SAHA TESTİ — DOCX → PDF")
    gecici = Path(tempfile.mkdtemp(prefix="pidir_docx_"))
    kaynak = _ornek_docx(gecici / "sinama.docx")
    hedef = gecici / "sinama.pdf"

    try:
        sonuc = cevir(kaynak, hedef)
    except Exception as e:
        print(f"  [HATA] dönüştürme çöktü: {e}")
        return 1

    b = fitz.open(hedef)
    metin = "\n".join(s.get_text() for s in b)
    px = b[0].get_pixmap(dpi=40)
    bos = px.is_unicolor
    b.close()

    kontroller = [
        ("PDF üretildi", hedef.exists() and sonuc["boyut"] > 800),
        ("sayfa var", sonuc["sayfa"] >= 1),
        ("başlık metni geçti", "Pidır DOCX Sınaması" in metin),
        ("Türkçe karakterler bozulmadı", "ığüşöçİĞÜŞÖÇ" in metin),
        ("aranabilir metin var", "ARANACAK_ANAHTAR_KELIME" in metin),
        ("sayfa boş değil", not bos),
    ]
    for ad, iyi in kontroller:
        print(f"  [{'OK ' if iyi else 'HATA'}] {ad}")
    tamam = all(i for _, i in kontroller)
    print(f"  çıktı: {sonuc['sayfa']} sayfa, {sonuc['boyut']/1024:.0f} KB")
    if sonuc["uyari"]:
        print(f"  dönüştürme uyarısı: {len(sonuc['uyari'])} adet")
    print("SONUÇ:", "GEÇTİ" if tamam else "KALDI")

    import shutil
    shutil.rmtree(gecici, ignore_errors=True)
    return 0 if tamam else 1


if __name__ == "__main__":
    if "--saha" in sys.argv:
        sys.exit(saha_testi())
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    ayar = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
    try:
        print(json.dumps(cevir(Path(sys.argv[1]), Path(sys.argv[2]), ayar), ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "hata": str(e)}, ensure_ascii=False))
        sys.exit(1)
