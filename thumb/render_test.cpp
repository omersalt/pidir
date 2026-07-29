// Izole test: WinRT (Windows.Data.Pdf) ile bir PDF'in ILK sayfasini
// bir BMP'ye render eder. Amac: en riskli parcayi (OS PDF motoru) COM
// kabugundan ONCE headless kanitlamak.
//   render_test.exe <girdi.pdf> <cikti.bmp>
#include <windows.h>
#include <vector>
#include <cstdio>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Data.Pdf.h>

using namespace winrt;
using namespace winrt::Windows::Data::Pdf;
using namespace winrt::Windows::Storage;
using namespace winrt::Windows::Storage::Streams;

int wmain(int argc, wchar_t** argv) {
    if (argc < 3) { wprintf(L"kullanim: render_test.exe <pdf> <bmp>\n"); return 2; }
    init_apartment();
    try {
        StorageFile file = StorageFile::GetFileFromPathAsync(argv[1]).get();
        PdfDocument doc = PdfDocument::LoadFromFileAsync(file).get();
        if (doc.PageCount() == 0) { wprintf(L"HATA: 0 sayfa\n"); return 1; }

        PdfPage page = doc.GetPage(0);
        auto sz = page.Size();  // DIP; genislik/yukseklik orani
        wprintf(L"sayfa sayisi=%u  sayfa1 boyut=%.0fx%.0f\n", doc.PageCount(), sz.Width, sz.Height);

        InMemoryRandomAccessStream stream;
        PdfPageRenderOptions opts;
        // 256px sinir kutusuna sigacak sekilde en uzun kenari olcekle
        if (sz.Width >= sz.Height) opts.DestinationWidth(256);
        else                       opts.DestinationHeight(256);
        page.RenderToStreamAsync(stream, opts).get();

        uint64_t total = stream.Size();
        DataReader reader(stream.GetInputStreamAt(0));
        reader.LoadAsync((uint32_t)total).get();
        std::vector<uint8_t> buf((size_t)total);
        reader.ReadBytes(buf);

        FILE* f = _wfopen(argv[2], L"wb");
        if (!f) { wprintf(L"HATA: cikti acilamadi\n"); return 1; }
        fwrite(buf.data(), 1, buf.size(), f);
        fclose(f);
        wprintf(L"OK: %llu bayt yazildi -> %ls\n", (unsigned long long)total, argv[2]);
        return 0;
    } catch (hresult_error const& e) {
        wprintf(L"WINRT HATA 0x%08x: %ls\n", (unsigned)e.code(), e.message().c_str());
        return 1;
    }
}
