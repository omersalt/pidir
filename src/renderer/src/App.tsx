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
import { katmandaSecim } from './reader/kopyala'
import type { SelReq } from './components/find-highlight'
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
  const [fs, setFs] = useState(false) // tam ekran (F11); kaynak ana süreç olayları
  const [barShown, setBarShown] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [pillShown, setPillShown] = useState(false)
  const pillTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFindScroll = useRef('')
  // Metin seçim kipi. `sel` yalnız ÇİFT TIK ile dolar; katman kapıdan geçemezse
  // onSelectResolved(false) ile hemen null'a döner (kip hiç açılmamış olur).
  const [sel, setSel] = useState<SelReq | null>(null)
  const [selText, setSelText] = useState('')
  const ilkSecim = useRef(false)

  const flash = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  const clearSel = useCallback(() => {
    setSel(null)
    // ZORUNLU: arama açıkken katman SÖKÜLMEZ, yalnız .selectable düşer. DOM'da kalan
    // bayat bir Range'i webContents.copy() kopyalamaya devam ederdi.
    window.getSelection()?.removeAllRanges()
  }, [])

  const onSelectResolved = useCallback(
    (ok: boolean) => {
      if (!ok) {
        // setSel(null) YETMEZ: arama açıkken katman SÖKÜLMEZ; bayat bir DOM Range
        // kalırsa webContents.copy() onu kopyalamaya devam eder.
        clearSel()
        return
      }
      if (!ilkSecim.current) {
        ilkSecim.current = true
        flash(isMac ? '⌘C ile kopyala' : 'Ctrl+C ile kopyala')
      }
    },
    [clearSel, flash]
  )

  // Panoya yazmanın TEK doğru yeri: `copy` olayı. Windows'ta Blink'in yerleşik
  // editing komutu, macOS'ta menu.ts'teki { role: 'editMenu' } → webContents.copy()
  // İKİSİ de bu olayı ateşler. keydown'a `case 'c'` eklemek mac'te çakışır ve
  // panoya iki kez yazardı.
  useEffect(() => {
    const onCopy = (e: ClipboardEvent): void => {
      const text = katmandaSecim()
      if (!text) return // girdi kutularındaki doğal kopyalamaya DOKUNMA
      e.clipboardData?.setData('text/plain', text)
      e.preventDefault()
      window.api.olay('kopyala')
    }
    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
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

  // Belge değişince kipi kapat: `sel.page` bayat bir indekse işaret ederse yeni
  // belgenin BAŞKA bir sayfasında kip kendiliğinden açılırdı.
  useEffect(() => {
    clearSel()
    ilkSecim.current = false
  }, [doc, clearSel])

  // Dosyayla açılışta pencere, belge hazır olana dek GİZLİ tutulur (main süreç);
  // ilk belge boyanınca burada main'e haber verilir → pencere o an gösterilir, böylece
  // boş karşılama ekranı hiç parlamamış olur. İki rAF = ilk kare gerçekten boyandı.
  const ilkGosterimYapildi = useRef(false)
  useEffect(() => {
    if (doc && !ilkGosterimYapildi.current) {
      ilkGosterimYapildi.current = true
      requestAnimationFrame(() => requestAnimationFrame(() => void window.api.firstDocReady()))
    }
  }, [doc])
  const docs = useMemo<DocEntry[]>(() => (doc ? [doc] : []), [doc])
  const view = useReaderView(doc, scrollerRef)

  // OCR kapısı: taranmış sayfaların taranması yalnız kullanıcı aramayı açınca başlar.
  // Ayrı bir state olmasının nedeni sıra: searchIndex, find'dan ÖNCE kurulmak zorunda
  // (find onun search/version'ına dayanıyor), yani find.open'ı doğrudan veremiyoruz.
  const [ocrEnabled, setOcrEnabled] = useState(false)
  const searchIndex = useSearchIndex(docs, ocrEnabled)
  const find = useFind(searchIndex.search, searchIndex.version)
  useEffect(() => {
    setOcrEnabled(find.open)
    if (find.open) window.api.olay('arama')
  }, [find.open])

  // Taranmış belge saptanıp OCR kuyruğa girdiğinde bir kez bildir.
  const ocrBildirildi = useRef(false)
  useEffect(() => {
    if (searchIndex.hasScanned && !ocrBildirildi.current) {
      ocrBildirildi.current = true
      window.api.olay('ocr')
    }
  }, [searchIndex.hasScanned])
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
      window.api.olay('kaydet')
      flash(`Kaydedildi: ${saved}`)
    } catch {
      flash('Kaydedilemedi')
    }
  }, [docApi, flash])

  const editingRef = useRef(false)
  const applyEdit = useCallback(
    async (
      fn: (bytes: Uint8Array) => Promise<Uint8Array>,
      okMsg: string,
      failMsg = 'İşlem başarısız'
    ) => {
      if (editingRef.current) {
        // Eşzamanlı düzenlemeler birbirini ezmesin: replaceBytes SON BİTENİ commit
        // ettiği için, uzun süren bir işlem uçarken yapılan ikinci düzenleme sessizce
        // kaybolurdu. Sessiz return yerine kullanıcıya söylüyoruz.
        flash('Önceki işlem sürüyor — bitmesini bekleyin')
        return
      }
      const bytes = docApi.bytes()
      if (!bytes) return
      if (await isEncrypted(bytes)) {
        flash('Şifreli PDF düzenlenemez — önce şifreyi kaldırın')
        return
      }
      editingRef.current = true
      try {
        await docApi.replaceBytes(await fn(bytes))
        window.api.olay('duzenle')
        flash(okMsg)
      } catch {
        flash(failMsg)
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

  // Sadeleştirme Python sidecar'ı olduğu için SANİYELER sürer. Kendi yolunda kalsaydı
  // applyEdit'in kilidini atlar, bu sırada yapılan bir döndürme "Sayfa döndürüldü"
  // bildirimi verip sessizce ezilirdi (replaceBytes son biteni commit eder).
  const simplify = useCallback(() => {
    if (!docApi.bytes()) return
    flash('Sadeleştiriliyor…')
    return applyEdit(
      (b) => window.api.sidecar(b, { cmd: 'sadelestir', topMm: 18, bottomMm: 18 }),
      'Üst/alt bilgi temizlendi',
      'Sadeleştirme için Python + PyMuPDF gerekli'
    )
  }, [applyEdit, docApi, flash])

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

  const togglePip = useCallback(() => {
    window.api.olay('pip')
    void window.api.pipToggle()
  }, [])

  // Tam ekran (F11). Durum ana süreçten gelir (enter/leave olayları) → sistem
  // kaynaklı değişimlerde de arayüz doğru kalır.
  const toggleFs = useCallback(() => {
    window.api.olay('tamekran')
    // Dönen değer hedef durumdur; olay bildirimi de gelir, bu ikinci güvence.
    void window.api.fullScreenToggle().then((v) => setFs(!!v))
  }, [])

  // Açık belge bir markdown kaynağından mı geldi? (Ad .pdf'e döner, ama docApi.path
  // ORİJİNAL .md yolunu tutar.) Öyleyse Ctrl+E ile Sublime'da düzenlenebilir.
  const mdSource = useMemo(
    () => (/\.(md|markdown|mdown|mkd|txt|text|log)$/i.test(docApi.path || '') ? docApi.path : null),
    [docApi.path]
  )
  const editSource = useCallback(async () => {
    if (!mdSource) return
    const res = await window.api.openInEditor(mdSource)
    flash(res.ok ? `${res.editor}'da açıldı` : 'Editör açılamadı')
  }, [mdSource, flash])

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
  useEffect(() => {
    void window.api.fullScreenState().then((v) => setFs(!!v))
    return window.api.onFullScreenChanged((next) => setFs(next))
  }, [])

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
      if (e.repeat) return // basılı tutulan Esc katmanları art arda kapatmasın
      if (menu) setMenu(null)
      else if (pagesOpen) setPagesOpen(false)
      else if (sel) clearSel()
      else if (find.open) find.closeFind()
      else if (fs) toggleFs()
      else if (pip) togglePip()
      return
    }
    if (e.key === 'F11') {
      e.preventDefault()
      // Tuş tekrarı tam ekranı açıp kapatmasın; PiP'te ana süreç zaten reddeder,
      // boş telemetri olayı da yazılmasın.
      if (!e.repeat && !pip) toggleFs()
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
      case 'a':
      case 'A': {
        if (isMac) break // native Select All rolü preventDefault'u dinlemez
        const ae = document.activeElement
        if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement) break
        const layer = document.querySelector('.find-layer.selectable')
        if (!layer) break
        e.preventDefault()
        const r = document.createRange()
        r.selectNodeContents(layer)
        const sn = window.getSelection()
        sn?.removeAllRanges()
        sn?.addRange(r)
        break
      }
      case 'e':
      case 'E':
        // Yalnız markdown belgelerinde: kaynağı Sublime/Notepad'de aç (PİDİR yazmaz).
        if (mdSource) {
          e.preventDefault()
          void editSource()
        }
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
      {
        label: 'Kopyala',
        shortcut: acc('Ctrl+C'),
        disabled: !selText,
        onClick: () => {
          void window.api.writeClipboardText(selText)
          window.api.olay('kopyala')
        }
      },
      { label: '', separator: true },
      {
        label: 'Sayfalar…',
        disabled: !hasDoc,
        onClick: () => {
          clearSel() // PageManager Reader'ı tamamen örter; görünmez kip Escape'i yutmasın
          setPagesOpen(true)
        }
      },
      { label: 'Bu Sayfayı Döndür', disabled: !hasDoc, onClick: () => void rotateCurrent() },
      { label: 'Sadeleştir (üst/alt bilgi)', disabled: !hasDoc, onClick: () => void simplify() },
      ...(mdSource
        ? [
            { label: '', separator: true },
            {
              label: 'Kaynağı Düzenle (Sublime)',
              shortcut: acc('Ctrl+E'),
              onClick: () => void editSource()
            }
          ]
        : []),
      { label: '', separator: true },
      {
        label: pip ? 'PiP Modundan Çık' : 'PiP Modu',
        shortcut: acc('Ctrl+P'),
        disabled: !hasDoc,
        onClick: togglePip
      },
      {
        label: fs ? 'Tam Ekrandan Çık' : 'Tam Ekran',
        shortcut: 'F11',
        disabled: pip, // PiP paneli tam ekrana geçmez; önce PiP'ten çık
        onClick: toggleFs
      }
    ]
  }, [
    doc,
    docApi,
    saveAs,
    view,
    find,
    rotateCurrent,
    simplify,
    pip,
    togglePip,
    fs,
    toggleFs,
    mdSource,
    editSource,
    selText,
    clearSel
  ])

  return (
    <FindProvider value={findState}>
      <div
        className={
          'reader-root' + (dragActive ? ' drag' : '') + (pip ? ' pip' : '') + (fs ? ' fs' : '')
        }
        onMouseMove={onMouseMove}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onContextMenu={(e) => {
          e.preventDefault()
          // Menü öğeleri ayrı bir DOM dalındaki <button>'lar; onClick anında seçimi
          // okumak güvenilmez. Anlık görüntüyü menüyle AYNI ANDA al.
          setSelText(katmandaSecim())
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        onDragOver={(e) => {
          // user-select:text metin sürüklemeyi mümkün kıldı; onDragLeave yalnız
          // relatedTarget === null iken temizlediği için gösterge asılı kalırdı.
          if (!e.dataTransfer.types.includes('Files')) return
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
          <Reader
            doc={doc}
            view={view}
            scrollerRef={scrollerRef}
            sel={sel}
            onSel={setSel}
            onClearSel={clearSel}
            onSelectResolved={onSelectResolved}
          />
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
