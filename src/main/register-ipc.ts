import { ipcMain, dialog, clipboard, BrowserWindow } from 'electron'
import { basename, isAbsolute } from 'path'
import { existsSync } from 'fs'
import { writeFile, rename, rm } from 'fs/promises'
import { markupToPdf } from './markup'
import { OpenedFile, IMPORTABLE, readFiles, expandDropPaths } from './file-intake'
import { clipboardFilePaths } from './clipboard'
import { readResource } from './resource'
import {
  createWindow,
  markReady,
  togglePip,
  isPip,
  setPipOpacity,
  minimizeWindow,
  toggleMaximize,
  closeWindow,
  setCaptionSymbols,
  revealWindow,
  toggleFullScreen,
  isFullScreen,
  setWindowAspect
} from './window'
import { runSidecar, SidecarRequest } from './sidecar'
import { openInEditor, isMarkdown, isText } from './md'
import { olayYaz } from './telemetri'
import { guncellemeDurumu } from './guncelleyici'

const MAX_WRITE_BYTES = 1024 * 1024 * 1024 // 1 GiB cap on a single IPC write
// clipboard.writeText SENKRON: sınırsız metin ana süreci kilitler (Ctrl+A + Kopyala).
// renderer/reader/kopyala.ts içindeki MAX_KOPYA ile AYNI değer olmalı.
const MAX_CLIPBOARD_CHARS = 2 * 1024 * 1024

// Bir IPC'yi çağıran (gönderen) pencere — işlemler doğru pencereyi hedeflesin.
const senderWin = (e: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
  BrowserWindow.fromWebContents(e.sender)

export function registerIpc(): void {
  ipcMain.handle('pdfx:win-minimize', (e) => minimizeWindow(senderWin(e)))
  ipcMain.handle('pdfx:win-maximize-toggle', (e) => toggleMaximize(senderWin(e)))
  ipcMain.handle('pdfx:win-close', (e) => closeWindow(senderWin(e)))
  ipcMain.handle('pdfx:caption-symbols', (e, visible: boolean) =>
    setCaptionSymbols(senderWin(e), !!visible)
  )
  ipcMain.handle('pdfx:new-window', () => {
    createWindow()
  })
  ipcMain.handle('pdfx:pip-toggle', (e) => togglePip(senderWin(e)))
  ipcMain.handle('pdfx:pip-state', (e) => isPip(senderWin(e)))
  ipcMain.handle('pdfx:pip-opacity', (e, value: number) => setPipOpacity(Number(value), senderWin(e)))
  ipcMain.handle('pdfx:fullscreen-toggle', (e) => toggleFullScreen(senderWin(e)))
  ipcMain.handle('pdfx:fullscreen-state', (e) => isFullScreen(senderWin(e)))
  // Pencere oranı (genişlik/yükseklik). Girdi renderer'dan gelir → sayı ve sınır kontrolü.
  ipcMain.handle('pdfx:aspect', (e, ratio: unknown, resize: unknown) => {
    const r = Number(ratio)
    if (!Number.isFinite(r) || r <= 0) return
    setWindowAspect(senderWin(e), r, resize === true)
  })
  ipcMain.handle(
    'pdfx:sidecar',
    (_event, input: Uint8Array, request: SidecarRequest): Promise<Uint8Array> =>
      runSidecar(input, request)
  )

  ipcMain.handle('pdfx:renderer-ready', (e) => markReady(senderWin(e)))

  // İlk belge boyandı → dosya-bekleyen pencereyi şimdi göster (boş ekran parlamasın).
  ipcMain.handle('pdfx:first-doc-ready', (e) => revealWindow(senderWin(e)))

  // Kaynağı dış editörde aç (Ctrl+E). YALNIZ .md/.markdown yollarını kabul eder —
  // PİDİR .md'yi kendi düzenlemez; düzenleme her zaman Sublime/Notepad'de yapılır.
  // Yol kısıtı bir güvenlik kapısıdır: renderer buradan keyfi exe çalıştıramaz.
  ipcMain.handle('pdfx:open-in-editor', (_event, path: unknown) => {
    if (typeof path !== 'string' || !path || path.includes('\0') || !isAbsolute(path)) {
      return { ok: false, editor: '' }
    }
    if (!isMarkdown(path) && !isText(path)) return { ok: false, editor: '' }
    olayYaz('ozellik', { ad: 'md_edit' })
    return openInEditor(path)
  })

  // Arayüzün hangi özelliğin kullanıldığını bildirmesi için tek uç. Girdi serbest metin
  // olduğundan telemetri modülü kendi içinde kırpıyor; burada yalnız tür kontrolü yapılır.
  ipcMain.handle('pdfx:olay', (_event, ad: unknown) => {
    if (typeof ad === 'string' && ad) olayYaz('ozellik', { ad: ad.slice(0, 40) })
  })

  ipcMain.handle('pdfx:update-status', () => guncellemeDurumu())

  ipcMain.handle(
    'pdfx:choose-save-path',
    async (e, defaultName: string, filter?: { name: string; extensions: string[] }) => {
      const win = senderWin(e)
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        title: 'Farklı Kaydet',
        defaultPath: defaultName,
        filters: [filter ?? { name: 'PDF', extensions: ['pdf'] }]
      })
      return result.canceled || !result.filePath ? null : result.filePath
    }
  )

  ipcMain.handle('pdfx:read-clipboard-image', () => {
    const image = clipboard.readImage()
    return image.isEmpty() ? null : new Uint8Array(image.toPNG())
  })

  ipcMain.handle('pdfx:read-clipboard-files', async (): Promise<OpenedFile[]> => {
    const paths = clipboardFilePaths().filter((p) => IMPORTABLE.test(p) && existsSync(p))
    return readFiles(paths)
  })

  ipcMain.handle('pdfx:clipboard-clear', () => clipboard.clear())

  // Belgeden seçilen metnin panoya yazılması. navigator.clipboard yerine IPC:
  // çerçevesiz pencerede odak/izin durumundan bağımsız, deterministik çalışır.
  ipcMain.handle('pdfx:write-clipboard-text', (_e, text: unknown): boolean => {
    if (typeof text !== 'string' || text.length === 0) return false
    let out = text
    if (out.length > MAX_CLIPBOARD_CHARS) {
      out = out.slice(0, MAX_CLIPBOARD_CHARS)
      // Vekil çiftinin ortasından kesme: panoda U+FFFD çıkardı.
      const son = out.charCodeAt(out.length - 1)
      if (son >= 0xd800 && son <= 0xdbff) out = out.slice(0, -1)
    }
    clipboard.writeText(out)
    return true
  })

  ipcMain.handle(
    'pdfx:expand-drop-paths',
    async (_event, paths: string[]): Promise<OpenedFile[]> =>
      readFiles(await expandDropPaths(paths))
  )

  ipcMain.handle('pdfx:read-resource', (_event, htmlPath: string, ref: string) =>
    readResource(htmlPath, ref)
  )

  ipcMain.handle(
    'pdfx:markup-to-pdf',
    (_event, html: string, fitPageHeightPx?: number): Promise<Uint8Array> => {
      // Coerce to a finite positive number so the value can never be a string that
      // breaks out of the numeric context where markup.ts interpolates it into
      // executeJavaScript.
      const ph = Number(fitPageHeightPx)
      return markupToPdf(html, Number.isFinite(ph) && ph > 0 ? ph : undefined)
    }
  )

  ipcMain.handle('pdfx:write-file', async (_event, path: string, data: Uint8Array) => {
    // The renderer must hand us a concrete absolute path (these come from the native
    // save dialog). Reject relative paths, null-byte truncation tricks, and absurd
    // payload sizes so a compromised renderer can't turn this into a write primitive.
    if (typeof path !== 'string' || !path || path.includes('\0') || !isAbsolute(path)) {
      throw new Error('write-file: refusing invalid path')
    }
    if (!ArrayBuffer.isView(data) || data.byteLength > MAX_WRITE_BYTES) {
      throw new Error('write-file: refusing invalid payload')
    }
    // Atomik yazım: doğrudan hedefin üzerine yazarsak, "Farklı Kaydet" ile mevcut bir
    // dosyanın üstüne yazarken çökme/elektrik kesintisi olursa hedef yarım kalır ve
    // orijinal geri getirilemez. Önce yan dosyaya yaz, sonra rename ile yerine geçir —
    // rename aynı birim içinde atomiktir.
    const tmp = `${path}.pidir-tmp`
    try {
      await writeFile(tmp, data)
      await rename(tmp, path)
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => {})
      throw error
    }
    return basename(path)
  })

  ipcMain.handle('pdfx:open-files', async (e): Promise<OpenedFile[]> => {
    const win = senderWin(e)
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      title: 'Belge Aç',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Belgeler',
          extensions: [
            'pdf', 'docx', 'csv', 'tsv', 'json', 'jsonl', 'ndjson',
            'md', 'markdown', 'txt', 'text', 'log'
          ]
        },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Word Belgesi', extensions: ['docx'] },
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
        { name: 'Metin', extensions: ['txt', 'text', 'log'] },
        { name: 'Tablo (CSV)', extensions: ['csv', 'tsv'] },
        { name: 'JSON', extensions: ['json', 'jsonl', 'ndjson'] },
        { name: 'Tüm Dosyalar', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return readFiles(result.filePaths)
  })
}
