import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocEntry } from '../types'
import { READER_PAD_X, READER_PAD_Y } from './layout'

const MIN_SCALE = 0.1
const MAX_SCALE = 8
const STEP = 1.15

export type FitMode = 'width' | 'page' | 'custom'

export interface ReaderViewApi {
  /** CSS pikseli / PDF puanı — sayfa gösterim ölçeği. */
  scale: number
  fit: FitMode
  /** Görünür sayfalarda ayrıntı (detail) render'ını tetikleyen sayaç. */
  renderVersion: number
  /** 1-tabanlı geçerli sayfa. */
  currentPage: number
  setCurrentPage: (n: number) => void
  zoomIn: () => void
  zoomOut: () => void
  /** Ctrl+tekerlek için doğrudan çarpan uygula (odak düzeltmesi çağırana ait). */
  applyZoom: (factor: number) => void
  fitWidth: () => void
  fitPage: () => void
  bumpRender: () => void
  recomputeFit: () => void
}

function pageBounds(doc: DocEntry | null): { maxW: number; maxH: number } {
  if (!doc || doc.pages.length === 0) return { maxW: 1, maxH: 1 }
  let maxW = 1
  let maxH = 1
  for (const p of doc.pages) {
    if (p.width > maxW) maxW = p.width
    if (p.height > maxH) maxH = p.height
  }
  return { maxW, maxH }
}

const clamp = (n: number): number => Math.max(MIN_SCALE, Math.min(MAX_SCALE, n))

export function useReaderView(
  doc: DocEntry | null,
  scrollerRef: React.RefObject<HTMLDivElement | null>
): ReaderViewApi {
  const [scale, setScale] = useState(1)
  const [fit, setFit] = useState<FitMode>('width')
  const [renderVersion, setRenderVersion] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fitRef = useRef<FitMode>('width')
  fitRef.current = fit

  const bumpRender = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(() => setRenderVersion((v) => v + 1), 140)
  }, [])

  const computeFitWidth = useCallback((): number => {
    const el = scrollerRef.current
    const { maxW } = pageBounds(doc)
    const avail = (el?.clientWidth ?? window.innerWidth) - READER_PAD_X * 2
    return clamp(avail / maxW)
  }, [doc, scrollerRef])

  const computeFitPage = useCallback((): number => {
    const el = scrollerRef.current
    const { maxW, maxH } = pageBounds(doc)
    const availW = (el?.clientWidth ?? window.innerWidth) - READER_PAD_X * 2
    const availH = (el?.clientHeight ?? window.innerHeight) - READER_PAD_Y * 2
    return clamp(Math.min(availW / maxW, availH / maxH))
  }, [doc, scrollerRef])

  const fitWidth = useCallback(() => {
    setFit('width')
    setScale(computeFitWidth())
    bumpRender()
  }, [computeFitWidth, bumpRender])

  const fitPage = useCallback(() => {
    setFit('page')
    setScale(computeFitPage())
    bumpRender()
  }, [computeFitPage, bumpRender])

  const applyZoom = useCallback(
    (factor: number) => {
      setFit('custom')
      setScale((s) => clamp(s * factor))
      bumpRender()
    },
    [bumpRender]
  )

  const zoomIn = useCallback(() => applyZoom(STEP), [applyZoom])
  const zoomOut = useCallback(() => applyZoom(1 / STEP), [applyZoom])

  const recomputeFit = useCallback(() => {
    if (fitRef.current === 'width') setScale(computeFitWidth())
    else if (fitRef.current === 'page') setScale(computeFitPage())
    bumpRender()
  }, [computeFitWidth, computeFitPage, bumpRender])

  // Yeni belge → genişliğe sığdır, başa sar.
  useEffect(() => {
    if (!doc) return
    setFit('width')
    setCurrentPage(1)
    setScale(computeFitWidth())
    setRenderVersion((v) => v + 1)
    // computeFitWidth doc'a bağlı; sadece doc değişince yeniden sığdır istiyoruz.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  // Pencere/konteyner yeniden boyutlanınca fit modunu tazele.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => recomputeFit())
    ro.observe(el)
    return () => ro.disconnect()
  }, [recomputeFit, scrollerRef])

  // Bekleyen render zamanlayıcısını unmount'ta temizle (setState-after-unmount önle).
  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current)
  }, [])

  return {
    scale,
    fit,
    renderVersion,
    currentPage,
    setCurrentPage,
    zoomIn,
    zoomOut,
    applyZoom,
    fitWidth,
    fitPage,
    bumpRender,
    recomputeFit
  }
}
