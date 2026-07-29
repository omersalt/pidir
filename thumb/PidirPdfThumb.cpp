// PidirPdfThumb.dll — Windows kabuk KUCUK RESIM saglayicisi (IThumbnailProvider).
// PDF dosyalarinin ILK SAYFASINI, Windows'un kendi PDF motoruyla (Windows.Data.Pdf,
// Edge kalitesi) render edip Explorer'da ikon/onizleme olarak gosterir.
//
// Tasarim notlari:
//  - Shell dosyayi IInitializeWithStream ile bir IStream olarak verir.
//  - Kilitlenmeyi onlemek icin: baytlar shell thread'inde bellege okunur, tum
//    WinRT+render+WIC isi AYRI bir MTA thread'inde yapilir (apartment izolasyonu).
//  - WinRT render -> PNG stream -> WIC ile 32bpp PBGRA HBITMAP.
//  - Kayit: .pdf\ShellEx\{e357fccd-...} = bizim CLSID (uzanti seviyesi -> tum PDF'ler).

#include <windows.h>
#include <shlobj.h>          // IThumbnailProvider, IInitializeWithStream, WTS_ALPHATYPE
#include <thumbcache.h>
#include <wincodec.h>        // WIC
#include <shlwapi.h>
#include <new>
#include <vector>
#include <thread>
#include <string>
#include <cstdio>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Data.Pdf.h>

#pragma comment(lib, "windowsapp.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "shell32.lib")

using namespace winrt;
using namespace winrt::Windows::Data::Pdf;
using namespace winrt::Windows::Storage::Streams;

// ---- Bizim saglayici CLSID'imiz (sabit) --------------------------------------
// {5F2B7C10-9A3D-4E6F-B1C2-7D8E9F0A1B2C}
static const CLSID CLSID_PidirPdfThumb =
    { 0x5f2b7c10, 0x9a3d, 0x4e6f, { 0xb1, 0xc2, 0x7d, 0x8e, 0x9f, 0x0a, 0x1b, 0x2c } };
static const wchar_t* kFriendly = L"Pidir PDF Kucuk Resim Saglayicisi";
// IThumbnailProvider kabuk uzantisi GUID'i (Windows sabiti)
static const wchar_t* kThumbHandlerGuid = L"{e357fccd-a995-4576-b01f-234630154e96}";

static long g_dllRefs = 0;
static HINSTANCE g_hInst = nullptr;

// ============================ Dosya/kayit/surec yardimcilari ==================
static bool ReadFileBytes(const std::wstring& path, std::vector<BYTE>& out) {
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    LARGE_INTEGER sz; GetFileSizeEx(h, &sz);
    out.resize((size_t)sz.QuadPart);
    DWORD got = 0; bool ok = true;
    if (sz.QuadPart > 0) ok = ReadFile(h, out.data(), (DWORD)sz.QuadPart, &got, nullptr) && got == sz.QuadPart;
    CloseHandle(h);
    return ok;
}
static bool WriteFileBytes(const std::wstring& path, const std::vector<BYTE>& data) {
    HANDLE h = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    DWORD wrote = 0; bool ok = WriteFile(h, data.data(), (DWORD)data.size(), &wrote, nullptr) && wrote == data.size();
    CloseHandle(h);
    return ok;
}
static std::wstring GetRegStr(const wchar_t* sub, const wchar_t* name) {
    HKEY k; wchar_t buf[1024]; DWORD cb = sizeof(buf), type = 0;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, sub, 0, KEY_READ, &k) != ERROR_SUCCESS) return L"";
    LONG r = RegQueryValueExW(k, name, nullptr, &type, (BYTE*)buf, &cb);
    RegCloseKey(k);
    if (r != ERROR_SUCCESS || type != REG_SZ) return L"";
    return std::wstring(buf);
}
static uint64_t Fnv1a(const std::vector<BYTE>& b) {
    uint64_t h = 1469598103934665603ull;
    for (BYTE c : b) { h ^= c; h *= 1099511628211ull; }
    return h;
}
static std::wstring LocalPidirDir() {
    wchar_t base[MAX_PATH];
    if (FAILED(SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, base))) return L"";
    return std::wstring(base) + L"\\Pidir";
}
// Alt sureci calistir, cikis kodu 0 ise true. Pencere yok, zaman asimi (ms).
static bool RunProcess(const std::wstring& cmdline, DWORD timeoutMs) {
    std::vector<wchar_t> cmd(cmdline.begin(), cmdline.end()); cmd.push_back(0);
    STARTUPINFOW si = { sizeof(si) }; PROCESS_INFORMATION pi = {};
    si.dwFlags = STARTF_USESHOWWINDOW; si.wShowWindow = SW_HIDE;
    if (!CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE,
                        CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) return false;
    DWORD w = WaitForSingleObject(pi.hProcess, timeoutMs);
    DWORD code = 1;
    if (w == WAIT_OBJECT_0) GetExitCodeProcess(pi.hProcess, &code);
    else TerminateProcess(pi.hProcess, 1);
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    return w == WAIT_OBJECT_0 && code == 0;
}

// DOCX baytlarini PDF baytlarina cevirir (Pidir'in pidir_docx.py hatti).
// Icerik hash'iyle cache'lenir -> ayni docx bir daha Python calistirmaz.
static HRESULT ConvertDocxToPdf(const std::vector<BYTE>& docx, std::vector<BYTE>& outPdf) {
    std::wstring dir = LocalPidirDir();
    if (dir.empty()) return E_FAIL;
    std::wstring cacheDir = dir + L"\\docxcache";
    SHCreateDirectoryExW(nullptr, cacheDir.c_str(), nullptr);

    wchar_t key[80];
    swprintf_s(key, L"%016llx_%zu", (unsigned long long)Fnv1a(docx), docx.size());
    std::wstring cachePdf = cacheDir + L"\\" + key + L".pdf";

    // 1) cache tutuyor mu?
    if (ReadFileBytes(cachePdf, outPdf) && outPdf.size() > 800) return S_OK;

    // 2) python + script kayittan
    std::wstring py = GetRegStr(L"Software\\Pidir\\Thumb", L"PythonExe");
    std::wstring script = GetRegStr(L"Software\\Pidir\\Thumb", L"Script");
    if (py.empty() || script.empty()) return E_FAIL;

    // 3) gecici docx yaz, PDF'i dogrudan cache yoluna uret
    std::wstring tmpDocx = cacheDir + L"\\" + key + L".docx";
    if (!WriteFileBytes(tmpDocx, docx)) return E_FAIL;

    // -X utf8 -> cocuk stdout'u cp1252'de cokmesin (Turkce uyarilar)
    std::wstring cmd = L"\"" + py + L"\" -X utf8 \"" + script + L"\" \"" + tmpDocx + L"\" \"" + cachePdf + L"\"";
    bool ok = RunProcess(cmd, 30000);
    DeleteFileW(tmpDocx.c_str());
    if (!ok) { DeleteFileW(cachePdf.c_str()); return E_FAIL; }

    if (!ReadFileBytes(cachePdf, outPdf) || outPdf.size() < 800) return E_FAIL;
    return S_OK;
}

// ============================ Render cekirdegi ================================
// Bellekteki PDF baytlarindan ilk sayfayi 'cx' sinir kutusuna render eder,
// 32bpp PBGRA HBITMAP dondurur. Ayri MTA thread'inde cagrilir.
static HRESULT RenderFirstPageToHBITMAP(const std::vector<BYTE>& pdfBytes,
                                        UINT cx, HBITMAP* phbmp) {
    *phbmp = nullptr;
    try {
        // 1) Baytlari WinRT bellek akisina yaz
        InMemoryRandomAccessStream inStream;
        {
            DataWriter w(inStream);
            w.WriteBytes(array_view<uint8_t const>(pdfBytes.data(),
                          pdfBytes.data() + pdfBytes.size()));
            w.StoreAsync().get();
            w.DetachStream();
        }
        inStream.Seek(0);

        // 2) PDF'i yukle, ilk sayfayi al
        PdfDocument doc = PdfDocument::LoadFromStreamAsync(inStream).get();
        if (doc.PageCount() == 0) return E_FAIL;
        PdfPage page = doc.GetPage(0);
        auto sz = page.Size();

        // 3) En uzun kenar 'cx' olacak sekilde PNG render et
        InMemoryRandomAccessStream png;
        PdfPageRenderOptions opts;
        if (sz.Width >= sz.Height) opts.DestinationWidth(cx);
        else                       opts.DestinationHeight(cx);
        page.RenderToStreamAsync(png, opts).get();

        // 4) PNG baytlarini oku
        uint64_t total = png.Size();
        DataReader r(png.GetInputStreamAt(0));
        r.LoadAsync((uint32_t)total).get();
        std::vector<BYTE> pngBytes((size_t)total);
        r.ReadBytes(array_view<uint8_t>(pngBytes.data(), pngBytes.data() + pngBytes.size()));

        // 5) WIC ile PNG -> 32bpp PBGRA -> HBITMAP (DIB section)
        com_ptr<IWICImagingFactory> wic;
        HRESULT hr = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                                      IID_PPV_ARGS(wic.put()));
        if (FAILED(hr)) return hr;

        com_ptr<IWICStream> ws; hr = wic->CreateStream(ws.put()); if (FAILED(hr)) return hr;
        hr = ws->InitializeFromMemory(pngBytes.data(), (DWORD)pngBytes.size()); if (FAILED(hr)) return hr;

        com_ptr<IWICBitmapDecoder> dec;
        hr = wic->CreateDecoderFromStream(ws.get(), nullptr, WICDecodeMetadataCacheOnDemand, dec.put());
        if (FAILED(hr)) return hr;
        com_ptr<IWICBitmapFrameDecode> frame;
        hr = dec->GetFrame(0, frame.put()); if (FAILED(hr)) return hr;

        com_ptr<IWICFormatConverter> conv;
        hr = wic->CreateFormatConverter(conv.put()); if (FAILED(hr)) return hr;
        hr = conv->Initialize(frame.get(), GUID_WICPixelFormat32bppPBGRA,
                              WICBitmapDitherTypeNone, nullptr, 0.0, WICBitmapPaletteTypeCustom);
        if (FAILED(hr)) return hr;

        UINT w = 0, h = 0; conv->GetSize(&w, &h);
        if (w == 0 || h == 0) return E_FAIL;

        BITMAPINFO bmi = {};
        bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        bmi.bmiHeader.biWidth = (LONG)w;
        bmi.bmiHeader.biHeight = -(LONG)h;   // top-down
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;

        void* bits = nullptr;
        HBITMAP hbmp = CreateDIBSection(nullptr, &bmi, DIB_RGB_COLORS, &bits, nullptr, 0);
        if (!hbmp) return E_OUTOFMEMORY;

        hr = conv->CopyPixels(nullptr, w * 4, w * h * 4, (BYTE*)bits);
        if (FAILED(hr)) { DeleteObject(hbmp); return hr; }

        *phbmp = hbmp;
        return S_OK;
    } catch (hresult_error const& e) {
        return (HRESULT)e.code();
    } catch (...) {
        return E_FAIL;
    }
}

// ============================ COM sinifi ======================================
class PdfThumbProvider : public IInitializeWithStream, public IThumbnailProvider {
public:
    PdfThumbProvider() : m_ref(1) { InterlockedIncrement(&g_dllRefs); }
    ~PdfThumbProvider() { InterlockedDecrement(&g_dllRefs); }

    // IUnknown
    IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        static const QITAB qit[] = {
            QITABENT(PdfThumbProvider, IInitializeWithStream),
            QITABENT(PdfThumbProvider, IThumbnailProvider),
            { 0 },
        };
        return QISearch(this, qit, riid, ppv);
    }
    IFACEMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&m_ref); }
    IFACEMETHODIMP_(ULONG) Release() {
        ULONG r = InterlockedDecrement(&m_ref);
        if (r == 0) delete this;
        return r;
    }

    // IInitializeWithStream
    IFACEMETHODIMP Initialize(IStream* pstream, DWORD) {
        if (m_stream) return HRESULT_FROM_WIN32(ERROR_ALREADY_INITIALIZED);
        // Butun akisi bellege oku (cross-apartment marshalling'den kacinmak icin)
        LARGE_INTEGER zero = {}; pstream->Seek(zero, STREAM_SEEK_SET, nullptr);
        STATSTG st = {};
        if (SUCCEEDED(pstream->Stat(&st, STATFLAG_NONAME)) && st.cbSize.QuadPart > 0
            && st.cbSize.QuadPart < (64ll * 1024 * 1024)) {
            m_bytes.reserve((size_t)st.cbSize.QuadPart);
        }
        BYTE buf[65536]; ULONG got = 0;
        while (SUCCEEDED(pstream->Read(buf, sizeof(buf), &got)) && got > 0)
            m_bytes.insert(m_bytes.end(), buf, buf + got);
        m_stream = true;
        return m_bytes.empty() ? E_FAIL : S_OK;
    }

    // IThumbnailProvider
    IFACEMETHODIMP GetThumbnail(UINT cx, HBITMAP* phbmp, WTS_ALPHATYPE* pdwAlpha) {
        *phbmp = nullptr; *pdwAlpha = WTSAT_ARGB;
        if (m_bytes.size() < 4) return E_FAIL;

        // Icerik basligindan tur belirle: "%PDF" -> pdf, "PK\x03\x04" (zip) -> docx
        bool isPdf = m_bytes[0] == '%' && m_bytes[1] == 'P' && m_bytes[2] == 'D' && m_bytes[3] == 'F';
        bool isZip = m_bytes[0] == 'P' && m_bytes[1] == 'K' && m_bytes[2] == 3 && m_bytes[3] == 4;

        const std::vector<BYTE>* pdf = &m_bytes;
        std::vector<BYTE> converted;
        if (!isPdf) {
            if (!isZip) return E_FAIL;
            // docx -> pdf (cache'li Python hatti); render'dan ONCE, WinRT'siz
            if (FAILED(ConvertDocxToPdf(m_bytes, converted)) || converted.empty()) return E_FAIL;
            pdf = &converted;
        }

        HRESULT hr = E_FAIL;
        HBITMAP hbmp = nullptr;
        // WinRT render'i ayri MTA thread'inde yap (shell apartment izolasyonu)
        std::thread t([&]() {
            init_apartment(apartment_type::multi_threaded);
            hr = RenderFirstPageToHBITMAP(*pdf, cx, &hbmp);
            uninit_apartment();
        });
        t.join();
        if (SUCCEEDED(hr) && hbmp) { *phbmp = hbmp; *pdwAlpha = WTSAT_ARGB; }
        return hr;
    }

private:
    long m_ref;
    bool m_stream = false;
    std::vector<BYTE> m_bytes;
};

// ============================ Class factory ===================================
class ClassFactory : public IClassFactory {
public:
    ClassFactory() : m_ref(1) { InterlockedIncrement(&g_dllRefs); }
    ~ClassFactory() { InterlockedDecrement(&g_dllRefs); }
    IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (riid == IID_IUnknown || riid == IID_IClassFactory) {
            *ppv = static_cast<IClassFactory*>(this); AddRef(); return S_OK;
        }
        *ppv = nullptr; return E_NOINTERFACE;
    }
    IFACEMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&m_ref); }
    IFACEMETHODIMP_(ULONG) Release() {
        ULONG r = InterlockedDecrement(&m_ref); if (r == 0) delete this; return r;
    }
    IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** ppv) {
        if (outer) return CLASS_E_NOAGGREGATION;
        PdfThumbProvider* p = new (std::nothrow) PdfThumbProvider();
        if (!p) return E_OUTOFMEMORY;
        HRESULT hr = p->QueryInterface(riid, ppv);
        p->Release();
        return hr;
    }
    IFACEMETHODIMP LockServer(BOOL lock) {
        if (lock) InterlockedIncrement(&g_dllRefs); else InterlockedDecrement(&g_dllRefs);
        return S_OK;
    }
private:
    long m_ref;
};

// ============================ Kayit yardimcilari ==============================
static HRESULT SetKey(HKEY root, const wchar_t* sub, const wchar_t* val) {
    HKEY k;
    LONG r = RegCreateKeyExW(root, sub, 0, nullptr, 0, KEY_WRITE, nullptr, &k, nullptr);
    if (r != ERROR_SUCCESS) return HRESULT_FROM_WIN32(r);
    if (val) RegSetValueExW(k, nullptr, 0, REG_SZ, (const BYTE*)val,
                            (DWORD)((wcslen(val) + 1) * sizeof(wchar_t)));
    RegCloseKey(k);
    return S_OK;
}
static HRESULT SetNamed(HKEY root, const wchar_t* sub, const wchar_t* name, const wchar_t* val) {
    HKEY k;
    LONG r = RegCreateKeyExW(root, sub, 0, nullptr, 0, KEY_WRITE, nullptr, &k, nullptr);
    if (r != ERROR_SUCCESS) return HRESULT_FROM_WIN32(r);
    RegSetValueExW(k, name, 0, REG_SZ, (const BYTE*)val,
                   (DWORD)((wcslen(val) + 1) * sizeof(wchar_t)));
    RegCloseKey(k);
    return S_OK;
}

static std::wstring ClsidStr() {
    wchar_t buf[64]; StringFromGUID2(CLSID_PidirPdfThumb, buf, 64); return buf;
}

// ============================ DLL disari aciklar ==============================
STDAPI DllGetClassObject(REFCLSID rclsid, REFIID riid, void** ppv) {
    if (rclsid != CLSID_PidirPdfThumb) return CLASS_E_CLASSNOTAVAILABLE;
    ClassFactory* f = new (std::nothrow) ClassFactory();
    if (!f) return E_OUTOFMEMORY;
    HRESULT hr = f->QueryInterface(riid, ppv);
    f->Release();
    return hr;
}
STDAPI DllCanUnloadNow() { return g_dllRefs == 0 ? S_OK : S_FALSE; }

// Per-user kayit (HKCU\Software\Classes -> HKCR'e birlesir; yonetici GEREKMEZ)
STDAPI DllRegisterServer() {
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(g_hInst, path, MAX_PATH);
    std::wstring clsid = ClsidStr();
    std::wstring kClsid = L"Software\\Classes\\CLSID\\" + clsid;
    std::wstring kInproc = kClsid + L"\\InprocServer32";

    HKEY root = HKEY_CURRENT_USER;
    SetKey(root, kClsid.c_str(), kFriendly);
    SetKey(root, kInproc.c_str(), path);
    SetNamed(root, kInproc.c_str(), L"ThreadingModel", L"Apartment");

    // .pdf ve .docx uzantilarina thumbnail handler bagla (uzanti seviyesi)
    for (const wchar_t* ext : { L".pdf", L".docx" }) {
        std::wstring kShellEx = std::wstring(L"Software\\Classes\\") + ext +
                                L"\\ShellEx\\" + std::wstring(kThumbHandlerGuid);
        SetKey(root, kShellEx.c_str(), clsid.c_str());
    }
    return S_OK;
}

STDAPI DllUnregisterServer() {
    std::wstring clsid = ClsidStr();
    for (HKEY root : { HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER }) {
        for (const wchar_t* ext : { L".pdf", L".docx" }) {
            std::wstring kShellEx = std::wstring(L"Software\\Classes\\") + ext +
                                    L"\\ShellEx\\" + std::wstring(kThumbHandlerGuid);
            RegDeleteTreeW(root, kShellEx.c_str());
        }
        std::wstring kClsid = L"Software\\Classes\\CLSID\\" + clsid;
        RegDeleteTreeW(root, kClsid.c_str());
    }
    return S_OK;
}

BOOL WINAPI DllMain(HINSTANCE h, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) { g_hInst = h; DisableThreadLibraryCalls(h); }
    return TRUE;
}
