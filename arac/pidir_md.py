# -*- coding: utf-8 -*-
"""Pidır — Markdown küçük-resim (thumbnail) köprüsü.

.md dosyasını PDF'e çevirir; thumbnail DLL'i onun ilk sayfasını Windows'un
PDF motoruyla render eder. Böylece Explorer önizlemesi, uygulamanın gösterdiği
GitHub-tarzı görünüme YAKIN olur (Story sınırlı CSS anladığı için birebir değil).

Yol: md → (markdown lib) → HTML → (PyMuPDF Story) → PDF
Harici program GEREKTİRMEZ.

Kullanım:
    python pidir_md.py <girdi.md> <cikti.pdf> [json-ayar]
    python pidir_md.py --saha
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import fitz

MM = 72 / 25.4

# PyMuPDF Story sınırlı CSS anlar (yazı tipi, boyut, ağırlık, hizalama, kenar,
# kenarlık, arka plan). GitHub estetiğinin thumbnail'de görünür kısmını taşır.
BICEM = """
  body      { font-family: sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1f2328; }
  h1        { font-size: 19pt; margin: 12pt 0 7pt; border-bottom: 1px solid #d1d9e0; }
  h2        { font-size: 15pt; margin: 11pt 0 6pt; border-bottom: 1px solid #d1d9e0; }
  h3        { font-size: 12.5pt; margin: 9pt 0 4pt; }
  h4, h5    { font-size: 11pt; margin: 8pt 0 4pt; }
  p         { margin: 0 0 7pt; }
  ul, ol    { margin: 0 0 7pt; }
  li        { margin: 0 0 3pt; }
  blockquote{ margin: 0 0 7pt; padding: 0 8pt; color: #59636e; border-left: 3px solid #d1d9e0; }
  table     { border-collapse: collapse; }
  td, th    { border: 1px solid #d1d9e0; padding: 3pt 6pt; font-size: 9.5pt; }
  th        { background: #f6f8fa; font-weight: bold; }
  code      { font-family: monospace; font-size: 9.5pt; background: #eff1f3; }
  pre       { font-family: monospace; font-size: 9pt; background: #f6f8fa; padding: 5pt; }
  a         { color: #0969da; }
"""


def md_html(kaynak: Path) -> str:
    """.md'yi HTML'e çevirir (GFM alt kümesi: tablo, çitli kod, akıllı liste)."""
    import markdown

    metin = kaynak.read_text(encoding="utf-8", errors="replace")
    if metin and metin[0] == "﻿":
        metin = metin[1:]
    return markdown.markdown(
        metin,
        extensions=["tables", "fenced_code", "sane_lists", "nl2br"],
        output_format="html5",
    )


def html_pdf(html: str, hedef: Path, ayar: dict | None = None) -> int:
    """HTML'i sayfalara akıtıp PDF yazar. Dönen değer: sayfa sayısı."""
    ayar = ayar or {}
    kenar = float(ayar.get("kenarMm", 16)) * MM
    sayfa = fitz.paper_rect(ayar.get("kagit", "a4"))
    alan = sayfa + (kenar, kenar, -kenar, -kenar)

    hikaye = fitz.Story(html=f"<style>{BICEM}</style>{html}")
    yazici = fitz.DocumentWriter(str(hedef))
    n = 0
    while True:
        aygit = yazici.begin_page(sayfa)
        devam, _ = hikaye.place(alan)   # place() DEVAMI VAR MI döndürür (docx dersi)
        hikaye.draw(aygit)
        yazici.end_page()
        n += 1
        if not devam:
            break
        if n > 2000:
            raise RuntimeError("sayfa sınırı aşıldı (2000)")
    yazici.close()
    return n


def cevir(kaynak: Path, hedef: Path, ayar: dict | None = None) -> dict:
    html = md_html(kaynak)
    if not html.strip():
        html = "<p><i>(boş belge)</i></p>"   # boş .md'de bile geçerli PDF üret
    sayfa = html_pdf(html, hedef, ayar)
    return {"ok": True, "sayfa": sayfa, "boyut": hedef.stat().st_size}


# ─────────────────────────── saha testi ───────────────────────────

ORNEK = """# Pidır Markdown Sınaması

Türkçe karakterler: ığüşöçİĞÜŞÖÇ — düzgün görünmeli.

## Tablo

| Alet | Ton |
|---|---|
| Göğüs | 4,80 |
| Sırt | 4,92 |

- [x] Tamamlanan
- [ ] Bekleyen

```python
def selam(): return "ARANACAK_ANAHTAR_KELIME"
```
"""


def saha_testi() -> int:
    import tempfile

    print("SAHA TESTİ — Markdown → PDF")
    gecici = Path(tempfile.mkdtemp(prefix="pidir_md_"))
    kaynak = gecici / "sinama.md"
    kaynak.write_text(ORNEK, encoding="utf-8")
    hedef = gecici / "sinama.pdf"

    try:
        sonuc = cevir(kaynak, hedef)
    except Exception as e:
        print(f"  [HATA] dönüştürme çöktü: {e}")
        return 1

    b = fitz.open(hedef)
    metin = "\n".join(s.get_text() for s in b)
    bos = b[0].get_pixmap(dpi=40).is_unicolor
    b.close()

    kontroller = [
        ("PDF üretildi", hedef.exists() and sonuc["boyut"] > 800),
        ("sayfa var", sonuc["sayfa"] >= 1),
        ("başlık metni geçti", "Pidır Markdown Sınaması" in metin),
        ("Türkçe karakterler bozulmadı", "ığüşöçİĞÜŞÖÇ" in metin),
        ("tablo hücresi geçti", "Göğüs" in metin),
        ("kod bloğu metni geçti", "ARANACAK_ANAHTAR_KELIME" in metin),
        ("sayfa boş değil", not bos),
    ]
    for ad, iyi in kontroller:
        print(f"  [{'OK ' if iyi else 'HATA'}] {ad}")
    tamam = all(i for _, i in kontroller)
    print(f"  çıktı: {sonuc['sayfa']} sayfa, {sonuc['boyut']/1024:.0f} KB")
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
