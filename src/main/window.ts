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
  /** Pencerenin istenen en/boy oranı (genişlik/yükseklik). Belge açılınca renderer
   *  belgenin sayfa oranını gönderir; dikey kilit açıksa hep 21:30. Tam ekran ve PiP
   *  bu değeri bozmaz, çıkışta geri gelir. */
  aspect: number
  /** Oran değişti ama pencere o an tam ekran / PiP / büyütülmüş olduğu için
   *  yeniden boyutlanamadı → ilk uygun anda (çıkışta, unmaximize'da) uygulanır. */
  boyutBekliyor: boolean
  /** Kullanıcı pencereyi sürüklüyor (will-move … moved). Bu sırada setBounds yapılmaz. */
  tasiniyor: boolean
}
const stateMap = new WeakMap<BrowserWindow, WinState>()
function st(win: BrowserWindow): WinState {
  let s = stateMap.get(win)
  if (!s) {
    s = {
      ready: false,
      pipBounds: null,
      pipWasMax: false,
      pending: [],
      reveal: null,
      aspect: ASPECT,
      boyutBekliyor: false,
      tasiniyor: false
    }
    stateMap.set(win, s)
  }
  return s
}

// Varsayılan pencere oranı: A4 dikey (21:30 = 0.7). Belge açılınca yerini belgenin oranına
// bırakır; "dikey kilit" açıksa her belge bu orana zorlanır.
const ASPECT = 21 / 30
const ORAN_MIN = 0.25 // 1:4'ten dar / 4:1'den yassı pencere anlamsız
const ORAN_MAX = 4
// En küçük pencere (createWindow ve PiP kutusu aynı sınırı kullanır).
const MIN_W = 320
const MIN_H = 240

/** Pencerenin en/boy oranını belgeye (ya da kilide) göre ayarla. `resize` ile pencere
 * de o orana getirilir: uzun kenar korunur (dikey→yatay geçişte yükseklik genişlik olur),
 * çalışma alanına sığdırılır, konumu ekran içinde tutulur. Pencere zaten bu orandaysa
 * boyutuna ve yerine dokunulmaz. Tam ekran / PiP / büyütülmüş penceredeyken yalnız
 * kaydedilir (`boyutBekliyor`) ve `bekleyeniUygula` ile ilk uygun anda uygulanır. */
export function setWindowAspect(win: BrowserWindow | null, ratio: number, resize: boolean): void {
  const w = win ?? activeWindow()
  if (!w || w.isDestroyed() || !Number.isFinite(ratio)) return
  const s = st(w)
  const b = w.getBounds()
  const area = screen.getDisplayMatching(b).workArea
  const maxW = Math.floor(area.width * 0.96)
  const maxH = Math.floor(area.height * 0.96)
  // Oranı hem mutlak sınırlara hem de en küçük pencere boyutuyla ÇELİŞMEYECEK aralığa kırp:
  // aşırı dar belgede (fiş, uzun web sayfası) ekrana sığan yükseklikte genişlik MIN_W'nin
  // altına düşerdi ve kilit ile alt sınır çatışırdı; aşırı yassıda MIN_H için aynısı.
  const oran = Math.min(
    Math.min(ORAN_MAX, maxW / MIN_H),
    Math.max(Math.max(ORAN_MIN, MIN_W / maxH), ratio)
  )
  s.aspect = oran
  if (s.pipBounds !== null) {
    // PiP kutusu yeni oranı hemen alsın: kilit de güncellenir (elle boyutlamada eski oran
    // kalmasın), kutunun SAĞ ALT köşesi yerinde kalır (kullanıcı taşıdıysa zıplamasın).
    // Ana pencere çıkışta uyar (boyutBekliyor).
    if (resize) s.boyutBekliyor = true
    const k = pipKutusu(oran, area)
    // Kilit kutunun GERÇEK oranına kurulur (uç oranda kutu MIN/%60 sınırlarıyla belge
    // oranından sapar; kilit belge oranında kalsa elle boyutlamada kutu zıplardı).
    // PiP çıkışında kilit yine s.aspect'e döner.
    w.setAspectRatio(k.width / k.height)
    const x = Math.min(Math.max(b.x + b.width - k.width, area.x), area.x + area.width - k.width)
    const y = Math.min(Math.max(b.y + b.height - k.height, area.y), area.y + area.height - k.height)
    w.setBounds({ x, y, width: k.width, height: k.height })
    return
  }
  if (w.isFullScreen()) {
    if (resize) s.boyutBekliyor = true // leave-full-screen'de uygulanır
    return
  }
  w.setAspectRatio(oran)
  if (w.isMaximized()) {
    if (resize) s.boyutBekliyor = true // unmaximize'da uygulanır
    return
  }
  if (!resize) return
  s.boyutBekliyor = false
  if (Math.abs(b.width / b.height - oran) / oran < 0.01) return // zaten bu oranda: dokunma
  const uzun = Math.max(b.width, b.height)
  let width = oran >= 1 ? uzun : Math.round(uzun * oran)
  let height = oran >= 1 ? Math.round(uzun / oran) : uzun
  if (width > maxW) {
    width = maxW
    height = Math.round(width / oran)
  }
  if (height > maxH) {
    height = maxH
    width = Math.round(height * oran)
  }
  // Alt sınırın altına düşen kenarı ORANI KORUYARAK büyüt (yalnız o kenarı çekmek
  // pencereyi kilitten farklı bir biçime sokar, ilk elle boyutlamada zıplardı).
  // Oran kırpması [MIN_W/maxH, maxW/MIN_H] sayesinde sonuç çalışma alanını aşmaz.
  if (width < MIN_W) {
    width = MIN_W
    height = Math.round(MIN_W / oran)
  }
  if (height < MIN_H) {
    height = MIN_H
    width = Math.round(MIN_H * oran)
  }
  width = Math.max(MIN_W, width) // yuvarlama güvencesi
  height = Math.max(MIN_H, height)
  const x = Math.min(Math.max(b.x, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(b.y, area.y), area.y + area.height - height)
  w.setBounds({ x, y, width, height })
}

/** Tam ekran / PiP / büyütme sırasında değişen oranı, pencere serbest kalınca uygula. */
function bekleyeniUygula(w: BrowserWindow): void {
  if (w.isDestroyed()) return
  const s = st(w)
  if (!s.boyutBekliyor || s.tasiniyor || w.isFullScreen() || s.pipBounds !== null || w.isMaximized()) return
  setWindowAspect(w, s.aspect, true)
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
// Kutu pencerenin geçerli oranını izler: dikey belgede 420×600 (21:30), yatay
// belgede en küçük yükseklik sınırına takılmadan genişler (16:9'da 427×240).
const PIP_W = 420
function pipKutusu(oran: number, area: Electron.Rectangle): Electron.Rectangle {
  // Küçük kutu: dikey belgede 420×600 (eski sabit kutu), yatayda 427×240. İki eksende
  // de sınırlı: yükseklik çalışma alanının %60'ını, genişlik %90'ını aşmaz (dar bir fiş
  // belgesi kutuyu ekran boyu yapmasın); kısa kenar MIN altına inmez (yoksa Windows onu
  // kendisi çeker ve kutu görev çubuğunun altına taşar). Uç oranda oran hafif bozulur.
  const maxW = Math.round(area.width * 0.9)
  const maxH = Math.round(area.height * 0.6)
  let h = Math.max(MIN_H, Math.round(PIP_W / oran))
  let w = Math.max(PIP_W, Math.round(h * oran))
  if (h > maxH) {
    h = maxH
    w = Math.round(h * oran)
  }
  if (w > maxW) {
    w = maxW
    h = Math.round(w / oran)
  }
  w = Math.max(MIN_W, w)
  h = Math.max(MIN_H, Math.min(maxH, h))
  return {
    x: Math.max(area.x, area.x + area.width - w - 24),
    y: Math.max(area.y, area.y + area.height - h - 24),
    width: w,
    height: h
  }
}

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
    const eskiBounds = s.pipBounds
    const eskiMax = s.pipWasMax
    s.pipWasMax = false
    s.pipBounds = null
    // Kilit PiP boyunca güncellenmemişti (setWindowAspect PiP'te yalnız kaydeder) →
    // önce kilidi geçerli orana getir, sonra eski boyuta dön; oran PiP'teyken
    // değiştiyse (boyutBekliyor) bekleyeniUygula pencereyi yeni orana uydurur.
    w.setAspectRatio(s.aspect)
    if (eskiMax) w.maximize()
    else w.setBounds(eskiBounds)
    bekleyeniUygula(w)
  } else {
    // Tam ekrandayken PiP'e geçiş: önce tam ekrandan çık, yoksa PiP kutusu tam
    // ekranın üstüne yazılır ve dönüşte tam ekran boyutu "normal" sanılır.
    if (w.isFullScreen()) w.setFullScreen(false)
    s.pipWasMax = w.isMaximized()
    s.pipBounds = s.pipWasMax ? w.getNormalBounds() : w.getBounds()
    if (s.pipWasMax) w.unmaximize()
    w.setAlwaysOnTop(true, 'floating')
    const kutu = pipKutusu(s.aspect, screen.getDisplayMatching(s.pipBounds).workArea)
    w.setAspectRatio(kutu.width / kutu.height) // kutunun gerçek oranı; çıkışta s.aspect'e döner
    w.setBounds(kutu)
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

// Açılış penceresi A4 dikey oranında (21:30 = 0.7). Bir PDF sayfası şeklinde; belge
// açılınca renderer belgenin oranını gönderir (setWindowAspect).
const INIT_H = 1000
const INIT_W = Math.round(INIT_H * ASPECT) // 700

/** Yeni bir Pidır penceresi oluşturur; verilirse renderer hazır olunca `openPaths` açılır. */
export function createWindow(openPaths: string[] = []): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    width: INIT_W,
    height: INIT_H,
    // Alt sınırlar orandan bağımsız: yatay belgede pencere basık, dikeyde dar olabilir;
    // oran kilidi (setAspectRatio) biçimi zaten korur.
    minWidth: MIN_W,
    minHeight: MIN_H,
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
      win.setAspectRatio(fs ? 0 : st(win).aspect) // çıkışta belgenin/kilidin oranı geri gelir
      win.webContents.send('pdfx:fullscreen-changed', fs)
      // Tam ekrandayken oran değiştiyse pencere eski boyutuna döndükten SONRA uydur
      // (Windows'ta olay, bounds geri gelmeden önce gelir → bir tık ertele).
      if (!fs) setImmediate(() => bekleyeniUygula(win))
    }
  win.on('enter-full-screen', fsUygula(true))
  win.on('leave-full-screen', fsUygula(false))
  // Büyütülmüşken oran değiştiyse (yalnız kilit kurulmuştu) küçültülünce uygula.
  // 🪤 Büyütülmüş pencere başlıktan sürüklenerek geri alınırken unmaximize, Windows'un
  // taşıma döngüsünün İÇİNDE gelir; o anda setBounds pencereyi imlecin altından kaydırır.
  // will-move … moved arasında bekle, taşıma bitince uygula.
  win.on('will-move', () => {
    st(win).tasiniyor = true
  })
  win.on('moved', () => {
    st(win).tasiniyor = false
    bekleyeniUygula(win)
  })
  win.on('unmaximize', () => setTimeout(() => bekleyeniUygula(win), 0))

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
