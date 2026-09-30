/**
 * Panoya giden metnin ortak temizliği ve seçim okuma.
 *
 * Hem `copy` olayı dinleyicisi (Ctrl+C) hem sağ-tık menüsündeki "Kopyala" aynı
 * fonksiyonu kullanır — iki yolun farklı metin üretmesi sinsi bir hata olurdu.
 *
 * NOT: pdf.js'in `removeNullCharacters`ı pdfjs-dist'ten DIŞA AKTARILMIYOR (yalnız
 * web/pdf_viewer.mjs içinde yaşıyor); import etmek derlemede değil çalışma anında
 * `undefined` olarak patlar. Üç satırı elde tutmak daha ucuz.
 */

// \x09 (tab) ve \x0A (\n) KORUNUR: satır sonları pdf.js'in <br>'lerinden gelir ve
// kopyalanan metnin okunur kalması için gereklidir.
const KONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g

/** main/register-ipc.ts içindeki MAX_CLIPBOARD_CHARS ile AYNI değer olmalı. */
export const MAX_KOPYA = 2 * 1024 * 1024

/** UTF-16 kod birimiyle kırpınca vekil çiftinin ortasından kesilebilir → panoda U+FFFD. */
function vekilGuvenliKirp(s: string, n: number): string {
  if (s.length <= n) return s
  const r = s.slice(0, n)
  const son = r.charCodeAt(r.length - 1)
  return son >= 0xd800 && son <= 0xdbff ? r.slice(0, -1) : r
}

export function temizle(s: string): string {
  // Önce satır sonlarını tek biçime indir (tek başına CR de yakalanır), sonra
  // Windows'ta CRLF'e geri çevir: `copy` olayında clipboardData.setData +
  // preventDefault kullandığımız için Blink'in kendi CRLF normalleştirmesi ATLANIR
  // ve metin Not Defteri'nde tek satır olarak yapışırdı.
  const d = vekilGuvenliKirp(s.replace(/\r\n?/g, '\n').replace(KONTROL, ''), MAX_KOPYA)
  return window.api.platform === 'win32' ? d.replace(/\n/g, '\r\n') : d
}

/**
 * Seçim bir metin katmanının içindeyse temizlenmiş metnini, değilse boş dize döner.
 * Boş dönmesi "dokunma" demektir: FindBar input'undaki doğal kopyalama bozulmasın.
 */
export function katmandaSecim(): string {
  const s = window.getSelection()
  if (!s || s.isCollapsed) return ''
  const n = s.anchorNode
  const el = n instanceof Element ? n : n?.parentElement
  if (!el?.closest('.find-layer')) return ''
  return temizle(s.toString())
}
