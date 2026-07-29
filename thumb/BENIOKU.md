# PidÄ±r KÃ¼Ã§Ã¼k Resim SaÄŸlayÄ±cÄ±sÄ± (PDF + DOCX)

Windows Explorer'da **PDF ve DOCX** dosyalarÄ± jenerik ikon yerine **ilk sayfalarÄ±nÄ±n
kÃ¼Ã§Ã¼k resmini** gÃ¶sterir (Adobe/Edge gibi). Ã–mer'in PidÄ±r'Ä± iÃ§in (22.07.2026).

## Ne, nerede
- **Kaynak:** `C:\PidirDev\thumb\PidirPdfThumb.cpp` (tek dosya COM DLL, C++/WinRT)
- **KayÄ±tlÄ± DLL:** `%LOCALAPPDATA%\Pidir\PidirPdfThumb.dll`
- **docxâ†’PDF hattÄ±:** `%LOCALAPPDATA%\Pidir\pidir_docx.py` (PidÄ±r'Ä±nkinin kopyasÄ±; mammoth+PyMuPDF)
- **Cache:** `%LOCALAPPDATA%\Pidir\docxcache\<hash>_<boyut>.pdf`
- **CLSID:** `{5F2B7C10-9A3D-4E6F-B1C2-7D8E9F0A1B2C}`
- **Ayar (kayÄ±t):** `HKCU\Software\Pidir\Thumb` â†’ `PythonExe`, `Script`

## NasÄ±l Ã§alÄ±ÅŸÄ±r
1. Explorer dosyayÄ± `IInitializeWithStream` ile verir â†’ tÃ¼m baytlar belleÄŸe okunur.
2. `GetThumbnail(cx)`: baÅŸlÄ±k koklanÄ±r â€” `%PDF` ise doÄŸrudan; `PK\x03\x04` (docx) ise
   Ã¶nce `python -X utf8 pidir_docx.py in.docx out.pdf` ile PDF'e Ã§evrilir (cache'li).
3. PDF, **Windows.Data.Pdf** (OS motoru) ile ilk sayfa PNG'ye render edilir (ayrÄ± MTA thread).
4. WIC ile PNG â†’ 32bpp HBITMAP â†’ Explorer'a dÃ¶ner.

## Yeniden derleme
```
cmd /c C:\PidirDev\thumb\build_dll.bat        REM -> PidirPdfThumb.dll
```
(VS2022 Community MSVC gerekir; `vcvars64.bat` betikte Ã§aÄŸrÄ±lÄ±r. KÄ±sa yol ÅžART â€” MAX_PATH.)

## Kaydetme / kaldÄ±rma (YÃ–NETÄ°CÄ° GEREKMEZ â€” HKCU)
```
regsvr32 /s "%LOCALAPPDATA%\Pidir\PidirPdfThumb.dll"      REM kaydet
regsvr32 /u /s "%LOCALAPPDATA%\Pidir\PidirPdfThumb.dll"   REM kaldÄ±r
```
DLL gÃ¼ncellerken kilitliyse Ã¶nce `Stop-Process prevhost` (Explorer Ã¶nizleme surrogate'Ä±).

## Testler (izole-Ã¶nce disiplini)
- `render_test.exe <pdf> <bmp>` â€” sadece OS PDF render (COM'suz)
- `host_test.exe <pdf|docx> <bmp>` â€” DLL'i KAYITSIZ yÃ¼kle, tÃ¼m COM+Ã§eviri+render zinciri
- CanlÄ±: klasÃ¶re koy, bÃ¼yÃ¼k simge gÃ¶rÃ¼nÃ¼mÃ¼, ilk sayfalar ikon olur.

## Notlar
- Windows Ã¶nizlemeleri cache'ler; eskiden gÃ¶rÃ¼lmÃ¼ÅŸ dosyalar iÃ§in thumbnail cache temizle
  + Explorer yeniden baÅŸlat gerekebilir.
- docx fidelity = PidÄ±r'Ä±n kendi docx gÃ¶rÃ¼nÃ¼mÃ¼yle aynÄ± (aynÄ± mammoth+PyMuPDF hattÄ±).
