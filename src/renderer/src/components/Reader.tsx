import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { DocEntry } from '../types'
import type { ReaderViewApi } from '../reader/useView'
import { PageView } from './PageView'
import type { SelReq } from './find-highlight'
import { useFindState } from '../search/FindContext'
import { READER_GAP, READER_PAD_X, READER_PAD_Y, pageAtMid, pageTops } from '../reader/layout'
import { useSurukleKaydir } from '../reader/kaydir'

interface ReaderProps {
  doc: DocEntry
  view: ReaderViewApi
  scrollerRef: React.RefObject<HTMLDivElement | null>
  sel: SelReq | null
  onSel: (r: SelReq) => void
  onClearSel: () => void
  onSelectResolved: (ok: boolean) => void
  /** Tam ekran: el imleci taşma beklemeden hemen çıkar, sürükleme dikeyde de çalışır. */
  tamEkran: boolean
}

const clampScale = (n: number): number => Math.max(0.1, Math.min(8, n))

/**
 * Sürekli dikey kaydırma okuyucusu — "içerik = arayüz". Sayfalar ortalanmış tek
 * bir sütunda dizilir; her sayfa pdfx'ten devralınan PageView ile (temel raster +
 * yakınlaşınca ayrıntı) çizilir. Ctrl+tekerlek imleç odağında yakınlaştırır.
 */
export function Reader({
  doc,
  view,
  scrollerRef,
  sel,
  onSel,
  onClearSel,
  onSelectResolved,
  tamEkran
}: ReaderProps): React.JSX.Element {
  const { active, query, matchingPageIds, getOcrWords } = useFindState()
  const pendingFocal = useRef<{ dx: number; dy: number } | null>(null)
  const prevScale = useRef(view.scale)
  const scaleRef = useRef(view.scale)
  scaleRef.current = view.scale
  const applyZoom = view.applyZoom
  // Son bilinen kaydırma konumu (onScroll'da güncellenir). 🪤 Ölçek küçülürken DOM'a
  // yeni (küçük) sayfa boyutları yazılmış olur ve el.scrollTop, layout etkisi okumadan
  // ÖNCE tarayıcıca yeni sınıra kırpılır; gerçek konum yalnız burada kalır.
  const sonKaydirma = useRef({ left: 0, top: 0 })

  // Belge değişince: yeni dosyada başa sar, düzenleme tazelemesinde (replaceBytes)
  // konumu koru; çapaları tazele ve sayfa sayacını GERÇEK konumdan hesapla (ölçek
  // değişmezse scroll olayı gelmez, sayaç 1'de kalır ve "Bu Sayfayı Döndür" yanlış
  // sayfayı çevirirdi). Ölçek etkisinden ÖNCE bildirildiği için aynı commit'te önce
  // çalışır; sığdırma ölçeği eskisiyle aynı çıksa (A4 → A4) bile çapalar taze kalır.
  const setCurrentPage = view.setCurrentPage
  useLayoutEffect(() => {
    prevScale.current = scaleRef.current
    pendingFocal.current = null
    const el = scrollerRef.current
    if (!el) return
    if (doc.yeniDosya) {
      el.scrollLeft = 0
      el.scrollTop = 0
    }
    sonKaydirma.current = { left: el.scrollLeft, top: el.scrollTop }
    setCurrentPage(pageAtMid(pageTops(doc, scaleRef.current), el.scrollTop + el.clientHeight / 2) + 1)
  }, [doc, scrollerRef, setCurrentPage])

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
    // Odak yoksa (Ctrl+±, sığdır komutları, pencere/tam ekran boyut değişimi →
    // recomputeFit) okunan yeri koru: görünümün üst kenarı + yatay ortası sabit.
    // Yoksa scrollTop piksel olarak aynı kalır ve F11 ile 30. sayfadan 11'e düşülür.
    const focal = pendingFocal.current ?? { dx: el ? el.clientWidth / 2 : 0, dy: 0 }
    if (el) {
      const ratio = view.scale / prevScale.current
      const { left, top } = sonKaydirma.current // el.scrollTop DEĞİL (kırpılmış olabilir)
      el.scrollLeft = READER_PAD_X + (left + focal.dx - READER_PAD_X) * ratio - focal.dx
      const contentY = top + focal.dy
      const kFocal = pageAtMid(pageTops(doc, prevScale.current), contentY)
      const insetY = READER_PAD_Y + kFocal * READER_GAP
      el.scrollTop = insetY + (contentY - insetY) * ratio - focal.dy
      sonKaydirma.current = { left: el.scrollLeft, top: el.scrollTop }
      pendingFocal.current = null
    }
    prevScale.current = view.scale
  }, [view.scale, scrollerRef, doc])

  // Kaydırıldıkça: konumu not et, görünür sayfayı güncelle + ayrıntı render'ını tetikle.
  const onScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    sonKaydirma.current = { left: el.scrollLeft, top: el.scrollTop }
    view.bumpRender()
    const tops = pageTops(doc, view.scale)
    view.setCurrentPage(pageAtMid(tops, el.scrollTop + el.clientHeight / 2) + 1)
  }, [doc, view, scrollerRef])

  // Klavye ile kaydırma (PgUp/PgDn/ok/boşluk) için kaydırıcıya odaklan.
  useEffect(() => {
    scrollerRef.current?.focus()
  }, [doc, scrollerRef])

  // Yakınlaştırılmış belgede el imleci + sol tuşla sürükleyerek kaydırma.
  // Seçim kipi açıkken kapalı: metin katmanının jestleriyle çakışmasın.
  useSurukleKaydir(scrollerRef, { devreDisi: sel !== null, herZaman: tamEkran })

  return (
    <div
      className="reader-scroll"
      ref={scrollerRef}
      tabIndex={0}
      onScroll={onScroll}
      // Seçim kipini AÇAN tek jest: sol çift tık. İmlecin altında metin yoksa
      // katman kapıdan geçemez ve kip hiç açılmamış olur (App.onSelectResolved).
      onDoubleClick={(e) => {
        const pageEl = (e.target as HTMLElement).closest('.reader-page') as HTMLElement | null
        if (!pageEl) return
        const i = Number(pageEl.dataset.page)
        const p = doc.pages[i]
        if (!p) return
        // Taranmış + OCR bitmiş sayfa kapsam DIŞI (yalnız gerçek metin katmanı).
        if (getOcrWords(`${p.source.id}:${p.pageIndex}`)) return
        const r = pageEl.getBoundingClientRect() // bayat-istek kontrolünün çapası
        onSel({ page: i, x: e.clientX, y: e.clientY, px: r.left, py: r.top, pw: r.width })
      }}
      // Kipten çıkış: katmanın dışına SOL tık. Sağ/orta tık seçimi BOZMAMALI —
      // yoksa "seç, sonra yanına sağ tık → Kopyala" akışında menü boş seçim görür.
      onMouseDown={(e) => {
        if (e.button !== 0) return
        if (sel && !(e.target as Element).closest('.find-layer')) onClearSel()
      }}
    >
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
                // DİKKAT: burada yeni nesne KURMA. Reader her kaydırmada yeniden
                // render oluyor; yeni kimlik seçim efektini her karede tetiklerdi.
                selectAt={sel?.page === i ? sel : undefined}
                onSelectResolved={onSelectResolved}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
