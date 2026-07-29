import { shell, screen, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { FALLBACK_BG } from './theme'
import { readFiles } from './file-intake'

// Çoklu pencere: her Pidır penceresi bağımsızdır. Pencere-başına durum (PiP,
// renderer hazır mı, bekleyen dosyalar) WeakMap'te tutulur; işlemler ya gönderen
// (event.sender) ya da odaktaki pencereyi hedefler.
interface WinState {
  ready: boolean
  pipBounds: Electron.Rectangle | null
  pipWasMax: boolean
  pending: string[]
}
const stateMap = new WeakMap<BrowserWindow, WinState>()
function st(win: BrowserWindow): WinState {
  let s = stateMap.get(win)
  if (!s) {
    s = { ready: false, pipBounds: null, pipWasMax: false, pending: [] }
    stateMap.set(win, s)
  }
  return s
}

/** Menü hızlandırıcıları / diyaloglar için etkin (odaktaki) pencere. */
export function activeWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
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

  if (openPaths.length) st(win).pending.push(...openPaths)

  // Oranı kilitle: belge yüklense de kendiliğinden bozulmaz; kullanıcı elle
  // boyutlandırınca da 21:30 korunur (PiP setBounds programatik olduğundan muaf).
  win.setAspectRatio(ASPECT)

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => stateMap.delete(win))

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
