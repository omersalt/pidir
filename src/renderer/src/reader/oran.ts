import type { DocEntry } from '../types'

/** Dikey kilit oranı: A4 dikey pencere (21:30 = 0.7). Ömer'in deyişiyle "9:16". */
export const DIKEY_ORAN = 21 / 30

/** localStorage anahtarı: '1' = dikey kilit açık (her belge 21:30 pencerede). */
export const KILIT_KEY = 'pidir:dikey-kilit'

/**
 * Belgenin pencere oranı (genişlik/yükseklik): sayfa oranlarının ORTANCASI. Karışık
 * belgede (çoğu dikey, birkaç yatay) çoğunluk kazanır; tek sayfalıkta o sayfa. İlk
 * 200 sayfa yeter, gerisi ölçümü değiştirmez.
 */
export function belgeOrani(doc: DocEntry | null): number {
  if (!doc || doc.pages.length === 0) return DIKEY_ORAN
  const oranlar = doc.pages
    .slice(0, 200)
    .map((p) => p.width / p.height)
    .filter((r) => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b)
  if (oranlar.length === 0) return DIKEY_ORAN
  return oranlar[Math.floor(oranlar.length / 2)]
}

export function kilitOku(): boolean {
  try {
    return localStorage.getItem(KILIT_KEY) === '1'
  } catch {
    return false
  }
}

export function kilitYaz(acik: boolean): void {
  try {
    localStorage.setItem(KILIT_KEY, acik ? '1' : '0')
  } catch {
    /* yoksay: tercih yalnız bu oturumda kalır */
  }
}
