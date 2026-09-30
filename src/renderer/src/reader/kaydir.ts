import { useEffect } from 'react'

/** Bu kadar piksel hareket etmeden sürükleme başlamaz → tek tık ve çift tık (kelime seçimi) bozulmaz. */
const ESIK = 4

/** Yatay taşma var mı? (Genişliğe sığdırılmış belgede yoktur; yakınlaştırınca doğar.) */
const tasiyor = (el: HTMLElement): boolean => el.scrollWidth > el.clientWidth + 1

interface Secenek {
  /** Seçim kipi açıkken sürükleme devre dışı: metin katmanındaki jestler bozulmasın. */
  devreDisi: boolean
}

interface Tutus {
  id: number
  /** Basış noktası: yalnız eşik kontrolü için. */
  x: number
  y: number
  /** Son işlenen konum: kaydırma ARTIMLI uygulanır (sürükleme sırasında tekerlek,
   *  klavye ya da yakınlaştırma scrollTop'u değiştirirse görünüm sıçramasın). */
  sonX: number
  sonY: number
}

/**
 * Yakınlaştırılmış belgeyi elle kaydırma. Belge yatayda taştığı an kaydırıcıya
 * `tutulabilir` sınıfı gelir (el imleci); sol tuş basılıyken fare hareketi sayfayı
 * her iki eksende taşır (`tutuluyor` = kapalı el). Sığdırılmış görünümde hiçbir
 * şey değişmez. Sağ/orta tuş, dokunmatik kaydırma ve Ctrl+tekerlek yakınlaştırma
 * bu kancaya girmez.
 *
 * Pointer capture bilerek eşik SONRASI alınır: basışta alınsaydı click/dblclick
 * hedefi kaydırıcıya kayar, çift tıkla kelime seçimi (.reader-page araması) bozulurdu.
 */
export function useSurukleKaydir(
  scrollerRef: React.RefObject<HTMLDivElement | null>,
  { devreDisi }: Secenek
): void {
  // İmleç sınıfı: içerik (ölçek) ya da kutu boyutu değişince tazele. Seçim kipinde
  // sürükleme kapalı olduğundan el imleci de gösterilmez.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const tazele = (): void => {
      el.classList.toggle('tutulabilir', !devreDisi && tasiyor(el))
    }
    tazele()
    const ro = new ResizeObserver(tazele)
    ro.observe(el)
    // Sütun, ölçekle birlikte büyür/küçülür → yatay taşma buradan anlaşılır.
    const sutun = el.firstElementChild
    if (sutun) ro.observe(sutun)
    return () => {
      ro.disconnect()
      el.classList.remove('tutulabilir')
    }
  }, [scrollerRef, devreDisi])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || devreDisi) return
    let tutus: Tutus | null = null
    let surukluyor = false

    const birak = (): void => {
      if (tutus && surukluyor && el.hasPointerCapture(tutus.id)) el.releasePointerCapture(tutus.id)
      el.classList.remove('tutuluyor')
      tutus = null
      surukluyor = false
    }

    const bas = (e: PointerEvent): void => {
      // Yalnız sol tuş; dokunmatikte yerel kaydırma zaten var.
      if (e.button !== 0 || e.pointerType === 'touch') return
      if (!tasiyor(el)) return
      // Seçilebilir metin katmanı kendi jestlerini yönetir.
      if ((e.target as Element | null)?.closest('.find-layer')) return
      tutus = { id: e.pointerId, x: e.clientX, y: e.clientY, sonX: e.clientX, sonY: e.clientY }
      surukluyor = false
    }

    const hareket = (e: PointerEvent): void => {
      if (!tutus || e.pointerId !== tutus.id) return
      // Tuş bırakılmış ama pointerup bize ulaşmamışsa (eşik öncesi kardeş katmanda
      // bırakma) tutuşu kapat; yoksa tuşsuz fare hareketi sayfayı sürüklerdi.
      if ((e.buttons & 1) === 0) {
        birak()
        return
      }
      if (!surukluyor) {
        if (Math.abs(e.clientX - tutus.x) < ESIK && Math.abs(e.clientY - tutus.y) < ESIK) return
        surukluyor = true
        el.setPointerCapture(e.pointerId)
        el.classList.add('tutuluyor')
      }
      e.preventDefault()
      el.scrollLeft -= e.clientX - tutus.sonX
      el.scrollTop -= e.clientY - tutus.sonY
      tutus.sonX = e.clientX
      tutus.sonY = e.clientY
    }

    const son = (e: PointerEvent): void => {
      if (!tutus || e.pointerId !== tutus.id) return
      birak()
    }

    el.addEventListener('pointerdown', bas)
    el.addEventListener('pointermove', hareket)
    // Bırakma pencere düzeyinde, yakalama fazında dinlenir: eşik öncesi tuş bir
    // kardeş katmanın (üst çubuk, arama çubuğu, sürükleme şeridi) üstünde
    // bırakılırsa da tutuş temizlensin.
    window.addEventListener('pointerup', son, true)
    window.addEventListener('pointercancel', son, true)
    // Yakalama dışı bir yolla tuş bırakılırsa (ör. pencere odak kaybı) asılı kalmasın.
    window.addEventListener('blur', birak)
    return () => {
      el.removeEventListener('pointerdown', bas)
      el.removeEventListener('pointermove', hareket)
      window.removeEventListener('pointerup', son, true)
      window.removeEventListener('pointercancel', son, true)
      window.removeEventListener('blur', birak)
      birak()
    }
  }, [scrollerRef, devreDisi])
}
