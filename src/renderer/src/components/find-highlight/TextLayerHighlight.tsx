import { useEffect, useRef, useState } from 'react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { foldCase } from '../../search/normalize'

/**
 * Çift tık isteği. px/py/pw = çift tık ANINDAKİ sayfa kutusunun ekrandaki sol/üst
 * köşesi ve genişliği — katman asenkron kurulurken sayfa kaydıysa ya da ölçek
 * değiştiyse isteği elemek için (bkz. pickWordAt kapı 2).
 */
export interface SelReq {
  page: number
  x: number
  y: number
  px: number
  py: number
  pw: number
}

interface TextLayerHighlightProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  naturalHeight: number
  query: string
  selectAt?: SelReq | null
  onSelectResolved?: (ok: boolean) => void
}

function paint(div: HTMLElement, needle: string): void {
  const text = div.dataset.text ?? (div.dataset.text = div.textContent ?? '')
  // foldCase uzunluğu KORUR; bulunan indeksler ham `text` üzerinde geçerli kalır.
  const hay = foldCase(text)
  const at = needle ? hay.indexOf(needle) : -1
  if (at === -1) {
    if (div.childElementCount > 0) div.textContent = text
    return
  }
  const fragment = document.createDocumentFragment()
  let cursor = 0
  for (let from = at; from !== -1; from = hay.indexOf(needle, cursor)) {
    if (from > cursor) fragment.append(text.slice(cursor, from))
    const hit = document.createElement('span')
    hit.className = 'find-hit'
    hit.textContent = text.slice(from, from + needle.length)
    fragment.append(hit)
    cursor = from + needle.length
  }
  if (cursor < text.length) fragment.append(text.slice(cursor))
  div.replaceChildren(fragment)
}

type Caret = { node: Node; offset: number }

/** caretPositionFromPoint (standart) → caretRangeFromPoint (eski WebKit adı). */
function caretAt(x: number, y: number): Caret | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const p = d.caretPositionFromPoint?.(x, y)
  if (p) return { node: p.offsetNode, offset: p.offset }
  const r = d.caretRangeFromPoint?.(x, y)
  if (r) return { node: r.startContainer, offset: r.startOffset }
  return null
}

// Türkçe İ/ı/ş/ğ/ç/ö/ü zaten \p{L}; \p{M} birleşen aksanları (e + U+0301) tutar.
const SOZCUK = /[\p{L}\p{N}\p{M}_]/u

/** i konumundaki KOD NOKTASININ başlangıcı (vekil çiftinin alt yarısındaysa geri kayar). */
function kodBasi(t: string, i: number): number {
  const c = t.charCodeAt(i)
  return c >= 0xdc00 && c <= 0xdfff && i > 0 ? i - 1 : i
}

/** Kod BİRİMİ değil kod NOKTASI bazında harf testi — BMP dışı harfler de sayılsın. */
function harfMi(t: string, i: number): boolean {
  if (i < 0 || i >= t.length) return false
  const b = kodBasi(t, i)
  const cp = t.codePointAt(b)
  return cp !== undefined && SOZCUK.test(String.fromCodePoint(cp))
}

const kodBoyu = (t: string, i: number): number => ((t.codePointAt(i) ?? 0) > 0xffff ? 2 : 1)

type Parca = { node: Text; bas: number }

/**
 * Span'ın TÜM metin düğümlerini tek bir dizeye birleştirir + her düğümün mutlak
 * başlangıç ofsetini tutar.
 *
 * ZORUNLU: arama açıkken paint() span'ı `metin + <span.find-hit> + metin` biçiminde
 * BÖLER. Kelime sınırını tek düğümde aramak, "kopyala"nın yalnız "op" parçasını
 * seçmek demektir (denetimde 3/3 oyla doğrulandı).
 */
function parcala(owner: HTMLElement): { tam: string; parcalar: Parca[] } {
  const w = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT)
  const parcalar: Parca[] = []
  let tam = ''
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n as Text
    parcalar.push({ node: t, bas: tam.length })
    tam += t.data
  }
  return { tam, parcalar }
}

/** Mutlak ofseti (düğüm, düğüm-içi ofset) çiftine çevirir. */
function konumlandir(parcalar: Parca[], mutlak: number): { node: Text; offset: number } | null {
  for (let i = parcalar.length - 1; i >= 0; i--) {
    const p = parcalar[i]
    if (mutlak >= p.bas) return { node: p.node, offset: mutlak - p.bas }
  }
  return null
}

/**
 * İmlecin altındaki kelimeyi seçer. Seçemezse `false` döner ve HİÇBİR yan etki
 * bırakmaz — Ömer'in sözleşmesi: "metin yoksa hiçbir şey olmasın". Bu yüzden
 * hiçbir yolda "olmadı, tüm span'ı seçeyim" geri düşüşü YOKTUR.
 */
function pickWordAt(container: HTMLElement, req: SelReq): boolean {
  // (1) DÖNDÜRÜLMÜŞ SAYFA — FAIL-CLOSED.
  // pdf.js span'ları DÖNDÜRÜLMEMİŞ viewBox yüzdesiyle konumlandırır, Pidır'ın sayfa
  // kutusu ise DÖNDÜRÜLMÜŞtür (reader/load.ts getViewport({scale:1})) ve pdf.js'in
  // [data-main-rotation] düzeltme kuralları bu projede YOK. Yanlış kelime seçmektense
  // hiçbir şey yapma. Özniteliği pdf.js'in setLayerDimensions'ı zaten yazıyor.
  if ((container.dataset.mainRotation ?? '0') !== '0') return false

  // (2) BAYAT İSTEK — konum VE ölçek.
  // Katman asenkron kurulur; kullanıcı bu arada kaydırmış ya da zoom yapmış olabilir.
  // "Nokta hâlâ konteynerin içinde mi" YETMEZ (konteyner sayfa boyunda). Genişlik de
  // karşılaştırılmalı: fit='width' kipinde pencere yeniden boyutlanınca sayfanın
  // sol/üst köşesi sabit kalıp yalnız ÖLÇEK değişebilir.
  const rect = container.getBoundingClientRect()
  if (
    Math.abs(rect.left - req.px) > 0.5 ||
    Math.abs(rect.top - req.py) > 0.5 ||
    Math.abs(rect.width - req.pw) > 0.5
  ) {
    return false
  }

  // (3) KAPI — imlecin altında gerçekten metin var mı?
  // elementsFromPoint (ÇOĞUL): üstte duran FindBar ve .win-drag şeridi tekil
  // elementFromPoint'i yutardı. Arama açıkken yığının tepesi `.find-hit` olabilir;
  // `parentElement === container` şartı onu eler ve DIŞ span'ı bulur.
  // Taranmış sayfada pdf.js metinsiz span'ı container'a hiç EKLEMEZ → span bulunamaz.
  const owner = document
    .elementsFromPoint(req.x, req.y)
    .find(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && el.parentElement === container && el.tagName === 'SPAN'
    )
  if (!owner) return false

  const { tam, parcalar } = parcala(owner)
  if (!tam.trim()) return false

  const caret = caretAt(req.x, req.y)
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return false
  const idx = parcalar.findIndex((p) => p.node === caret.node)
  if (idx === -1) return false // caret owner'ın DIŞINDA → fail-closed
  const mutlak = parcalar[idx].bas + Math.min(caret.offset, parcalar[idx].node.data.length)

  // caret.offset bir EKLEME NOKTASIdır, karakter indeksi değil: bir glifin sağ
  // yarısına tıklanınca ofset bir SONRAKİ karakteri gösterir. İki adayı da dene.
  let i = -1
  if (harfMi(tam, mutlak)) i = mutlak
  else if (mutlak > 0 && harfMi(tam, mutlak - 1)) i = kodBasi(tam, mutlak - 1)
  if (i === -1) return false // boşluk/noktalama → hiçbir şey olmasın

  let a = kodBasi(tam, i)
  let b = a + kodBoyu(tam, a)
  while (a > 0) {
    const onceki = kodBasi(tam, a - 1)
    if (!harfMi(tam, onceki)) break
    a = onceki
  }
  while (b < tam.length && harfMi(tam, b)) b += kodBoyu(tam, b)

  const bas = konumlandir(parcalar, a)
  const son = konumlandir(parcalar, b)
  if (!bas || !son) return false

  const s = window.getSelection()
  if (!s) return false
  const range = document.createRange()
  range.setStart(bas.node, bas.offset)
  range.setEnd(son.node, son.offset)
  s.removeAllRanges()
  s.addRange(range)
  return true
}

export function TextLayerHighlight({
  pdf,
  pageNumber,
  naturalHeight,
  query,
  selectAt,
  onSelectResolved
}: TextLayerHighlightProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const divsRef = useRef<HTMLElement[]>([])
  const [built, setBuilt] = useState(0)
  // Cevabı prop kimliğine bağlamadan çağır: build efektinin bağımlılıklarını kirletmesin.
  const resolveRef = useRef(onSelectResolved)
  resolveRef.current = onSelectResolved
  // Bu ÖRNEĞİN bekleyen isteği. Kurulum hatasında yalnız isteğin SAHİBİ cevap versin;
  // yoksa başka bir sayfanın hatası geçerli bir seçimi iptal ederdi.
  const reqRef = useRef<SelReq | null | undefined>(selectAt)
  reqRef.current = selectAt
  // "Bu isteği zaten cevapladım" mandalı — Reader her kaydırmada yeniden render
  // olduğu için mandal olmadan aynı kelime durmadan yeniden seçilirdi.
  const doneRef = useRef<SelReq | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let layer: TextLayer | null = null
    let pageProxy: PDFPageProxy | null = null
    let builtHeight = 0

    const build = async (): Promise<void> => {
      const height = container.clientHeight
      if (height === 0 || height === builtHeight) return
      builtHeight = height
      const myHeight = height
      const scale = height / naturalHeight

      // HIZLI YOL: katman zaten varsa DOM'u YIKMA. update() yalnız --scale-x/rotation'ı
      // tazeler, span'ları yeniden kurmaz; span left/top zaten YÜZDE olduğu için
      // --total-scale-factor tek başına hizalamayı düzeltir. İki kazanç: her tekerlek
      // tıkındaki tam getTextContent fırtınası biter ve kullanıcının canlı seçimi YAŞAR.
      if (layer && pageProxy) {
        container.style.setProperty('--total-scale-factor', String(scale))
        layer.update({ viewport: pageProxy.getViewport({ scale }) })
        return
      }

      const page = await pdf.getPage(pageNumber)
      if (cancelled || builtHeight !== myHeight) return
      const textContent = await page.getTextContent({ includeMarkedContent: false })
      if (cancelled || builtHeight !== myHeight) return
      layer?.cancel()
      container.replaceChildren()
      container.style.setProperty('--total-scale-factor', String(scale))
      layer = new TextLayer({
        textContentSource: textContent,
        container,
        viewport: page.getViewport({ scale })
      })
      try {
        await layer.render()
      } catch {
        // cancel() render capability'sini AbortException ile REDDEDER; pdf.js'in kendi
        // .catch()'i yalnız iç zinciri kapsar, çağırana döneni değil.
        return
      }
      if (cancelled || builtHeight !== myHeight) return
      pageProxy = page
      divsRef.current = layer.textDivs
      setBuilt((n) => n + 1)
    }

    const guvenliBuild = (): void => {
      void build().catch(() => {
        // Katman hiç kurulamadıysa BU SAYFADA bekleyen istek asılı kalmasın.
        if (!cancelled && reqRef.current) resolveRef.current?.(false)
      })
    }

    const observer = new ResizeObserver(guvenliBuild)
    observer.observe(container)

    return () => {
      cancelled = true
      observer.disconnect()
      layer?.cancel()
      container.replaceChildren()
      divsRef.current = []
      pageProxy = null
    }
  }, [pdf, pageNumber, naturalHeight])

  useEffect(() => {
    // Canlı seçim varken DOM'u YENİDEN YAZMA: paint() span'ın metin düğümlerini
    // söküp attığı için kullanıcının Range'i sessizce çöker (kip açık kalır, Ctrl+C
    // boş kopyalar). Seçim bırakılınca efekt yeniden koşar ve vurgular tazelenir.
    if (selectAt) return
    const needle = foldCase(query.trim())
    for (const div of divsRef.current) paint(div, needle)
  }, [query, built, selectAt])

  // Seçim isteği: katman boyandıktan SONRA koşar (efektler DOM commit'inden sonra),
  // yani .selectable sınıfı uygulanmış ve pointer-events auto olmuştur.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !selectAt || built === 0) return
    if (doneRef.current === selectAt) return
    doneRef.current = selectAt
    resolveRef.current?.(pickWordAt(container, selectAt))
  }, [selectAt, built])

  return (
    <div
      ref={containerRef}
      className={selectAt ? 'find-layer selectable' : 'find-layer'}
      aria-hidden={selectAt ? undefined : true}
    />
  )
}
