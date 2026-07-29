import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { DocEntry } from '../types'
import type { ReaderViewApi } from '../reader/useView'
import { PageView } from './PageView'
import { useFindState } from '../search/FindContext'
import { READER_GAP, READER_PAD_X, READER_PAD_Y, pageAtMid, pageTops } from '../reader/layout'

interface ReaderProps {
  doc: DocEntry
  view: ReaderViewApi
  scrollerRef: React.RefObject<HTMLDivElement | null>
}

const clampScale = (n: number): number => Math.max(0.1, Math.min(8, n))

/**
 * Sürekli dikey kaydırma okuyucusu — "içerik = arayüz". Sayfalar ortalanmış tek
 * bir sütunda dizilir; her sayfa pdfx'ten devralınan PageView ile (temel raster +
 * yakınlaşınca ayrıntı) çizilir. Ctrl+tekerlek imleç odağında yakınlaştırır.
 */
export function Reader({ doc, view, scrollerRef }: ReaderProps): React.JSX.Element {
  const { active, query, matchingPageIds, getOcrWords } = useFindState()
  const pendingFocal = useRef<{ dx: number; dy: number } | null>(null)
  const prevScale = useRef(view.scale)
  const scaleRef = useRef(view.scale)
  scaleRef.current = view.scale
  const applyZoom = view.applyZoom

  // Ctrl+tekerlek yakınlaştırma. React'in onWheel'i pasiftir (preventDefault
  // çalışmaz); doğal non-passive dinleyici bağlıyoruz.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const s = scaleRef.current
      const next = clampScale(s * factor)
      if (next === s) return
      scaleRef.current = next // arka arkaya tekerlek olaylarında clamp erken-çıkışı doğru kalsın
      pendingFocal.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
      applyZoom(factor)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyZoom, scrollerRef])

  // Ölçek değişince odak noktasını imlecin altında sabit tut. Oran, işlenen gerçek
  // ölçek değişiminden türetilir (batch'lenen olaylarda bile doğru); dikey/yatay
  // sabitleme ÖLÇEKLENMEYEN dolgu+boşluk ofseti etrafında yapılır (yoksa aşağı
  // kaydırdıkça odak kayardı).
  useLayoutEffect(() => {
    if (view.scale === prevScale.current) return
    const el = scrollerRef.current
    const focal = pendingFocal.current
    if (el && focal) {
      const ratio = view.scale / prevScale.current
      el.scrollLeft = READER_PAD_X + (el.scrollLeft + focal.dx - READER_PAD_X) * ratio - focal.dx
      const contentY = el.scrollTop + focal.dy
      const kFocal = pageAtMid(pageTops(doc, prevScale.current), contentY)
      const insetY = READER_PAD_Y + kFocal * READER_GAP
      el.scrollTop = insetY + (contentY - insetY) * ratio - focal.dy
      pendingFocal.current = null
    }
    prevScale.current = view.scale
  }, [view.scale, scrollerRef, doc])

  // Kaydırıldıkça: görünür sayfayı güncelle + ayrıntı render'ını tetikle.
  const onScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    view.bumpRender()
    const tops = pageTops(doc, view.scale)
    view.setCurrentPage(pageAtMid(tops, el.scrollTop + el.clientHeight / 2) + 1)
  }, [doc, view, scrollerRef])

  // Klavye ile kaydırma (PgUp/PgDn/ok/boşluk) için kaydırıcıya odaklan.
  useEffect(() => {
    scrollerRef.current?.focus()
  }, [doc, scrollerRef])

  return (
    <div className="reader-scroll" ref={scrollerRef} tabIndex={0} onScroll={onScroll}>
      <div
        className="reader-column"
        style={{ padding: `${READER_PAD_Y}px ${READER_PAD_X}px`, gap: READER_GAP }}
      >
        {doc.pages.map((p, i) => {
          const highlight = active && matchingPageIds.has(p.id)
          return (
            <div
              key={p.id}
              className="reader-page"
              data-page={i}
              style={{ width: p.width * view.scale, height: p.height * view.scale }}
            >
              <PageView
                pdf={p.source.pdf}
                pageNumber={p.pageIndex + 1}
                naturalWidth={p.width}
                naturalHeight={p.height}
                version={view.renderVersion}
                eager={i < 2}
                highlightQuery={highlight ? query : undefined}
                ocrWords={highlight ? getOcrWords(`${p.source.id}:${p.pageIndex}`) : undefined}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
