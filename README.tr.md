# Pidır

Windows için sade bir PDF okuyucu. Pencereyi belge doldurur; arayüz, siz aramadıkça
kenarda durur.

![sürüm](https://img.shields.io/badge/s%C3%BCr%C3%BCm-0.1.0-555?style=flat-square)
[![lisans](https://img.shields.io/badge/lisans-MIT-2e7d32?style=flat-square)](LICENSE)

> 🇬🇧 English: [README.md](README.md)

> _Ekran görüntüsü yer tutucusu — okuma görünümünü `docs/gorseller/okuma.png` olarak koyup buraya bağlayın._

## Nedir

Pidır bir PDF'i açar ve gösterir. Yan panel yok, şerit menü yok, kalıcı araç çubuğu yok.
Üst çubuk yalnız imleç pencerenin üst kenarına yaklaşınca belirir, sonra yine kaybolur;
geri kalan her şey sağ tık menüsündedir. Pencerenin kendisi çerçevesizdir ve A4 en-boy
oranını korur — açık bir belge, bir uygulamadan çok bir kâğıt yaprağı gibi görünür.

Electron, React ve TypeScript ile yazılmış bir masaüstü uygulamasıdır. Sayfaları
[pdf.js](https://mozilla.github.io/pdf.js/) çizer, sayfa düzenlemeyi
[pdf-lib](https://pdf-lib.js.org/) yapar.

## Ne yapar

- **Okuma** — sürekli dikey kaydırma, `Ctrl` + fare tekerleği ile imleç odaklı
  yakınlaştırma, genişliğe ve sayfaya sığdırma.
- **Arama** — metin katmanında arar. Bir sayfanın taranmış olduğu (metin katmanı olmadığı)
  anlaşılırsa o sayfa Tesseract OCR'dan geçirilir; Türkçe ya da İngilizce. OCR yalnız arama
  çubuğunu açtığınızda başlar, yani düz okuma bunun bedelini hiç ödemez.
- **Sayfa yöneticisi** — sayfa silme, döndürme, yeniden sıralama; ya da birkaç sayfa seçip
  ayrı bir PDF'e çıkarma. Hepsi pdf-lib ile yerelde çalışır; şifreli PDF'ler sessizce
  bozulmak yerine reddedilir.
- **PiP modu** — pencereyi küçük, hep üstte duran, saydamlığı ayarlanabilir bir panele
  dönüştürür; başka bir işle yan yana okumak için.
- **DOCX** — Word belgeleri açılırken PDF'e çevrilir, böylece arama, yakınlaştırma ve OCR
  onlarda da çalışır. Word ya da LibreOffice kurulu olması gerekmez; aşağıdaki
  [Python](#python) bölümüne bakın.
- **CSV ve JSON** — `.csv`, `.tsv`, `.json`, `.jsonl` ve `.ndjson` dosyaları okunabilir bir
  belge düzenine dökülüp aynı şekilde açılır. Ayırıcı kendiliğinden saptanır, çok büyük
  dosyalar makineyi kilitlemek yerine kırpılır. Bunlar için Python gerekmez.
- **Sadeleştir** — her sayfadaki yinelenen üst ve alt bilgi şeritlerini temizler. Üst
  başlığın okumayı böldüğü taranmış kitap ve makalelerde işe yarar.
- **Çoklu pencere**, sistem temasını izleyen açık/koyu görünüm ve Windows 11 snap desteği
  (başlık çubuğu gizli olmasına rağmen büyüt düğmesi native hover menüsünü korur).

Uygulama kurulduktan sonra bir `.pdf` ya da `.docx` dosyasına çift tıklamak onu Pidır'da açar.

## Kurulum

Kurulumu [son sürümden](../../releases/latest) indirin — dosya adı
`pidir-<sürüm>-kurulum.exe` biçimindedir — ve çalıştırın. Tüm kullanıcılar için kurar, bu
yüzden yönetici izni ister; kurulum dizinini değiştirmenize izin verir.

Şimdilik yalnız Windows. Kodda başlık çubuğu işlemleri dışında Windows'a özgü bir varsayım
yok ama başka bir platform derlenmiyor ve denenmiyor.

## Kaynaktan derleme

Node 22 veya üstü gerekir (`pdfjs-dist` bunu şart koşuyor).

```bash
npm install        # Tesseract dil verisini de resources/ocr altına indirir
npm run dev        # geliştirme kipinde, değişiklikleri izleyerek çalıştırır
npm run build:win  # tip denetimi + paketleme + dist/ altına NSIS kurulumu
```

Diğer betikler: `npm run typecheck` (ana süreç + arayüz), `npm run build:unpack`
(kurulumsuz, açık dizin derlemesi), `npm run format`.

## Python

PDF okumak, aramak, OCR çalıştırmak ve sayfa düzenlemek için Python **gerekmez**. Okuma
yolundaki her şey kendi kendine yeter.

Yalnız iki özellik yerel bir Python sürecine iş verir:

- `.docx` dosyalarını açmak
- **Sadeleştir** (üst/alt bilgi temizleme)

İkisi de uygulamayla birlikte gelen `arac/` altındaki betikleri kullanır. Bunun için
`python`'ın `PATH`'te olması ve şu iki paketin kurulu olması gerekir:

```bash
pip install pymupdf mammoth
```

Python yoksa bu iki özellik hata bildirir, uygulamanın geri kalanı normal çalışmayı sürdürür.

## Klavye

| Kısayol | İşlev |
| --- | --- |
| `Ctrl+O` | Aç |
| `Ctrl+N` | Yeni pencere |
| `Ctrl+S` | Farklı kaydet |
| `Ctrl+F` | Ara (taranmış sayfalar için OCR'ı da başlatır) |
| `Ctrl+P` | PiP moduna gir / çık |
| `F11` | Tam ekrana gir / çık |
| Üst çubuk 9:16 düğmesi | Dikey kilit: açıkken her belge 9:16 pencerede; kapalıyken (varsayılan) pencere belgenin sayfa oranına uyar |
| `Ctrl` + `+` / `-` | Yakınlaştır / uzaklaştır |
| `Ctrl+0` | Genişliğe sığdır |
| `Ctrl` + tekerlek | İmleç odaklı yakınlaştırma |
| Sol tuşla sürükle | Yakınlaştırılmış sayfayı elle kaydır (imleç el olur) |
| `Esc` | Menüyü, sayfa yöneticisini, arama çubuğunu, tam ekranı ya da PiP'i kapatır |
| `Ctrl+Shift+I` | Geliştirici araçları |

macOS derlemelerinde `Ctrl` yerine `⌘` geçer. Sayfa yöneticisi, sayfaya sığdırma, döndürme
ve Sadeleştir sağ tık menüsündedir.

## Neden yazıldı

Windows'taki PDF okuyucuların çoğu ya bir ofis paketi olmaya çalışıyor ya da size abonelik
satmak istiyor. Neredeyse hepsi, okumaya çalıştığınız belgenin üstüne kalıcı olarak 200
piksellik bir düğme şeridi koyuyor. Pidır, alternatifi — sayfayı gösterip başka bir şey
göstermeyen bir okuyucu — bulunamadığı için yazıldı.

Kişisel bir araç; başkasının da işine yarar diye yayımlandı. Acrobat'ın yerini almaya
çalışmıyor ve bir düzenleme paketine dönüşmeyecek.

## Gizlilik

Pidır kullanım verisi toplar ve `https://bisiler.com/pidir/tlm` adresine gönderir. Bu
varsayılan olarak açıktır ve uygulama size önceden sormaz. Kurmadan önce bu bölümü okuyun.

Her gönderimde yollananlar:

- bir kurulum kimliği — ilk çalıştırmada üretilen ve uygulamanın kullanıcı verisi dizininde
  saklanan bir UUID
- **fiziksel ağ arayüzlerinizin MAC adresleri**, hem SHA-256 özeti hem de düz liste olarak
- uygulama sürümü, işletim sistemi sürümü ve işlemci mimarisi
- hangi özellikleri kullandığınız ve hata sayıları
- her oturumun ne kadar sürdüğü

**Dosya adları ve belge içerikleri hiçbir zaman gönderilmez.** Açtığınız, aradığınız ya da
kaydettiğiniz hiçbir şey makinenizden çıkmaz; IP adresiniz de gövdeye konmaz (sunucu onu
zaten görür, her HTTP isteğinde olduğu gibi).

MAC adresinin ne demek olduğunu açıkça söyleyelim: donanıma bağlı bir tanımlayıcıdır,
yeniden kurulumlarda ve işletim sistemi değişikliklerinde aynı kalır, makinenizi katıldığı
her ağda tanıtır. Bunu taşıyan veri hiçbir işe yarar anlamda anonim değildir — olsa olsa
takma adlıdır ve KVKK ile GDPR açısından kişisel veri sayılır. Kabul edilebilir bulup
bulmadığınıza karar verebilesiniz diye burada olduğu gibi yazılmıştır.

Olaylar toplu hâlde, dakikada bir civarında gönderilir; ağ çökükse diske kuyruklanır, yani
düşürülmez, sonra yeniden denenir. Geliştirme derlemelerinde hiçbir şey gönderilmez.

Tümüyle kapatmak için uygulamayı başlatmadan önce şu ortam değişkenini tanımlayın:

```
PIDIR_TLM_KAPALI=1
```

Bundan ayrı olarak uygulama açılışta güncelleme denetler ve çıkışta kurar. Bu, telemetri
ayarından bağımsız olarak güncelleme sunucusuna bağlanır.

## Kaynak

Pidır, Alex Gounis'in PDFx projesinden çatallandı ve onun Electron/React kabuğunu ve PDF
altyapısını korudu — özgün telif bildirimi [LICENSE](LICENSE) dosyasında duruyor. Okuyucu
davranışı, sayfa yöneticisi, OCR'lı arama, DOCX desteği ve PiP modu Pidır için yazıldı.

## Lisans

MIT — bkz. [LICENSE](LICENSE).
