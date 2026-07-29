import { app, nativeTheme, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { FALLBACK_BG } from './theme'
import { collectFileArgs } from './file-intake'
import { createWindow, activeWindow, sendOpenPaths, setCaptionSymbols } from './window'
import { buildMenu } from './menu'
import { registerIpc } from './register-ipc'
import { registerOcrProtocol, registerOcrSchemePrivileged } from './ocr-assets'

app.setName('Pidır')

registerOcrSchemePrivileged()

if (process.env.PIDIR_USER_DATA) {
  app.setPath('userData', process.env.PIDIR_USER_DATA)
}

// Açılışta / OS "birlikte aç" ile gelen dosyalar (ilk pencere hazır olana dek biriktir).
let startupPaths: string[] = collectFileArgs(process.argv.slice(1))

app.on('open-file', (event, path) => {
  event.preventDefault()
  if (app.isReady() && activeWindow()) void sendOpenPaths([path])
  else startupPaths.push(path)
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const files = collectFileArgs(argv.slice(1))
    const win = activeWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      void sendOpenPaths(files, win)
    } else {
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

    buildMenu()
    createWindow(startupPaths)
    startupPaths = []

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
