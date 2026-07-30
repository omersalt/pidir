import { app, nativeTheme, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { FALLBACK_BG } from './theme'
import { collectFileArgs } from './file-intake'
import {
  createWindow,
  activeWindow,
  sendOpenPaths,
  setCaptionSymbols,
  showAndFocus
} from './window'
import { buildMenu } from './menu'
import { registerIpc } from './register-ipc'
import { registerOcrProtocol, registerOcrSchemePrivileged } from './ocr-assets'
import { guncellemeyiBaslat } from './guncelleyici'
import { associationlariOnar } from './associations'
import { telemetriBaslat, telemetriKapat } from './telemetri'

app.setName('Pidır')

registerOcrSchemePrivileged()

if (process.env.PIDIR_USER_DATA) {
  app.setPath('userData', process.env.PIDIR_USER_DATA)
}

// Açılışta / OS "birlikte aç" ile gelen dosyalar (ilk pencere hazır olana dek biriktir).
let startupPaths: string[] = collectFileArgs(process.argv.slice(1))

app.on('open-file', (event, path) => {
  event.preventDefault()
  const win = app.isReady() ? activeWindow() : null
  if (win) {
    showAndFocus(win)
    void sendOpenPaths([path], win)
  } else startupPaths.push(path)
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const files = collectFileArgs(argv.slice(1))
    const win = activeWindow()
    if (win) {
      showAndFocus(win)
      void sendOpenPaths(files, win)
    } else {
      // Okuyucu penceresi kalmadıysa (ör. kullanıcı kapattı, gizli render penceresi
      // süreci ayakta tutuyordu) YENİ pencere aç — dosya boşluğa gitmesin.
      createWindow(files)
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.pidir.app')

    registerOcrProtocol()

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window, { zoom: true })
    })

    registerIpc()
    telemetriBaslat()

    buildMenu()
    createWindow(startupPaths)
    startupPaths = []

    // Güncelleme kontrolü kendi içinde 10 sn geciktirilir ve electron-updater'ı ancak
    // o zaman yükler — pencere çizimi bu satırdan etkilenmez.
    guncellemeyiBaslat()

    // Dosya ilişkilendirme komutlarını (boşluklu kurulum yolunda electron-builder
    // TIRNAKSIZ yazar → çift-tık kırılır) açılışta tırnakla onar. Deferred + ateşle-unut:
    // pencere çizimini bloklamaz, yalnız gerekirse yazar.
    setTimeout(() => void associationlariOnar().catch(() => {}), 3000)

    nativeTheme.on('updated', () => {
      const bg = nativeTheme.shouldUseDarkColors ? FALLBACK_BG.dark : FALLBACK_BG.light
      for (const w of BrowserWindow.getAllWindows()) {
        w.setBackgroundColor(bg)
        setCaptionSymbols(w, false) // yeni tema renkleriyle görünmez sembollere dön
      }
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Kapanışta son telemetri paketini gönder. Electron `before-quit` dinleyicilerini
// AWAIT ETMEZ; `async` bir dinleyici yazsaydık uygulama kapanır, istek yarıda kesilir
// ve `kapanis` olayı hiç gitmezdi. Doğrusu: çıkışı bir kez ertele, iş bitince yeniden
// quit çağır. `kapanisYapildi` bayrağı sonsuz döngüyü engelliyor.
let kapanisYapildi = false
app.on('before-quit', (olay) => {
  if (kapanisYapildi) return
  olay.preventDefault()
  kapanisYapildi = true
  void telemetriKapat().finally(() => app.quit())
})
