# -*- coding: utf-8 -*-
"""Pidır sidecar — PyMuPDF ile ağır PDF düzenleme.

Kullanım: python pidir_sidecar.py <girdi.pdf> <cikti.pdf> <istek-json>
İstek örnekleri:
  {"cmd": "rotate", "pageIndex": 0, "degrees": 90}
  {"cmd": "sadelestir", "topMm": 18, "bottomMm": 18}
"""
import json
import sys

import fitz

MM_TO_PT = 72 / 25.4


def cmd_rotate(doc: fitz.Document, req: dict) -> None:
    page = doc[int(req["pageIndex"])]
    page.set_rotation((page.rotation + int(req.get("degrees", 90))) % 360)


def cmd_sadelestir(doc: fitz.Document, req: dict) -> None:
    """Her sayfanın üst/alt kenar bandındaki metni kalıcı siler (header/footer).

    Kenar-sabitleme: üst bantta üst-kenarı (y0) banda düşen kelime = header,
    alt bantta alt-kenarı (y1) banda düşen kelime = footer. Böylece bandın iç
    kenarını taşan (ör. %5 örtüşen) header/footer da yakalanır — eski %70-alan
    eşiği bunları KAÇIRIYORDU (gizli metin sızıntısı)."""
    top = float(req.get("topMm", 18)) * MM_TO_PT
    bottom = float(req.get("bottomMm", 18)) * MM_TO_PT
    for page in doc:
        r = page.rect
        bands = []  # (rect, is_top)
        if top > 0:
            bands.append((fitz.Rect(r.x0, r.y0, r.x1, r.y0 + top), True))
        if bottom > 0:
            bands.append((fitz.Rect(r.x0, r.y1 - bottom, r.x1, r.y1), False))
        added = False
        for band, is_top in bands:
            for word in page.get_text("words", clip=band):
                rect = fitz.Rect(word[:4])
                if (band & rect).is_empty:
                    continue
                anchored = rect.y0 <= band.y1 if is_top else rect.y1 >= band.y0
                if band.contains(rect) or anchored:
                    page.add_redact_annot(rect)
                    added = True
        if added:
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)


COMMANDS = {"rotate": cmd_rotate, "sadelestir": cmd_sadelestir}


def main() -> int:
    if len(sys.argv) != 4:
        print("kullanım: pidir_sidecar.py <girdi> <cikti> <istek-json>", file=sys.stderr)
        return 2
    in_path, out_path, raw = sys.argv[1], sys.argv[2], sys.argv[3]
    req = json.loads(raw)
    handler = COMMANDS.get(req.get("cmd"))
    if handler is None:
        print(f"bilinmeyen komut: {req.get('cmd')}", file=sys.stderr)
        return 2
    doc = fitz.open(in_path)
    try:
        handler(doc, req)
        doc.save(out_path, garbage=3, deflate=True)
    finally:
        doc.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
