import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReaderDoc } from './reader/useDoc'
import { useReaderView } from './reader/useView'
import { useSearchIndex } from './search/useSearchIndex'
import { useFind } from './app/useFind'
import { FindProvider } from './search/FindContext'
import { FindBar } from './components/FindBar'
import { Reader } from './components/Reader'
import { TopBar } from './components/TopBar'
import { EmptyState } from './components/EmptyState'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { PageManager } from './components/PageManager'
import { CloseIcon } from './components/icons'
import { deletePages, extractPages, isEncrypted, reorderPages, rotatePages } from './reader/edit'
import { pageTops } from './reader/layout'
import type { DocEntry } from './types'

const TOAST_MS = 3500
const isMac = window.api.platform === 'darwin'
const isWin = window.api.platform === 'win32'

export default function App(): React.JSX.Element {
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [pagesOpen, setPagesOpen] = useState(false)
  const [pip, setPip] = useState(false)
  const [barShown, setBarShown] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [pillShown, setPillShown] = useState(false)
  const pillTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFindScroll = useRef('')

  const flash = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  // Bekleyen zamanlayıcıları unmount'ta temizle (setState-after-unmount önle).
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
      if (pillTimer.current) clearTimeout(pillTimer.current)
    },
    []
  )

  const docApi = useReaderDoc(flash)
  const { doc } = docApi
  const docs = useMemo<DocEntry[]>(() => (doc ? [doc] : []), [doc])
  const view = useReaderView(doc, scrollerRef)

  const searchIndex = useSearchIndex(docs)
  const find = useFind(searchIndex.search, searchIndex.version)
  const findState = useMemo(
    () => ({
      active: find.active,
      query: find.matchedQuery,
      matchingDocIds: find.result.docIds,
      matchingPageIds: find.result.pageIds,
      getOcrWords: searchIndex.getOcrWords
    }),
    [find.active, find.matchedQuery, find.result, searchIndex.getOcrWords]
  )

  // Sayfa değişince alt-orta göstergeyi kısa süre göster.
  useEffect(() => {
    if (!doc) return
    setPillShown(true)
    if (pillTimer.current) clearTimeout(pillTimer.current)
    pillTimer.current = setTimeout(() => setPillShown(false), 1100)
  }, [view.currentPage, doc])

  // --- Kaydetme / düzenleme ---
  const saveAs = useCallback(async () => {
    const bytes = docApi.bytes()
    if (!bytes) return
    const base = (docApi.name || 'belge').replace(/\.pdf$/i, '')
    const target = await window.api.chooseSavePath(`${base}.pdf`, { name: 'PDF', extensions: ['pdf'] })
    if (!target) return
    try {
      const saved = await window.api.writeFile(target, bytes)
      flash(`Kaydedildi: ${saved}`)
    } catch {
      flash('Kaydedilemedi')
    }
  }, [docApi, flash])

  const editingRef = useRef(false)
  const applyEdit = useCallback(
    async (fn: (bytes: Uint8Array) => Promise<Uint8Array>, okMsg: string) => {
      if (editingRef.current) return // eşzamanlı düzenlemeler birbirini ezmesin / canlı pdf'i yok etmesin
      const bytes = docApi.bytes()
      if (!bytes) return
      if (await isEncrypted(bytes)) {
        flash('Şifreli PDF düzenlenemez — önce şifreyi kaldırın')
        return
      }
      editingRef.current = true
      try {
        await docApi.replaceBytes(await fn(bytes))
        flash(okMsg)
      } catch {
        flash('İşlem başarısız')
      } finally {
        editingRef.current = false
      }
    },
    [docApi, flash]
  )

  const rotateCurrent = useCallback(
    () => applyEdit((b) => rotatePages(b, [view.currentPage - 1], 90), 'Sayfa döndürüldü'),
    [applyEdit, view.currentPage]
  )

  const simplify = useCallback(async () => {
    const bytes = docApi.bytes()
    if (!bytes) return
    flash('Sadeleştiriliyor…')
    try {
      const out = await window.api.sidecar(bytes, { cmd: 'sadelestir', topMm: 18, bottomMm: 18 })
      await docApi.replaceBytes(out)
      flash('Üst/alt bilgi temizlendi')
    } catch {
      flash('Sadeleştirme için Python + PyMuPDF gerekli')
    }
  }, [docApi, flash])

  // Sayfa yöneticisi eylemleri
  const pmDelete = useCallback(
    (idx: number[]) => void applyEdit((b) => deletePages(b, idx), 'Sayfa(lar) silindi'),
    [applyEdit]
  )
  const pmRotate = useCallback(
    (idx: number[], delta: number) => void applyEdit((b) => rotatePages(b, idx, delta), 'Döndürüldü'),
    [applyEdit]
  )
  const pmReorder = useCallback(
    (order: number[]) => void applyEdit((b) => reorderPages(b, order), 'Yeniden sıralandı'),
    [applyEdit]
  )
  const pmExtract = useCallback(
    async (idx: number[]) => {
      const bytes = docApi.bytes()
      if (!bytes) return
      if (await isEncrypted(bytes)) {
        flash('Şifreli PDF düzenlenemez — önce şifreyi kaldırın')
        return
      }
      const base = (docApi.name || 'belge').replace(/\.pdf$/i, '')
      const target = await window.api.chooseSavePath(`${base}-secili.pdf`, {
        name: 'PDF',
        extensions: ['pdf']
      })
      if (!target) return
      try {
        await window.api.writeFile(target, await extractPages(bytes, idx))
        flash('Seçili sayfalar kaydedildi')
      } catch {
        flash('Kaydedilemedi')
      }
    },
    [docApi, flash]
  )

  const togglePip = useCallback(() => void window.api.pipToggle(), [])

  const scrollToPage = useCallback(
    (n: number) => {
      const el = scrollerRef.current
      if (!el || !doc) return
      const tops = pageTops(doc, view.scale)
      const top = tops[Math.max(0, Math.min(tops.length - 1, n - 1))]
      el.scrollTo({ top: Math.max(0, top - 12), behavior: 'smooth' })
    },
    [doc, view.scale]
  )

  // Arama: yeni eşleşen sorguda ilk eşleşen sayfaya kaydır.
  useEffect(() => {
    if (!find.active || !doc) {
      lastFindScroll.current = ''
      return
    }
    if (find.result.pageIds.size === 0) return
    if (lastFindScroll.current === find.matchedQuery) return
    const i = doc.pages.findIndex((p) => find.result.pageIds.has(p.id))
    if (i >= 0) {
      scrollToPage(i + 1)
      lastFindScroll.current = find.matchedQuery
    }
  }, [find.active, find.matchedQuery, find.result, doc, scrollToPage])

  useEffect(() => window.api.onPipChanged((next) => setPip(next)), [])

  // Native pencere düğmelerinin sembolleri yalnız üstte hover'da görünür (snap
  // layouts için düğmeler hep var ama normalde arka plan renginde/görünmez).
  useEffect(() => {
    void window.api.captionSymbols(barShown)
  }, [barShown])

  // TÜM uygulama kısayolları renderer'da ele alınır — çerçevesiz pencerede (frame:false)
  // menü hızlandırıcıları ateşlenmez. latest-ref ile tek kayıt, her zaman güncel mantık.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {})
  keyHandler.current = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      if (menu) setMenu(null)
      else if (pagesOpen) setPagesOpen(false)
      else if (find.open) find.closeFind()
      else if (pip) togglePip()
      return
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    switch (e.key) {
      case 'n':
      case 'N':
        e.preventDefault()
        void window.api.newWindow()
        break
      case 'o':
      case 'O':
        e.preventDefault()
        void docApi.openViaDialog()
        break
      case 's':
      case 'S':
        e.preventDefault()
        void saveAs()
        break
      case 'p':
      case 'P':
        e.preventDefault()
        togglePip()
        break
      case 'f':
      case 'F':
        e.preventDefault()
        find.openFind()
        break
      case '=':
      case '+':
        e.preventDefault()
        view.zoomIn()
        break
      case '-':
      case '_':
        e.preventDefault()
        view.zoomOut()
        break
      case '0':
        e.preventDefault()
        view.fitWidth()
        break
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => keyHandler.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    setBarShown(e.clientY < 64)
  }, [])

  const openMenuAt = useCallback((x: number, y: number) => setMenu({ x, y }), [])

  const menuItems = useMemo<MenuItem[]>(() => {
    const hasDoc = !!doc
    const acc = (s: string): string => (isMac ? s.replace('Ctrl', '⌘') : s)
    return [
      { label: 'Aç…', shortcut: acc('Ctrl+O'), onClick: () => void docApi.openViaDialog() },
      { label: 'Yeni Pencere', shortcut: acc('Ctrl+N'), onClick: () => void window.api.newWindow() },
      { label: 'Farklı Kaydet…', shortcut: acc('Ctrl+S'), disabled: !hasDoc, onClick: () => void saveAs() },
      { label: '', separator: true },
      { label: 'Yakınlaştır', shortcut: acc('Ctrl++'), disabled: !hasDoc, onClick: () => view.zoomIn() },
      { label: 'Uzaklaştır', shortcut: acc('Ctrl+-'), disabled: !hasDoc, onClick: () => view.zoomOut() },
      { label: 'Genişliğe Sığdır', shortcut: acc('Ctrl+0'), disabled: !hasDoc, onClick: () => view.fitWidth() },
      { label: 'Sayfaya Sığdır', disabled: !hasDoc, onClick: () => view.fitPage() },
      { label: 'Ara…', shortcut: acc('Ctrl+F'), disabled: !hasDoc, onClick: () => find.openFind() },
      { label: '', separator: true },
      { label: 'Sayfalar…', disabled: !hasDoc, onClick: () => setPagesOpen(true) },
      { label: 'Bu Sayfayı Döndür', disabled: !hasDoc, onClick: () => void rotateCurrent() },
      { label: 'Sadeleştir (üst/alt bilgi)', disabled: !hasDoc, onClick: () => void simplify() },
      { label: '', separator: true },
      {
        label: pip ? 'PiP Modundan Çık' : 'PiP Modu',
        shortcut: acc('Ctrl+P'),
        disabled: !hasDoc,
        onClick: togglePip
      }
    ]
  }, [doc, docApi, saveAs, view, find, rotateCurrent, simplify, pip, togglePip])

  return (
    <FindProvider value={findState}>
      <div
        className={'reader-root' + (dragActive ? ' drag' : '') + (pip ? ' pip' : '')}
        onMouseMove={onMouseMove}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (!dragActive) setDragActive(true)
        }}
        onDragLeave={(e) => {
          if (e.relatedTarget === null) setDragActive(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragActive(false)
          const files = Array.from(e.dataTransfer.files)
          if (files.length) void docApi.openDropped(files)
        }}
      >
        {doc ? (
          <Reader doc={doc} view={view} scrollerRef={scrollerRef} />
        ) : (
          <EmptyState
            onOpen={() => void docApi.openViaDialog()}
            lastPath={docApi.lastPath}
            onReopen={() => void docApi.reopenLast()}
            dragActive={dragActive}
          />
        )}

        {/* Kalıcı, görünmez pencere-taşıma şeridi — İÇERİKTEN SONRA konumlanır ki
            tam-kaplayan içerik (no-drag) Chromium app-region hesabında sürükleme
            bölgesini eksiltmesin (DOM sırası: sonraki kazanır). Üst çubuk düğmeleri
            bundan SONRA gelir → tıklanabilir kalır. */}
        <div
          className={'win-drag' + (isWin ? ' win' : '') + (isMac ? ' mac' : '')}
          aria-hidden="true"
        />

        {doc && !pip && (
          <TopBar
            name={docApi.name}
            page={view.currentPage}
            total={doc.pages.length}
            scale={view.scale}
            mac={isMac}
            win={isWin}
            show={barShown || !!menu}
            onOpen={() => void docApi.openViaDialog()}
            onZoomIn={() => view.zoomIn()}
            onZoomOut={() => view.zoomOut()}
            onFitWidth={() => view.fitWidth()}
            onFind={() => find.openFind()}
            onMenu={openMenuAt}
          />
        )}

        {doc && (
          <div className={'page-pill' + (pillShown && !pip ? ' show' : '')}>
            {view.currentPage} / {doc.pages.length}
          </div>
        )}

        {/* PiP modunda çıkış açık değildi: hover'da beliren küçük çık + kapat kümesi. */}
        {pip && (
          <div className={'pip-controls' + (hovering ? ' show' : '')}>
            <button className="icon-btn" title="PiP'ten çık (Ctrl+P)" onClick={togglePip}>
              <svg
                width={15}
                height={15}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
              </svg>
            </button>
            <button
              className="icon-btn win-ctrl close"
              title="Kapat"
              onClick={() => void window.api.winClose()}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )}

        {find.open && doc && (
          <FindBar
            query={find.query}
            result={find.result}
            ocrRemaining={searchIndex.ocrRemaining}
            hasScanned={searchIndex.hasScanned}
            ocrLanguage={searchIndex.ocrLanguage}
            onQuery={find.setQuery}
            onOcrLanguage={searchIndex.setOcrLanguage}
            onClose={find.closeFind}
          />
        )}

        {pagesOpen && doc && (
          <PageManager
            doc={doc}
            onClose={() => setPagesOpen(false)}
            onDelete={pmDelete}
            onRotate={pmRotate}
            onExtract={pmExtract}
            onReorder={pmReorder}
          />
        )}

        {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}

        {toast && <div className="toast">{toast}</div>}
      </div>
    </FindProvider>
  )
}
