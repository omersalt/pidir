// DLL'i KAYIT YAPMADAN test eder: DLL'i yukler, class factory'den saglayici
// uretir, PDF'i IStream olarak verir, GetThumbnail cagirir, HBITMAP'i BMP'ye yazar.
//   host_test.exe <pdf> <cikti.bmp>
#include <windows.h>
#include <shlobj.h>
#include <thumbcache.h>
#include <shlwapi.h>
#include <cstdio>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "gdi32.lib")

// DLL ile AYNI CLSID
static const CLSID CLSID_PidirPdfThumb =
    { 0x5f2b7c10, 0x9a3d, 0x4e6f, { 0xb1, 0xc2, 0x7d, 0x8e, 0x9f, 0x0a, 0x1b, 0x2c } };

typedef HRESULT (__stdcall *PFN_DGCO)(REFCLSID, REFIID, void**);

static bool SaveHBITMAP(HBITMAP hb, const wchar_t* path) {
    BITMAP bm; if (!GetObjectW(hb, sizeof(bm), &bm)) return false;
    // DIB section top-down 32bpp bekliyoruz
    int w = bm.bmWidth, h = abs(bm.bmHeight);
    BITMAPFILEHEADER fh = {}; BITMAPINFOHEADER ih = {};
    ih.biSize = sizeof(ih); ih.biWidth = w; ih.biHeight = -h; ih.biPlanes = 1;
    ih.biBitCount = 32; ih.biCompression = BI_RGB;
    DWORD dataSize = w * h * 4;
    fh.bfType = 0x4D42;
    fh.bfOffBits = sizeof(fh) + sizeof(ih);
    fh.bfSize = fh.bfOffBits + dataSize;
    FILE* f = _wfopen(path, L"wb"); if (!f) return false;
    fwrite(&fh, 1, sizeof(fh), f);
    fwrite(&ih, 1, sizeof(ih), f);
    fwrite(bm.bmBits, 1, dataSize, f);
    fclose(f);
    return true;
}

int wmain(int argc, wchar_t** argv) {
    if (argc < 3) { wprintf(L"kullanim: host_test.exe <pdf> <bmp>\n"); return 2; }
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

    HMODULE m = LoadLibraryW(L"C:\\PidirDev\\thumb\\PidirPdfThumb.dll");
    if (!m) { wprintf(L"DLL yuklenemedi %lu\n", GetLastError()); return 1; }
    auto dgco = (PFN_DGCO)GetProcAddress(m, "DllGetClassObject");
    if (!dgco) { wprintf(L"DllGetClassObject yok\n"); return 1; }

    IClassFactory* cf = nullptr;
    HRESULT hr = dgco(CLSID_PidirPdfThumb, IID_PPV_ARGS(&cf));
    if (FAILED(hr)) { wprintf(L"factory 0x%08x\n", hr); return 1; }

    IUnknown* unk = nullptr;
    hr = cf->CreateInstance(nullptr, IID_IUnknown, (void**)&unk);
    if (FAILED(hr)) { wprintf(L"CreateInstance 0x%08x\n", hr); return 1; }

    IInitializeWithStream* iis = nullptr;
    hr = unk->QueryInterface(IID_PPV_ARGS(&iis));
    if (FAILED(hr)) { wprintf(L"QI IInitializeWithStream 0x%08x\n", hr); return 1; }

    IStream* s = nullptr;
    hr = SHCreateStreamOnFileEx(argv[1], STGM_READ | STGM_SHARE_DENY_WRITE,
                                FILE_ATTRIBUTE_NORMAL, FALSE, nullptr, &s);
    if (FAILED(hr)) { wprintf(L"stream 0x%08x\n", hr); return 1; }

    hr = iis->Initialize(s, STGM_READ);
    if (FAILED(hr)) { wprintf(L"Initialize 0x%08x\n", hr); return 1; }

    IThumbnailProvider* tp = nullptr;
    hr = unk->QueryInterface(IID_PPV_ARGS(&tp));
    if (FAILED(hr)) { wprintf(L"QI IThumbnailProvider 0x%08x\n", hr); return 1; }

    HBITMAP hb = nullptr; WTS_ALPHATYPE alpha;
    hr = tp->GetThumbnail(256, &hb, &alpha);
    if (FAILED(hr) || !hb) { wprintf(L"GetThumbnail 0x%08x\n", hr); return 1; }

    if (!SaveHBITMAP(hb, argv[2])) { wprintf(L"BMP yazilamadi\n"); return 1; }
    wprintf(L"OK: thumbnail uretildi (alpha=%d) -> %ls\n", (int)alpha, argv[2]);
    return 0;
}
