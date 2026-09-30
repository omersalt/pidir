import { shell, screen, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { FALLBACK_BG } from './theme'
import { readFiles } from './file-intake'
import { closeRenderWindow } from './markup'

// Yalnız OKUYUCU pencereleri (createWindow ile açılan). markupToPdf'in gizli render
// penceresi buraya GİRMEZ → activeWindow onu seçmez, dosya ona yanlışlıkla gitmez.
const readerWindows = new Set<BrowserWindow>()

// Çoklu pencere: her Pidır penceresi bağımsızdır. Pencere-başına durum (PiP,
// renderer hazır mı, bekleyen dosyalar) WeakMap'te tutulur; işlemler ya gönderen
// (event.sender) ya da odaktaki pencereyi hedefler.
interface WinState {
  ready: boolean
  pipBounds: Electron.Rectangle | null
  pipWasMax: boolean
  pending: string[]
  reveal: (() => void) | null
}
const stateMap = new WeakMap<BrowserWindow, WinState>()
function st(win: BrowserWindow): WinState {
  let s = stateMap.get(win)
  if (!s) {
    s = { ready: false, pipBounds: null, pipWasMax: false, pending: [], reveal: null }
    stateMap.set(win, s)
  }
  return s
}

/** Dosya-bekleyen bir pencereyi belge hazır olduğunda göster. renderer
 * 'first-doc-ready' deyince çağrılır → boş karşılama ekranı hiç görünmez. */
export function revealWindow(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  st(win).reveal?.()
}

/** Menü hızlandırıcıları / diyaloglar için etkin (okuyucu) pencere. Gizli render
 * penceresi ASLA dönmez — yoksa açılan dosya ona gidip ekranda hiçbir şey görünmez. */
export function activeWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && readerWindows.has(focused)) return focused
  for (const w of readerWindows) if (!w.isDestroyed()) return w
  return null
}

/** Açık okuyucu penceresi sayısı (gizli render penceresi hariç). */
export function readerWindowCount(): number {
  return readerWindows.size
}

/** Pencereyi güvenilir biçimde göster + öne getir. Windows foreground-lock'ta salt
 * `focus()` çoğu zaman pencereyi yükseltmez → kısa alwaysOnTop hilesiyle zorla öne al.
 * PiP modundaki pencerede zaten alwaysOnTop açık, dokunma. */
export function showAndFocus(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  if (st(win).pipBounds === null) {
    win.setAlwaysOnTop(true)
    win.show()
    win.focus()
    win.setAlwaysOnTop(false)
  } else {
    win.focus()
  }
  win.moveTop()
}
// Geriye dönük uyum: eski çağrılar odaktaki pencereyi alır.
export function getMainWindow(): BrowserWindow | null {
  return activeWindow()
}

export function toggleDevTools(win?: BrowserWindow | null): void {
  const wc = (win ?? activeWindow())?.webContents
  if (!wc) return
  if (wc.isDevToolsOpened()) wc.closeDevTools()
  else wc.openDevTools({ mode: 'detach' })
}

async function sendToWindow(win: BrowserWindow, paths: string[]): Promise<void> {
  if (win.isDestroyed() || paths.length === 0) return
  win.webContents.send('pdfx:files-opened', await readFiles(paths))
}

/** Bir pencerenin renderer'ı hazır olduğunda bekleyen dosyalarını gönderir. */
export function markReady(win: BrowserWindow | null): void {
  if (!win) return
  const s = st(win)
  s.ready = true
  if (s.pending.length) void sendToWindow(win, s.pending.splice(0))
}

/** Dosyaları hedef (yoksa etkin) pencerede aç; pencere hazır değilse kuyruğa al. */
export async function sendOpenPaths(paths: string[], target?: BrowserWindow | null): Promise<void> {
  if (paths.length === 0) return
  const win = target ?? activeWindow()
  if (!win) return
  const s = st(win)
  if (s.ready) await sendToWindow(win, paths)
  else s.pending.push(...paths)
}

// --- PiP modu (pencere-başına): her zaman üstte, küçük, araçsız pencere ---
const PIP_W = 420
const PIP_H = 600 // 21:30 oranını korur (420 / 0.7)

export function isPip(win?: BrowserWindow | null): boolean {
  const w = win ?? activeWindow()
  return !!w && st(w).pipBounds !== null
}

export function togglePip(win?: BrowserWindow | null): boolean {
  const w = win ?? activeWindow()
  if (!w) return false
  const s = st(w)
  if (s.pipBounds) {
    w.setAlwaysOnTop(false)
    w.setOpacity(1)
    if (s.pipWasMax) w.maximize()
    else w.setBounds(s.pipBounds)
    s.pipWasMax = false
    s.pipBounds = null
  } else {
    // Tam ekrandayken PiP'e geçiş: önce tam ekrandan çık, yoksa PiP kutusu tam
    // ekranın üstüne yazılır ve dönüşte tam ekran boyutu "normal" sanılır.
    if (w.isFullScreen()) w.setFullScreen(false)
    s.pipWasMax = w.isMaximized()
    s.pipBounds = s.pipWasMax ? w.getNormalBounds() : w.getBounds()
    if (s.pipWasMax) w.unmaximize()
    w.setAlwaysOnTop(true, 'floating')
    const area = screen.getDisplayMatching(s.pipBounds).workArea
    w.setBounds({
      x: area.x + area.width - PIP_W - 24,
      y: area.y + area.height - PIP_H - 24,
      width: PIP_W,
      height: PIP_H
    })
  }
  w.webContents.send('pdfx:pip-changed', s.pipBounds !== null)
  return s.pipBounds !== null
}

export function setPipOpacity(value: number, win?: BrowserWindow | null): void {
  const w = win ?? activeWindow()
  if (!w || st(w).pipBounds === null) return
  if (!Number.isFinite(value)) return
  w.setOpacity(Math.min(1, Math.max(0.3, value)))
}

// --- Tam ekran (F11, pencere-başına) ---
export function isFullScreen(win?: BrowserWindow | null): boolean {
  const w = win ?? activeWindow()
  return !!w && !w.isDestroyed() && w.isFullScreen()
}

/** Tam ekrana gir / çık. PiP'teyken anlamsız (küçük, hep üstte panel) → dokunmaz,
 * false döner. Oran kilidi enter/leave olaylarında yönetilir (createWindow). */
export function toggleFullScreen(win?: BrowserWindow | null): boolean {
  const w = win ?? activeWindow()
  if (!w || w.isDestroyed()) return false
  if (st(w).pipBounds !== null) return false
  const next = !w.isFullScreen()
  w.setFullScreen(next)
  return next
}

// --- Kendi (çerçevesiz) pencere düğmelerimiz (pencere-başına) ---
export function minimizeWindow(win?: BrowserWindow | null): void {
  ;(win ?? activeWindow())?.minimize()
}

export function toggleMaximize(win?: BrowserWindow | null): boolean {
  const w = win ?? activeWindow()
  if (!w) return false
  if (w.isMaximized()) w.unmaximize()
  else w.maximize()
  return w.isMaximized()
}

export function closeWindow(win?: BrowserWindow | null): void {
  ;(win ?? activeWindow())?.close()
}

// Windows 11 snap layouts (büyüt düğmesi hover flyout'u) NATIVE büyüt düğmesi ister.
// Bu yüzden titleBarOverlay kullanıyoruz ama sembolleri normalde ARKA PLAN rengine
// boyayarak görünmez yapıyoruz (temiz görünüm); imleç üste gelince renderer bunları
// görünür renge çevirir. Native max düğmesi bölgesi hep var → snap layouts çalışır.
const CAPTION_H = 34
function captionOverlay(symbolsVisible: boolean): Electron.TitleBarOverlay {
  const dark = nativeTheme.shouldUseDarkColors
  const bg = dark ? FALLBACK_BG.dark : FALLBACK_BG.light
  const ink = dark ? '#e0e0dc' : '#3a3a40'
  // Semboller hover-DIŞINDA arka plan rengine boyanır = TAMAMEN görünmez (temiz üst;
  // "fare gelene kadar görünmez olsun" isteği). Native max düğmesi BÖLGESİ yine de var →
  // Windows 11 snap layouts hover flyout'u çalışmaya devam eder (önemli olan düğmenin
  // varlığı, sembol rengi değil). İmleç üste gelince renderer setCaptionSymbols(true)
  // ile sembolleri 'ink'e çevirip görünür yapar.
  return { color: bg, symbolColor: symbolsVisible ? ink : bg, height: CAPTION_H }
}

/** Native pencere düğmelerinin sembollerini göster/gizle (hover ile). */
export function setCaptionSymbols(win: BrowserWindow | null, visible: boolean): void {
  if (!win || win.isDestroyed() || process.platform === 'darwin') return
  win.setTitleBarOverlay?.(captionOverlay(visible))
}

// Açılış penceresi A4 dikey oranında (21:30 = 0.7). Bir PDF sayfası şeklinde.
const ASPECT = 21 / 30
const INIT_H = 1000
const INIT_W = Math.round(INIT_H * ASPECT) // 700

/** Yeni bir Pidır penceresi oluşturur; verilirse renderer hazır olunca `openPaths` açılır. */
export function createWindow(openPaths: string[] = []): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    width: INIT_W,
    height: INIT_H,
    minWidth: Math.round(500 * ASPECT), // 350 — min. de aynı oranda
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    // Native başlık gizli; düğmeler titleBarOverlay ile (snap layouts için) ama
    // sembolleri normalde görünmez (arka plan renginde). Hover'da görünür olurlar.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 12 } }
      : { titleBarOverlay: captionOverlay(false) }),
    backgroundColor: dark ? FALLBACK_BG.dark : FALLBACK_BG.light,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  readerWindows.add(win)
  if (openPaths.length) st(win).pending.push(...openPaths)
  // Dosya beklenen pencere: boş karşılama ekranı anlık parlamasın diye belge
  // hazır olana dek GİZLİ tut (aşağıda ready-to-show + reveal ile).
  const expectsFile = openPaths.length > 0

  // Oranı kilitle: belge yüklense de kendiliğinden bozulmaz; kullanıcı elle
  // boyutlandırınca da 21:30 korunur (PiP setBounds programatik olduğundan muaf).
  win.setAspectRatio(ASPECT)

  // Tam ekran (F11 ya da sistem kaynaklı): oran kilidi tam ekranla çelişir →
  // girerken kaldır, çıkınca geri koy; renderer'a da haber ver (Esc ile çıkış,
  // sürükleme şeridinin kapatılması, menü etiketi buna bakar).
  // 🪤 Durum OLAY ADINDAN alınır, isFullScreen() SORULMAZ: Windows'ta bu olaylar
  // pencere gerçekten değişmeden ÖNCE ve eşzamanlı yayınlanır; sorgu eski değeri
  // döndürüp her şeyi ters kurar (macOS'ta olay geçişten sonra gelir, ikisi de doğru).
  const fsUygula =
    (fs: boolean) =>
    (): void => {
      if (win.isDestroyed()) return
      win.setAspectRatio(fs ? 0 : ASPECT)
      win.webContents.send('pdfx:fullscreen-changed', fs)
    }
  win.on('enter-full-screen', fsUygula(true))
  win.on('leave-full-screen', fsUygula(false))

  let revealTimer: ReturnType<typeof setTimeout> | null = null
  const doReveal = (): void => {
    if (revealTimer) {
      clearTimeout(revealTimer)
      revealTimer = null
    }
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }
  st(win).reveal = doReveal

  win.on('ready-to-show', () => {
    if (!expectsFile) {
      win.show() // dosya yok → karşılama ekranı zaten istenen görünüm, hemen göster
      return
    }
    // Dosya bekleniyor: belge boyanınca renderer 'first-doc-ready' → doReveal.
    // Yedek: 4 sn sonra yine de göster (yükleme çökerse pencere hep gizli kalmasın).
    revealTimer = setTimeout(doReveal, 4000)
  })
  win.on('closed', () => {
    if (revealTimer) clearTimeout(revealTimer)
    stateMap.delete(win)
    readerWindows.delete(win)
    // Son okuyucu penceresi kapandıysa gizli render penceresini de kapat →
    // window-all-closed tetiklenir, süreç zombi kalmaz (tek-instance kilidi çözülür).
    if (readerWindows.size === 0) closeRenderWindow()
  })

  win.webContents.setWindowOpenHandler((details) => {
    // Only hand genuine web/mail links to the OS; never blindly open arbitrary
    // schemes (file:, custom protocols, etc.) that a compromised renderer could craft.
    let protocol = ''
    try {
      protocol = new URL(details.url).protocol
    } catch {
      protocol = ''
    }
    if (protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:') {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  // The renderer is a local single-page app; the only legitimate top-level
  // navigation is the dev server. Block everything else (defense in depth).
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.code !== 'KeyI') return
    const mod = process.platform === 'darwin' ? input.meta : input.control
    if (mod && (input.shift || input.alt)) {
      event.preventDefault()
      toggleDevTools(win)
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
