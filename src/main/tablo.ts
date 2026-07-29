import { markupToPdf } from './markup'

// Tablo/veri köprüsü: CSV ve JSON de PDF'e çevrilir, okuyucu tek biçim görür.
// docx'ten farkı, burada Python sidecar'a GEREK OLMAMASI — markupToPdf zaten
// Electron'un kendi printToPDF'ini kullanıyor, yani dış bağımlılık sıfır.
//
// Üretilen HTML data: URL olarak yüklenir ve markup.ts'in CSP'si default-src 'none'
// der: dış istek (font, css, resim) sessizce düşer ve sayfa boş çıkar. Bu yüzden
// TÜM biçimlendirme gömülü <style> içinde ve yalnız sistemde kurulu yazı tipleriyle.

const MAX_INPUT_BYTES = 64 * 1024 * 1024

// Bunun üstündeki JSON'ı bütün hâlde ağaca dökersek HTML devleşir; markup.ts'teki
// 10 sn'lik render zaman aşımına takılmaktansa kırpıp sonuna not düşeriz.
const BUYUK_GIRDI_BAYT = 2 * 1024 * 1024

// Aynı zaman aşımı tablo tarafında da geçerli: yüz binlik CSV yüzlerce sayfa
// demek. Tavanı aşan satırlar gösterilmez ama SAYISI yazılır — sessiz kayıp yok.
const CSV_MAX_SATIR = 10_000
const JSON_DUGUM_BUTCESI = 20_000
const JSON_DUGUM_BUTCESI_BUYUK = 4_000
const JSON_MAX_DERINLIK = 32
const JSON_MAX_DIZE = 600

const AYIRICI_ADAYLARI = [',', ';', '\t', '|']

export function isCsv(name: string): boolean {
  return /\.(csv|tsv)$/i.test(name)
}

export function isJson(name: string): boolean {
  return /\.(json|jsonl|ndjson)$/i.test(name)
}

// ——— ortak yardımcılar ———

function girdiDogrula(tur: string, input: Uint8Array, dosyaAdi: string): void {
  if (!ArrayBuffer.isView(input) || input.byteLength === 0 || input.byteLength > MAX_INPUT_BYTES) {
    throw new Error(`${tur}: geçersiz girdi`)
  }
  if (typeof dosyaAdi !== 'string') {
    throw new Error(`${tur}: geçersiz dosya adı`)
  }
}

const KACIS: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

// GÜVENLİK: hücre içeriği doğrudan HTML'e gömülüyor; bir CSV hücresinde <script>
// ya da bir başlıkta " olabilir. Kaçış olmadan veri dosyası sayfayı ele geçirir.
function htmlKacir(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => KACIS[ch])
}

// Binlik ayırıcı nokta (1.234). ICU/locale'e bağlı kalmamak için elle grupluyoruz:
// aynı çıktı her makinede aynı görünsün.
function sayiBicimle(n: number): string {
  const govde = Math.trunc(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return n < 0 ? `-${govde}` : govde
}

function dosyaAdiGoster(dosyaAdi: string): string {
  return dosyaAdi.replace(/^.*[\\/]/, '') || 'belge'
}

function metneCevir(input: Uint8Array): string {
  // BOM burada atılır; kalırsa ilk sütun başlığının başına görünmez bir karakter
  // yapışır ve "başlık eşleşmiyor" gibi sinsi hatalar doğurur.
  const bomsuz =
    input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf
      ? input.subarray(3)
      : input
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bomsuz)
  } catch {
    // Türkçe Excel/Not Defteri hâlâ Windows-1254 yazabiliyor. Geçersiz UTF-8
    // dizisini sessizce U+FFFD'ye çevirmektense doğru kod sayfasını deneriz.
    try {
      return new TextDecoder('windows-1254').decode(bomsuz)
    } catch {
      return Buffer.from(bomsuz).toString('latin1')
    }
  }
}

function sayfaBasi(ad: string, bilgi: string): string {
  return `<div class="ust"><span class="ad">${htmlKacir(ad)}</span><span class="bilgi">${htmlKacir(bilgi)}</span></div>`
}

// ——— CSV ———

/**
 * RFC 4180 ayrıştırıcı: tırnaklı alan, "" ile kaçırılmış tırnak, alan içindeki
 * satır sonu. Tamamen boş satırlar (yalnız satır sonu) veri değildir, atılır —
 * yoksa dosya sonundaki her fazladan \n bir sahte satır üretir.
 */
function csvAyristir(metin: string, ayirici: string): string[][] {
  const satirlar: string[][] = []
  let alanlar: string[] = []
  let alan = ''
  let tirnakta = false

  const satirKapat = (): void => {
    alanlar.push(alan)
    if (!(alanlar.length === 1 && alanlar[0] === '')) satirlar.push(alanlar)
    alanlar = []
    alan = ''
  }

  for (let i = 0; i < metin.length; i++) {
    const ch = metin[i]
    if (tirnakta) {
      if (ch === '"') {
        if (metin[i + 1] === '"') {
          alan += '"'
          i++
        } else {
          tirnakta = false
        }
      } else {
        alan += ch
      }
      continue
    }
    // Tırnak yalnız alan başındayken alıntı açar; ortadaki tırnak düz metindir.
    if (ch === '"' && alan === '') {
      tirnakta = true
      continue
    }
    if (ch === ayirici) {
      alanlar.push(alan)
      alan = ''
      continue
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && metin[i + 1] === '\n') i++
      satirKapat()
      continue
    }
    alan += ch
  }
  if (alan !== '' || alanlar.length > 0) satirKapat()
  return satirlar
}

/**
 * Ayırıcıyı sezer. Türkçe Excel varsayılanı noktalı virgül olduğu için virgülü
 * peşinen kabul etmek yaygın bir hata; onun yerine adayları ölçeriz.
 */
function ayiriciSez(metin: string): string {
  // İlk ~64 KB yeter; tüm dosyayı dört kez ayrıştırmak büyük CSV'de israf olur.
  // Kesimi son satır sonundan yaparız, yarım satır sayımı bozmasın.
  let ornek = metin.slice(0, 64 * 1024)
  if (metin.length > ornek.length) {
    const sonNl = ornek.lastIndexOf('\n')
    if (sonNl > 0) ornek = ornek.slice(0, sonNl)
  }

  let enIyi = ','
  let enIyiPuan = -1
  let enIyiSutun = 0
  for (const aday of AYIRICI_ADAYLARI) {
    const satirlar = csvAyristir(ornek, aday).slice(0, 20)
    if (satirlar.length === 0) continue
    const kova = new Map<number, number>()
    for (const r of satirlar) kova.set(r.length, (kova.get(r.length) ?? 0) + 1)
    let mod = 0
    let modAdet = 0
    for (const [n, adet] of kova) {
      if (adet > modAdet || (adet === modAdet && n > mod)) {
        mod = n
        modAdet = adet
      }
    }
    if (mod < 2) continue
    // Tutarlılık sütun sayısından önce gelir: her satırda 3 sütun veren ayırıcı,
    // kimi satırda 9 kimi satırda 2 veren ayırıcıdan daha doğrudur.
    const puan = (modAdet / satirlar.length) * 100 + Math.min(mod, 40)
    if (puan > enIyiPuan || (puan === enIyiPuan && mod > enIyiSutun)) {
      enIyiPuan = puan
      enIyi = aday
      enIyiSutun = mod
    }
  }
  return enIyi
}

function ayiriciAdi(ayirici: string): string {
  if (ayirici === ',') return 'virgül'
  if (ayirici === ';') return 'noktalı virgül'
  if (ayirici === '\t') return 'sekme'
  if (ayirici === '|') return 'boru'
  return ayirici
}

/**
 * Hücre sayı/para gibi mi? Kesinlik değil, hizalama için sezgi: binlik ayırıcı
 * (nokta/boşluk), ondalık virgül, para simgesi ve yüzde temizlenince geriye
 * yalnız rakam kalmalı. Tarih (2026-07-29) bilerek elenir, sola yaslı kalsın.
 */
function sayiGibiMi(ham: string): boolean {
  const s = ham.trim()
  if (!s || s.length > 32) return false
  const cekirdek = s
    .replace(/^[-+(]/, '')
    .replace(/\)$/, '')
    .replace(/[₺$€£%]|\bTL\b|\bTRY\b|\bUSD\b|\bEUR\b/gi, '')
    .replace(/[\s.]/g, '')
    .replace(/,/g, '.')
    .trim()
  return /^\d+(\.\d+)?$/.test(cekirdek)
}

function sagaYaslilar(satirlar: string[][], sutunSayisi: number): boolean[] {
  const govde = satirlar.slice(1, 301)
  const sonuc: boolean[] = []
  for (let j = 0; j < sutunSayisi; j++) {
    let dolu = 0
    let sayi = 0
    for (const r of govde) {
      const h = (r[j] ?? '').trim()
      if (!h) continue
      dolu++
      if (sayiGibiMi(h)) sayi++
    }
    sonuc.push(dolu > 0 && sayi / dolu >= 0.7)
  }
  return sonuc
}

function csvStil(sutunSayisi: number): string {
  // 8 sütundan sonra dikey A4'e sığdırmak hücreleri okunmaz kılıyor → yatay sayfa.
  // 14'ten sonra yatay sayfa da yetmiyor → yazı boyutu kademeli küçülür.
  const yatay = sutunSayisi > 8
  const pt = sutunSayisi > 28 ? 6 : sutunSayisi > 20 ? 7 : sutunSayisi > 14 ? 8 : 9
  return `
@page { size: A4 ${yatay ? 'landscape' : 'portrait'}; margin: 12mm 10mm 12mm 10mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #1b1b1f; font-family: "Segoe UI", system-ui, sans-serif; font-size: ${pt}pt; }
.ust { display: flex; justify-content: space-between; align-items: baseline; gap: 6mm;
  border-bottom: 0.8pt solid #c9ccd4; padding-bottom: 2mm; margin-bottom: 3mm; }
.ust .ad { font-size: 12pt; font-weight: 600; overflow-wrap: anywhere; min-width: 0; }
.ust .bilgi { color: #6b7078; font-size: 8pt; white-space: nowrap; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
/* Başlık her sayfada tekrar etsin — çok sayfalı tabloda sütunun ne olduğu kaybolmasın. */
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { border: 0.4pt solid #d8dae0; padding: 2.2pt 3.5pt; vertical-align: top;
  overflow-wrap: anywhere; word-break: break-word; }
/* Alan içindeki satır sonu ayrıştırmada korunuyor; pre-wrap olmazsa HTML onu
   boşluğa çevirir ve çok satırlı hücre tek satır gibi görünür. */
td { white-space: pre-wrap; }
th { background: #eef1f6; text-align: left; font-weight: 600; }
tbody tr:nth-child(even) td { background: #f7f8fa; }
.no { width: 11mm; text-align: right; color: #9aa0a6; font-variant-numeric: tabular-nums; }
th.no { color: #6b7078; }
.sag { text-align: right; font-variant-numeric: tabular-nums; }
.not { margin-top: 3mm; color: #6b7078; font-size: 8pt; font-style: italic; }`
}

function csvHtml(satirlar: string[][], ad: string, ayirici: string, kirpilan: number): string {
  const sutunSayisi = satirlar.reduce((m, r) => Math.max(m, r.length), 0)
  const bilgi =
    satirlar.length === 0
      ? 'boş dosya'
      : `${sayiBicimle(Math.max(0, satirlar.length - 1))} satır · ${sayiBicimle(sutunSayisi)} sütun · ayırıcı: ${ayiriciAdi(ayirici)}`

  const p: string[] = []
  p.push('<!doctype html><html lang="tr"><head><meta charset="utf-8">')
  p.push(`<title>${htmlKacir(ad)}</title><style>${csvStil(sutunSayisi)}</style></head><body>`)
  p.push(sayfaBasi(ad, bilgi))

  if (satirlar.length === 0) {
    p.push('<div class="not">Dosya boş — gösterilecek satır yok.</div>')
    p.push('</body></html>')
    return p.join('\n')
  }

  const baslik = satirlar[0]
  const sag = sagaYaslilar(satirlar, sutunSayisi)

  p.push('<table><thead><tr><th class="no">#</th>')
  for (let j = 0; j < sutunSayisi; j++) {
    // Başlık satırı kısa kalmış olabilir (düzensiz CSV); adsız sütuna sıra no veririz.
    const metin = (baslik[j] ?? '').trim() || `Sütun ${j + 1}`
    p.push(`<th class="${sag[j] ? 'sag' : ''}">${htmlKacir(metin)}</th>`)
  }
  p.push('</tr></thead><tbody>')

  for (let i = 1; i < satirlar.length; i++) {
    const r = satirlar[i]
    p.push(`<tr><td class="no">${sayiBicimle(i)}</td>`)
    for (let j = 0; j < sutunSayisi; j++) {
      p.push(`<td class="${sag[j] ? 'sag' : ''}">${htmlKacir(r[j] ?? '')}</td>`)
    }
    p.push('</tr>')
  }
  p.push('</tbody></table>')

  if (satirlar.length === 1) {
    p.push('<div class="not">Dosyada yalnızca başlık satırı var.</div>')
  }
  if (kirpilan > 0) {
    p.push(`<div class="not">… ${sayiBicimle(kirpilan)} satır daha gösterilmedi.</div>`)
  }
  p.push('</body></html>')
  return p.join('\n')
}

/** CSV baytlarını PDF baytlarına çevirir. */
export async function csvToPdf(input: Uint8Array, dosyaAdi: string): Promise<Uint8Array> {
  girdiDogrula('csv', input, dosyaAdi)
  const metin = metneCevir(input)
  const ayirici = ayiriciSez(metin)
  const tum = csvAyristir(metin, ayirici)
  const kirpilan = Math.max(0, tum.length - CSV_MAX_SATIR)
  const satirlar = kirpilan > 0 ? tum.slice(0, CSV_MAX_SATIR) : tum
  return markupToPdf(csvHtml(satirlar, dosyaAdiGoster(dosyaAdi), ayirici, kirpilan))
}

// ——— JSON ———

interface Butce {
  kalan: number
}

interface JsonCozum {
  deger: unknown
  jsonl: boolean
  kayit: number
}

/**
 * V8'in hata metninden dosyadaki kırılma noktasını bulur. Üç ayrı biçimi var ve
 * sürümle değişiyor: "at position N", "line L column C" ve yeni "Unexpected
 * token 'X', ..."parça"... is not valid JSON" — sonuncusunda konum HİÇ yok,
 * o yüzden parçayı metinde arayıp konumu kendimiz hesaplıyoruz.
 */
function konumBul(metin: string, hata: unknown): { satir: number; sutun: number; simge: string } | null {
  const mesaj = hata instanceof Error ? hata.message : String(hata)

  const konumdan = (p: number, simge?: string): { satir: number; sutun: number; simge: string } => {
    const yer = Math.max(0, Math.min(p, metin.length))
    const onceki = metin.slice(0, yer)
    const sonNl = onceki.lastIndexOf('\n')
    return {
      satir: onceki.split('\n').length,
      sutun: yer - sonNl,
      simge: simge ?? (yer >= metin.length ? 'dosya sonu' : `"${metin[yer]}"`)
    }
  }

  const poz = /position (\d+)/i.exec(mesaj)
  if (poz) return konumdan(Number(poz[1]))
  if (/end of JSON input/i.test(mesaj)) return konumdan(metin.length, 'dosya sonu')

  const parca = /Unexpected token '(.)',\s*(?:\.\.\.)?"([\s\S]*)"(?:\.\.\.)? is not valid JSON/.exec(mesaj)
  if (parca) {
    const bas = metin.indexOf(parca[2])
    // Parça dosyada birden çok kez geçiyorsa hangisi olduğunu bilemeyiz; YANLIŞ
    // satır numarası vermektense konumsuz (ama V8'in ham metnini taşıyan) hata iyidir.
    if (bas >= 0 && metin.indexOf(parca[2], bas + 1) < 0) {
      // V8 parçayı hatalı simgenin ETRAFINDA keser; o simgenin parça içindeki
      // ortaya en yakın kopyası aradığımız yerdir.
      const orta = Math.floor(parca[2].length / 2)
      let enYakin = -1
      for (let i = parca[2].indexOf(parca[1]); i >= 0; i = parca[2].indexOf(parca[1], i + 1)) {
        if (enYakin < 0 || Math.abs(i - orta) < Math.abs(enYakin - orta)) enYakin = i
      }
      if (enYakin >= 0) return konumdan(bas + enYakin, `"${parca[1]}"`)
    }
  }

  const lc = /line (\d+) column (\d+)/i.exec(mesaj)
  return lc ? { satir: Number(lc[1]), sutun: Number(lc[2]), simge: 'giriş' } : null
}

function jsonHatasi(metin: string, hata: unknown): Error {
  const k = konumBul(metin, hata)
  if (k) {
    return new Error(`json: ${k.satir}. satırda beklenmeyen ${k.simge} (sütun ${k.sutun})`)
  }
  const mesaj = hata instanceof Error ? hata.message : String(hata)
  return new Error(`json: dosya geçerli JSON değil (${mesaj})`)
}

/**
 * Önce tek bir JSON belgesi olarak dener; olmazsa JSON Lines (her satır ayrı
 * belge) dener. İkisi de tutmazsa hata SESSİZCE yutulmaz, satır/sütunla fırlar.
 */
function jsonCoz(metin: string): JsonCozum {
  try {
    return { deger: JSON.parse(metin) as unknown, jsonl: false, kayit: 0 }
  } catch (ilkHata) {
    const satirlar = metin.split(/\r?\n/)
    const kayitlar: unknown[] = []
    for (let i = 0; i < satirlar.length; i++) {
      const s = satirlar[i].trim()
      if (!s) continue
      try {
        kayitlar.push(JSON.parse(s) as unknown)
      } catch {
        // Bir kısmı çözüldüyse dosya gerçekten JSON Lines'tır ve suçlu satır bellidir;
        // o zaman ilk hatayı değil, bozuk satırın numarasını bildirmek daha faydalı.
        if (kayitlar.length > 0) {
          throw new Error(`json: ${i + 1}. satır geçerli JSON değil (JSON Lines)`)
        }
        throw jsonHatasi(metin, ilkHata)
      }
    }
    if (kayitlar.length === 0) throw jsonHatasi(metin, ilkHata)
    return { deger: kayitlar, jsonl: true, kayit: kayitlar.length }
  }
}

function dizeHtml(s: string): string {
  // JSON.stringify kaçışları yerine koyar (ham satır sonu düzeni bozardı) ve
  // tırnakları ekler; çok uzun dizeler sayfayı yutmasın diye kırpılır.
  const ham = JSON.stringify(s)
  const kirpik = ham.length > JSON_MAX_DIZE ? `${ham.slice(0, JSON_MAX_DIZE)}…"` : ham
  return htmlKacir(kirpik)
}

function ilkelHtml(deger: unknown): string | null {
  if (deger === null) return '<span class="bos">null</span>'
  switch (typeof deger) {
    case 'string':
      return `<span class="diz">${dizeHtml(deger)}</span>`
    case 'number':
      return `<span class="say">${htmlKacir(Number.isFinite(deger) ? String(deger) : 'null')}</span>`
    case 'boolean':
      return `<span class="mant">${deger ? 'true' : 'false'}</span>`
    default:
      // Kapsayıcıysa (dizi/nesne) null döner ve çağıran özyinelemeye girer.
      return typeof deger === 'object' ? null : '<span class="bos">null</span>'
  }
}

function anahtarHtml(anahtar: string | null): string {
  // Anahtar da dize gibi kaçırılır: içinde tırnak/satır sonu olan anahtarlar var.
  return anahtar === null
    ? ''
    : `<span class="anh">${dizeHtml(anahtar)}</span><span class="ay">:</span> `
}

function jsonYaz(
  deger: unknown,
  anahtar: string | null,
  sonMu: boolean,
  derinlik: number,
  butce: Butce,
  cikti: string[]
): void {
  const on = anahtarHtml(anahtar)
  const vir = sonMu ? '' : '<span class="ay">,</span>'

  const ilkel = ilkelHtml(deger)
  if (ilkel !== null) {
    cikti.push(`<div class="st">${on}${ilkel}${vir}</div>`)
    return
  }
  if (derinlik >= JSON_MAX_DERINLIK) {
    cikti.push(`<div class="st atlandi">${on}… (iç içe yapı çok derin)</div>`)
    return
  }

  const dizi = Array.isArray(deger)
  const girisler: Array<[string | null, unknown]> = dizi
    ? (deger as unknown[]).map((v) => [null, v])
    : Object.entries(deger as Record<string, unknown>).map(([k, v]) => [k, v])
  const ac = dizi ? '[' : '{'
  const kapa = dizi ? ']' : '}'

  if (girisler.length === 0) {
    cikti.push(`<div class="st">${on}<span class="par">${ac}${kapa}</span>${vir}</div>`)
    return
  }

  const adet = dizi
    ? `${sayiBicimle(girisler.length)} öğe`
    : `${sayiBicimle(girisler.length)} anahtar`
  cikti.push(
    `<div class="st">${on}<span class="par">${ac}</span> <span class="adet">${adet}</span></div>`
  )
  cikti.push('<div class="blk">')
  for (let i = 0; i < girisler.length; i++) {
    if (butce.kalan <= 0) {
      cikti.push(
        `<div class="st atlandi">… ${sayiBicimle(girisler.length - i)} öğe daha gösterilmedi</div>`
      )
      break
    }
    butce.kalan--
    const [k, v] = girisler[i]
    jsonYaz(v, k, i === girisler.length - 1, derinlik + 1, butce, cikti)
  }
  cikti.push('</div>')
  cikti.push(`<div class="st"><span class="par">${kapa}</span>${vir}</div>`)
}

function jsonOzet(cozum: JsonCozum): string {
  if (cozum.jsonl) return `JSON Lines · ${sayiBicimle(cozum.kayit)} kayıt`
  const d = cozum.deger
  if (Array.isArray(d)) return `dizi · ${sayiBicimle(d.length)} öğe`
  if (d !== null && typeof d === 'object') {
    return `nesne · ${sayiBicimle(Object.keys(d as Record<string, unknown>).length)} anahtar`
  }
  return 'tek değer'
}

const JSON_STIL = `
@page { size: A4 portrait; margin: 14mm 12mm 14mm 12mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #1b1b1f;
  font-family: Consolas, "Cascadia Mono", "Courier New", monospace; font-size: 8.5pt; line-height: 1.45; }
.ust { display: flex; justify-content: space-between; align-items: baseline; gap: 6mm;
  border-bottom: 0.8pt solid #c9ccd4; padding-bottom: 2mm; margin-bottom: 3mm;
  font-family: "Segoe UI", system-ui, sans-serif; }
.ust .ad { font-size: 12pt; font-weight: 600; overflow-wrap: anywhere; min-width: 0; }
.ust .bilgi { color: #6b7078; font-size: 8pt; white-space: nowrap; }
.st { white-space: pre-wrap; overflow-wrap: anywhere; break-inside: avoid; }
/* Girinti kutusunun sol kenarlığı, derin iç içe yapıda hangi seviyede olduğunu
   gösteren soluk kılavuz çizgisidir. */
.blk { padding-left: 1.15em; border-left: 0.4pt solid #dcdce4; }
.anh { color: #1c4f9c; }
.diz { color: #0a7a3d; }
.say { color: #b3510a; }
.mant { color: #7b2fbf; }
.bos { color: #8a8a96; }
.par { color: #444a52; font-weight: 600; }
.ay { color: #9aa0a6; }
.adet { color: #9aa0a6; font-style: italic; }
.atlandi { color: #6b7078; font-style: italic; }`

function jsonHtml(govde: string, ad: string, bilgi: string): string {
  return [
    '<!doctype html><html lang="tr"><head><meta charset="utf-8">',
    `<title>${htmlKacir(ad)}</title><style>${JSON_STIL}</style></head><body>`,
    sayfaBasi(ad, bilgi),
    `<div class="agac">${govde}</div>`,
    '</body></html>'
  ].join('\n')
}

/** JSON (veya JSON Lines) baytlarını PDF baytlarına çevirir. */
export async function jsonToPdf(input: Uint8Array, dosyaAdi: string): Promise<Uint8Array> {
  girdiDogrula('json', input, dosyaAdi)
  const metin = metneCevir(input)
  const cozum = jsonCoz(metin)
  const butce: Butce = {
    kalan: input.byteLength > BUYUK_GIRDI_BAYT ? JSON_DUGUM_BUTCESI_BUYUK : JSON_DUGUM_BUTCESI
  }
  const cikti: string[] = []
  jsonYaz(cozum.deger, null, true, 0, butce, cikti)
  return markupToPdf(jsonHtml(cikti.join('\n'), dosyaAdiGoster(dosyaAdi), jsonOzet(cozum)))
}
