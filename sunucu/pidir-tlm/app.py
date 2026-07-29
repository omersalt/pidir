#!/usr/bin/env python3
"""Pidır telemetri toplayıcı — yalnız Python standart kütüphanesi.

Neden stdlib: bisiler kutusunda framework bağımlılığı olan her servis, güncelleme
gerektiren bir yüzey daha demek. Bu uç yalnız JSON alıp diske yazıyor; FastAPI'nin
getireceği hiçbir şeye ihtiyacı yok. Aynı gerekçeyle `kapibekci` de stdlib.

Uçlar:
  POST /pidir/tlm      → olay paketi al, JSONL'e ekle
  GET  /pidir/tlm/ozet → basit sayaç özeti (kaç kurulum, kaç olay, sürüm dağılımı)
  GET  /pidir/saglik   → canlılık

Veri düzeni: /veri/olaylar-YYYY-AA.jsonl (aylık dosya; tek dosya sonsuz büyümesin).
Her satır: istemcinin gönderdiği olay + sunucunun eklediği `_ip`, `_alindi`.
"""

import json
import os
import threading
from collections import Counter
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERI = Path(os.environ.get("PIDIR_TLM_VERI", "/veri"))
PORT = int(os.environ.get("PIDIR_TLM_PORT", "8099"))
# Tek istekte kabul edilen en büyük gövde. İstemci 50 olayda bir gönderiyor;
# 1 MB fazlasıyla yeter ve şişirilmiş gövdeyle disk doldurmayı engeller.
MAX_GOVDE = 1024 * 1024

_kilit = threading.Lock()


def _dosya() -> Path:
    ay = datetime.now(timezone.utc).strftime("%Y-%m")
    return VERI / f"olaylar-{ay}.jsonl"


def _istemci_ip(handler: BaseHTTPRequestHandler) -> str:
    # Traefik arkasındayız; gerçek istemci X-Forwarded-For'un İLK öğesinde.
    xff = handler.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return handler.client_address[0]


def _yaz(olaylar: list, ip: str) -> int:
    simdi = datetime.now(timezone.utc).isoformat()
    satirlar = []
    for o in olaylar:
        if not isinstance(o, dict):
            continue
        o["_ip"] = ip
        o["_alindi"] = simdi
        satirlar.append(json.dumps(o, ensure_ascii=False))
    if not satirlar:
        return 0
    VERI.mkdir(parents=True, exist_ok=True)
    # Kilit: ThreadingHTTPServer eşzamanlı istekleri ayrı iş parçacığında işler;
    # araya giren yazım satırları bölerse JSONL bozulur.
    with _kilit:
        with open(_dosya(), "a", encoding="utf-8") as f:
            f.write("\n".join(satirlar) + "\n")
    return len(satirlar)


def _ozet() -> dict:
    kurulumlar, surumler, olaylar = set(), Counter(), Counter()
    toplam = 0
    for p in sorted(VERI.glob("olaylar-*.jsonl")):
        try:
            with open(p, encoding="utf-8") as f:
                for satir in f:
                    try:
                        o = json.loads(satir)
                    except json.JSONDecodeError:
                        continue
                    toplam += 1
                    if k := o.get("kurulumKimligi"):
                        kurulumlar.add(k)
                    if s := o.get("surum"):
                        surumler[s] += 1
                    if a := o.get("olay"):
                        olaylar[a] += 1
        except OSError:
            continue
    return {
        "toplamOlay": toplam,
        "benzersizKurulum": len(kurulumlar),
        "surumler": dict(surumler.most_common(20)),
        "olaylar": dict(olaylar.most_common(30)),
    }


class Isleyici(BaseHTTPRequestHandler):
    server_version = "pidir-tlm/1.0"

    def _cevap(self, kod: int, govde: dict) -> None:
        ham = json.dumps(govde, ensure_ascii=False).encode("utf-8")
        self.send_response(kod)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(ham)))
        self.end_headers()
        self.wfile.write(ham)

    def do_GET(self) -> None:
        yol = self.path.split("?")[0].rstrip("/")
        if yol in ("/pidir/saglik", "/saglik"):
            self._cevap(200, {"durum": "canli"})
        elif yol in ("/pidir/tlm/ozet", "/tlm/ozet"):
            self._cevap(200, _ozet())
        else:
            self._cevap(404, {"hata": "yok"})

    def do_POST(self) -> None:
        yol = self.path.split("?")[0].rstrip("/")
        if yol not in ("/pidir/tlm", "/tlm"):
            self._cevap(404, {"hata": "yok"})
            return
        try:
            uzunluk = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._cevap(400, {"hata": "uzunluk"})
            return
        if uzunluk <= 0 or uzunluk > MAX_GOVDE:
            self._cevap(413, {"hata": "govde boyutu"})
            return
        try:
            paket = json.loads(self.rfile.read(uzunluk).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._cevap(400, {"hata": "gecersiz json"})
            return

        olaylar = paket.get("olaylar") if isinstance(paket, dict) else None
        if not isinstance(olaylar, list):
            self._cevap(400, {"hata": "olaylar dizisi yok"})
            return
        # Paket düzeyindeki kimlik alanlarını her olaya kopyala ki tek satır
        # kendi başına anlamlı olsun (sonradan birleştirme derdi olmasın).
        ortak = {
            k: v
            for k, v in paket.items()
            if k != "olaylar" and isinstance(v, (str, int, float, bool, list))
        }
        for o in olaylar:
            if isinstance(o, dict):
                for k, v in ortak.items():
                    o.setdefault(k, v)

        yazilan = _yaz(olaylar[:500], _istemci_ip(self))
        self._cevap(200, {"alindi": yazilan})

    def log_message(self, bicim: str, *args) -> None:
        # Varsayılan erişim kaydı her isteğin yolunu stderr'e döküyor; konteyner
        # kaydını şişirmesin diye susturuldu. Hatalar zaten yanıt kodunda.
        pass


def main() -> None:
    VERI.mkdir(parents=True, exist_ok=True)
    sunucu = ThreadingHTTPServer(("0.0.0.0", PORT), Isleyici)
    print(f"pidir-tlm dinliyor: 0.0.0.0:{PORT} veri={VERI}", flush=True)
    sunucu.serve_forever()


if __name__ == "__main__":
    main()
