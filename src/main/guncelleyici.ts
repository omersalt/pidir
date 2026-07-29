import { app } from 'electron'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'

// electron-updater STATİK import EDİLMEZ — yalnız tip olarak alınır. Ölçüldü:
// paketin kendisi + 8 alt bağımlılığı yüklemek 159 modül ve soğukta ~270 ms sürüyor.
// index.ts'ten statik import edilseydi bu maliyet createWindow'dan ÖNCE, doğrudan
// açılış yolunda olurdu ve bugün 4746 ms'den 291 ms'ye indirilen açılış geri giderdi
// (`!app.isPackaged` erken çıkışı da kurtarmaz: require zaten olmuş olur).
// Bu yüzden gerçek yükleme aşağıda, 10 saniyelik zamanlayıcının İÇİNDE yapılıyor.

// Sessiz otomatik güncelleme (GitHub Releases → omersalt/pidir).
// Ömer'in isteği "modern programlar gibi, hiç rahatsız etmeden": kullanıcıya hiçbir
// soru sorulmaz, hiçbir pencere/bildirim çıkmaz. Yeni sürüm arka planda iner ve
// uygulama kapanırken kurulur. Ağ yoksa hiçbir şey olmaz, bir sonraki turda denenir.

// Açılış süresi ölçülerek 291 ms'e indirildi (bkz. electron-builder.yml'deki NSIS notu).
// Güncelleme kontrolü ağ + disk işidir; ilk pencere çizilirken başlatırsak o kazanımı
// geri veririz. Bu yüzden kontrol açılıştan 10 sn SONRA başlar.
const ILK_GECIKME_MS = 10_000
const ARALIK_MS = 6 * 60 * 60 * 1000

export interface GuncellemeBilgisi {
  durum: string
  surum?: string
  ilerleme?: number
}

// 'kapali'   = geliştirme modu ya da hiç başlatılmadı
// 'bekliyor' = zamanlayıcı kuruldu, ilk kontrol henüz yapılmadı
// 'kontrol'  = sunucuya soruluyor
// 'guncel'   = yeni sürüm yok
// 'bulundu'  = yeni sürüm var, indirme başlıyor
// 'iniyor'   = indiriliyor (ilerleme yüzde)
// 'indirildi'= hazır, uygulama kapanırken kurulacak
// 'hata'     = kontrol/indirme başarısız (kullanıcıya GÖSTERİLMEZ)
type Durum =
  | 'kapali'
  | 'bekliyor'
  | 'kontrol'
  | 'guncel'
  | 'bulundu'
  | 'iniyor'
  | 'indirildi'
  | 'hata'

let durum: Durum = 'kapali'
let surum: string | undefined
let ilerleme: number | undefined

let baslatildi = false
let ilkZamanlayici: NodeJS.Timeout | null = null
let dongu: NodeJS.Timeout | null = null

// electron-log KURULU DEĞİL ve import edilmiyor. Kütüphanenin varsayılan logger'ı
// sessizdir; hataların izsiz kaybolmaması için konsola yönlendiriyoruz — kullanıcı
// arayüzünde yine hiçbir şey görünmez.
const konsolGunlugu = {
  info: (mesaj?: unknown): void => console.log('[guncelleyici]', mesaj),
  warn: (mesaj?: unknown): void => console.warn('[guncelleyici]', mesaj),
  error: (mesaj?: unknown): void => console.error('[guncelleyici]', mesaj)
}

function zamanlayicilariDurdur(): void {
  if (ilkZamanlayici) {
    clearTimeout(ilkZamanlayici)
    ilkZamanlayici = null
  }
  if (dongu) {
    clearInterval(dongu)
    dongu = null
  }
}

// Tembel yüklenen modülün örneği; ilk kontrolde doldurulur.
type OtoGunceller = typeof import('electron-updater')['autoUpdater']
let gunceller: OtoGunceller | null = null

/** electron-updater'ı ilk gerçek ihtiyaçta yükler ve bir kez ayarlar. */
async function guncelleyiciyiHazirla(): Promise<OtoGunceller> {
  if (gunceller) return gunceller
  const { autoUpdater } = await import('electron-updater')

  autoUpdater.logger = konsolGunlugu
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Yayın hedefi tek: NSIS tam kurulum (electron-builder.yml → win.target: nsis).
  // Web installer üretilmiyor; kapalı tutmak yanlışlıkla o yolun seçilmesini engeller.
  autoUpdater.disableWebInstaller = true
  // Alfa/beta etiketli yayınlar kullanıcıya inmesin.
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false

  // NOT: Kod imzalama sertifikamız yok, ama imza doğrulamasını KAPATMIYORUZ.
  // NsisUpdater kaynağı (NsisUpdater.js) doğrulamaya app-update.yml'deki
  // publisherName ile başlıyor; imzasız yapıda o alan hiç üretilmediği için
  // doğrulama zaten `null` dönüp atlanıyor — yani override etmek bugün ölü kod,
  // yarın tuzak olurdu: sertifika alındığı gün publisherName dolar ve override
  // imza kontrolünü SESSİZCE kapalı tutardı. Bütünlük HTTPS + yayın meta
  // verisindeki sha512 ile korunuyor (electron-updater indirmeyi ona karşı doğrular).

  autoUpdater.on('checking-for-update', () => {
    durum = 'kontrol'
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    durum = 'bulundu'
    surum = info.version
    ilerleme = 0
  })

  autoUpdater.on('update-not-available', () => {
    durum = 'guncel'
    surum = undefined
    ilerleme = undefined
  })

  autoUpdater.on('download-progress', (bilgi: ProgressInfo) => {
    durum = 'iniyor'
    // percent kayan noktalı ve nadiren 100'ü aşabiliyor; rozet için sınırla.
    ilerleme = Math.min(100, Math.max(0, Math.round(bilgi.percent)))
  })

  autoUpdater.on('update-downloaded', (olay: UpdateDownloadedEvent) => {
    durum = 'indirildi'
    surum = olay.version
    ilerleme = 100
    // İş bitti: kurulum app quit sırasında kendiliğinden yapılacak. Daha fazla ağ
    // turu anlamsız, döngüyü kapat.
    zamanlayicilariDurdur()
  })

  autoUpdater.on('error', (hata: Error) => {
    // Kullanıcıya ASLA diyalog gösterme — sessiz güncelleme sözü bu.
    durum = 'hata'
    console.warn('[guncelleyici] hata:', hata?.message ?? hata)
  })

  gunceller = autoUpdater
  return autoUpdater
}

async function kontrolEt(): Promise<void> {
  try {
    const g = await guncelleyiciyiHazirla()
    await g.checkForUpdates()
  } catch (error) {
    // Ağ yok / GitHub erişilemiyor / henüz yayın yok → kullanıcıyı ilgilendirmez.
    // Yutmuyoruz ama yükseltmiyoruz da: konsola yazılır, sonraki turda tekrar denenir.
    durum = 'hata'
    console.warn(
      '[guncelleyici] kontrol başarısız:',
      error instanceof Error ? error.message : String(error)
    )
  }
}

/** Uygulama arayüzü için son bilinen güncelleme durumu (ileride küçük bir rozet). */
export function guncellemeDurumu(): GuncellemeBilgisi {
  const bilgi: GuncellemeBilgisi = { durum }
  if (surum !== undefined) bilgi.surum = surum
  if (ilerleme !== undefined) bilgi.ilerleme = ilerleme
  return bilgi
}

/** app.whenReady() sonrasında bir kez çağrılır. */
export function guncellemeyiBaslat(): void {
  // Birden fazla pencere açılsa bile olay dinleyicileri ve zamanlayıcı tek olsun.
  if (baslatildi) return
  baslatildi = true

  // Geliştirmede paket, app-update.yml ve sürüm etiketi yok; electron-updater burada
  // yalnız gürültü üretir. Hiç dokunmadan sessizce çık.
  if (!app.isPackaged) {
    durum = 'kapali'
    return
  }

  ilkZamanlayici = setTimeout(() => {
    ilkZamanlayici = null
    void kontrolEt()
    dongu = setInterval(() => void kontrolEt(), ARALIK_MS)
  }, ILK_GECIKME_MS)

  // Kapanış sırasında yeni bir kontrol tetiklenip yarım indirme bırakmasın.
  app.once('will-quit', zamanlayicilariDurdur)

  durum = 'bekliyor'
}
