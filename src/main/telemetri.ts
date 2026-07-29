import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID, createHash } from 'crypto'
import { networkInterfaces, release, arch } from 'os'

// Kullanım telemetrisi: hangi belge türleri açılıyor, hangi özellikler kullanılıyor,
// nerede hata çıkıyor — ürünü yönde tutmak için toplanır. Gönderim tamamen arka
// plandadır: başarısız olsa da kullanıcıya HİÇ yansımaz, açılışı geciktirmez,
// uygulamayı yavaşlatmaz. Bu yüzden hiçbir gönderim, açılış yoluna await ile
// sokulmaz; her şey unref'li zamanlayıcılarla ilerler.
//
// IP adresi istemciden GÖNDERİLMEZ: sunucu POST isteğini alırken kaynak IP'yi
// zaten görür; gövdede ayrıca yollamak gereksiz tekrar olur ve fazladan veri sızdırır.

const UC = 'https://bisiler.com/pidir/tlm'
const ARALIK_MS = 60_000 // periyodik toplu gönderim aralığı
const ESIK = 50 // bu kadar olay birikince beklemeden gönder
const ILK_GECIKME_MS = 15_000 // açılış hızı kutsal: ilk gönderim en erken 15 sn sonra
const ZAMAN_ASIMI_MS = 10_000 // asılı kalan bir istek uygulamayı sonsuza dek bekletmesin
const KUYRUK_TAVAN = 500 // diskteki kuyruk sonsuz büyümesin; taşarsa EN ESKİ atılır
const TAMPON_TAVAN = 1000 // ağ uzun süre çökükse bellekteki tampon da sınırlı kalsın
const VERI_MAKS_ANAHTAR = 32 // tek olayda taşınan alan sayısı üst sınırı
const VERI_MAKS_METIN = 512 // tek metin alanının uzunluk üst sınırı

interface Olay {
  ad: string
  zaman: string
  veri: Record<string, string | number | boolean>
}

let etkin = false
let gelistirme = false // !app.isPackaged: gönderme, sadece konsola yaz
let ilkGecikmeGecti = false
// (eski `gonderiliyor` bayrağı kaldırıldı — yerini `uctakiGonderim` sözü aldı, çünkü
//  bayrak kapanış yolunun uçuştaki gönderimi beklemesine izin vermiyordu.)
let oturumBaslangic = 0

let kurulumKimligi = ''
let macOzeti = ''
let macListesi: string[] = []
let kimlikHazir: Promise<void> = Promise.resolve()

const tampon: Olay[] = []
let ilkZamanlayici: NodeJS.Timeout | null = null
let periyot: NodeJS.Timeout | null = null

// Uç adresi çağrı anında okunur ki test/geliştirme PIDIR_TLM ile ezebilsin.
const uc = (): string => process.env.PIDIR_TLM || UC
const kimlikYolu = (): string => join(app.getPath('userData'), 'kimlik.json')
const kuyrukYolu = (): string => join(app.getPath('userData'), 'telemetri-kuyruk.json')

/** İlk çalıştırmada üretilip kalıcı saklanan kurulum kimliği (UUID). */
async function kurulumKimligiUret(): Promise<string> {
  try {
    const ham = await readFile(kimlikYolu(), 'utf8')
    const o: unknown = JSON.parse(ham)
    if (o && typeof o === 'object' && typeof (o as { kurulumKimligi?: unknown }).kurulumKimligi === 'string') {
      const mevcut = (o as { kurulumKimligi: string }).kurulumKimligi
      if (mevcut) return mevcut
    }
  } catch {
    // Dosya yok ya da bozuk — yeniden üret. Bozuk kimliği düzeltmek, gönderimi
    // engellememekten daha önemli; hatayı yutmak yerine yeni kimlikle devam ederiz.
  }
  const yeni = randomUUID()
  try {
    await writeFile(kimlikYolu(), JSON.stringify({ kurulumKimligi: yeni }))
  } catch (hata) {
    // Yazamazsak (disk dolu/izin) kimlik her açılışta değişir; bu bir bozulmadır
    // ama telemetriyi tümden durdurmaya değmez — logla, oturumluk kimlikle sür.
    console.warn('[telemetri] kimlik yazılamadı:', (hata as Error).message)
  }
  return yeni
}

/** Fiziksel (internal olmayan, sıfır olmayan) MAC adreslerinin sıralı, tekilleştirilmiş listesi. */
function fizikselMacler(): string[] {
  const set = new Set<string>()
  const arayuzler = networkInterfaces()
  for (const liste of Object.values(arayuzler)) {
    if (!liste) continue
    for (const a of liste) {
      // internal = loopback vb.; '00:...:00' = MAC'i olmayan sanal arayüz. İkisi de kimlik taşımaz.
      if (a.internal) continue
      if (!a.mac || a.mac === '00:00:00:00:00:00') continue
      set.add(a.mac.toLowerCase())
    }
  }
  return [...set].sort()
}

async function kimlikleriHazirla(): Promise<void> {
  kurulumKimligi = await kurulumKimligiUret()
  macListesi = fizikselMacler()
  macOzeti = createHash('sha256').update(macListesi.join(',')).digest('hex')
}

async function kuyrukOku(): Promise<Olay[]> {
  try {
    const ham = await readFile(kuyrukYolu(), 'utf8')
    const o: unknown = JSON.parse(ham)
    return Array.isArray(o) ? (o as Olay[]).slice(-KUYRUK_TAVAN) : []
  } catch {
    // Kuyruk dosyası yoksa/bozuksa boş kuyruk gibi davran — hata gönderimi durdurmasın.
    return []
  }
}

async function kuyrukYaz(olaylar: Olay[]): Promise<void> {
  // Taşarsa baştan (en eski) kırp: son KUYRUK_TAVAN olay korunur.
  const kesik = olaylar.slice(-KUYRUK_TAVAN)
  await writeFile(kuyrukYolu(), JSON.stringify(kesik))
}

/**
 * Bellekteki tamponu (ve varsa diskte bekleyen kuyruğu) tek POST ile gönderir.
 * Ağ hatasında olaylar diske geri yazılır ve sonraki denemede tekrar gönderilir.
 * Çağıranı asla throw'la etkilemez: tüm hatalar burada yutulur/loglanır.
 */
// Uçuştaki gönderimin sözü. Kapanış yolu bunu BEKLEYEBİLSİN diye tutuluyor: eskiden
// `gonderiliyor` bayrağı yüzünden, kapanış anında periyodik bir gönderim uçuştaysa
// telemetriKapat() sessizce hiçbir şey yapmıyor ve `kapanis` olayı hem gönderilmeden
// hem diske yazılmadan kayboluyordu.
let uctakiGonderim: Promise<void> | null = null

/** Aynı anda tek gönderim; ikinci çağrı uçuştakinin sözünü alır (kapanışta beklenebilir). */
function gonder(): Promise<void> {
  if (!etkin) return Promise.resolve()
  if (uctakiGonderim) return uctakiGonderim
  uctakiGonderim = gonderimYurut().finally(() => {
    uctakiGonderim = null
  })
  return uctakiGonderim
}

async function gonderimYurut(): Promise<void> {
  // Geliştirmede ağa çıkma; olayları konsola dök ve tamponu boşalt.
  if (gelistirme) {
    const yereldekiler = tampon.splice(0, tampon.length)
    if (yereldekiler.length) console.log('[telemetri:gel]', JSON.stringify(yereldekiler))
    return
  }

  await kimlikHazir
  const bekleyen = await kuyrukOku()
  const yeni = tampon.splice(0, tampon.length)
  const hepsi = [...bekleyen, ...yeni].slice(-KUYRUK_TAVAN)
  if (hepsi.length === 0) return

  const govde = JSON.stringify({
    kurulumKimligi,
    macOzeti,
    macListesi,
    gonderimZamani: new Date().toISOString(),
    olaylar: hepsi
  })

  const kontrolor = new AbortController()
  const saat = setTimeout(() => kontrolor.abort(), ZAMAN_ASIMI_MS)
  try {
    const yanit = await fetch(uc(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: govde,
      signal: kontrolor.signal
    })
    if (yanit.ok) {
      // Başarı: diskte bekleyen kalmışsa temizle (boşken gereksiz yazma yapma).
      if (bekleyen.length) await kuyrukYaz([])
      return
    }
    // 4xx = paketin kendisi kabul edilmiyor (bozuk gövde, kaldırılmış uç). Yeniden
    // denemek aynı sonucu verir; kuyrukta tutulursa dosya sonsuza dek dolu kalır ve
    // her turda boşuna istek atılır. Düşür ve geç. 5xx/ağ hatası ise geçici → kuyrukta kalır.
    if (yanit.status >= 400 && yanit.status < 500) {
      if (bekleyen.length) await kuyrukYaz([])
      console.warn(`[telemetri] paket reddedildi (HTTP ${yanit.status}), düşürüldü`)
      return
    }
    throw new Error(`HTTP ${yanit.status}`)
  } catch (hata) {
    // Ağ/zaman aşımı/5xx: gönderilemeyenleri diske kuyrukla, sonra tekrar denenir.
    try {
      await kuyrukYaz(hepsi)
    } catch (yazmaHatasi) {
      // Kuyruklama da başarısızsa olaylar gerçekten kayboluyor — sessiz geçilmemeli.
      console.warn('[telemetri] kuyruk yazılamadı:', (yazmaHatasi as Error).message)
    }
    console.warn('[telemetri] gönderim başarısız, kuyruğa alındı:', (hata as Error).message)
  } finally {
    clearTimeout(saat)
  }
}

/** veri alanını yalnız ilkel türlere indirger ve boyutunu sınırlar (kirli/şişkin girdi engeli). */
function veriTemizle(veri?: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const cikti: Record<string, string | number | boolean> = {}
  if (!veri || typeof veri !== 'object') return cikti
  let sayac = 0
  for (const [anahtar, deger] of Object.entries(veri)) {
    if (sayac >= VERI_MAKS_ANAHTAR) break
    if (typeof deger === 'string') {
      cikti[anahtar] = deger.slice(0, VERI_MAKS_METIN)
      sayac++
    } else if (typeof deger === 'number' && Number.isFinite(deger)) {
      cikti[anahtar] = deger
      sayac++
    } else if (typeof deger === 'boolean') {
      cikti[anahtar] = deger
      sayac++
    }
    // Diğer türler (nesne, dizi, null, undefined) sessizce atlanır: telemetri gövdesi
    // öngörülebilir ve küçük kalsın.
  }
  return cikti
}

/**
 * Telemetriyi başlatır. Kullanıcıya HİÇBİR ŞEY sorulmaz, onay/bildirim ekranı yoktur;
 * sahibin açık talimatı böyledir. PIDIR_TLM_KAPALI=1 ile tümüyle devre dışı kalır.
 */
export function telemetriBaslat(): void {
  // Geliştirici kaçış kapısı: ortam değişkeni varsa hiç kurma.
  if (process.env.PIDIR_TLM_KAPALI === '1') return
  if (etkin) return // çift başlatmaya karşı korun

  etkin = true
  gelistirme = !app.isPackaged
  oturumBaslangic = Date.now()

  // Kimlik üretimi disk okuma/yazma yapar; açılışı geciktirmesin diye await edilmez,
  // arka planda hazırlanır. Gönderimden önce kimlikHazir beklenir.
  kimlikHazir = kimlikleriHazirla().catch((hata) => {
    console.warn('[telemetri] kimlik hazırlanamadı:', (hata as Error).message)
  })

  // Açılış olayı: sürüm, OS sürümü, mimari. (Ekran sayısı vb. bilinçli olarak yok — gereksiz.)
  olayYaz('acilis', { surum: app.getVersion(), os: release(), mimari: arch() })

  // İlk gönderim en erken 15 sn sonra; ardından 60 sn'de bir. unref: bu zamanlayıcılar
  // tek başına uygulamayı ayakta tutmasın.
  ilkZamanlayici = setTimeout(() => {
    ilkGecikmeGecti = true
    void gonder()
    periyot = setInterval(() => void gonder(), ARALIK_MS)
    periyot.unref?.()
  }, ILK_GECIKME_MS)
  ilkZamanlayici.unref?.()
}

/** Bir olayı tampona yazar. Eşik aşılınca (ve ilk gecikme geçtiyse) beklemeden gönderilir. */
export function olayYaz(ad: string, veri?: Record<string, string | number | boolean>): void {
  if (!etkin) return
  if (typeof ad !== 'string' || !ad) return // geçersiz olay adını sessizce düşür

  tampon.push({ ad, zaman: new Date().toISOString(), veri: veriTemizle(veri) })

  // Bellek güvenliği: ağ uzun süre çökük kalırsa tampon şişmesin, en eskiyi at.
  if (tampon.length > TAMPON_TAVAN) tampon.splice(0, tampon.length - TAMPON_TAVAN)

  // Eşiği geçtiysek periyodu beklemeden yolla — ama ilk 15 sn'lik açılış penceresini bekle.
  if (ilkGecikmeGecti && tampon.length >= ESIK) void gonder()
}

/** Uygulama kapanırken: kapanış olayını ekle ve bekleyenleri son bir kez göndermeyi dene. */
export async function telemetriKapat(): Promise<void> {
  if (ilkZamanlayici) {
    clearTimeout(ilkZamanlayici)
    ilkZamanlayici = null
  }
  if (periyot) {
    clearInterval(periyot)
    periyot = null
  }
  if (!etkin) return

  // Oturum süresi ancak kapanışta bilinir.
  olayYaz('kapanis', { oturumSaniye: Math.round((Date.now() - oturumBaslangic) / 1000) })

  // Uçuşta bir gönderim varsa ÖNCE onu bekle: aksi halde `kapanis` olayı, hâlâ süren
  // turun tamponuna değil yenisine yazılır ve hiç gönderilmez.
  if (uctakiGonderim) {
    try {
      await uctakiGonderim
    } catch {
      // gonderimYurut hatayı zaten loglar; kapanışı bloklamasın.
    }
  }

  // Kapanış anı, gönderimi await etmenin sakıncasız olduğu tek yer: zaten kapanıyoruz
  // ve istek 10 sn zaman aşımıyla sınırlı. Başarısız olursa olaylar diske kuyruklanır.
  await gonder()

  // Bundan sonra gelen olaylar yalnız tamponu doldurur, gönderilemez — kapat.
  etkin = false
}
