import { ipcMain, dialog, clipboard, BrowserWindow } from 'electron'
import { basename, isAbsolute } from 'path'
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
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
  setCaptionSymbols
} from './window'
import { runSidecar, SidecarRequest } from './sidecar'

const MAX_WRITE_BYTES = 1024 * 1024 * 1024 // 1 GiB cap on a single IPC write

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
  ipcMain.handle(
    'pdfx:sidecar',
    (_event, input: Uint8Array, request: SidecarRequest): Promise<Uint8Array> =>
      runSidecar(input, request)
  )

  ipcMain.handle('pdfx:renderer-ready', (e) => markReady(senderWin(e)))

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
    await writeFile(path, data)
    return basename(path)
  })

  ipcMain.handle('pdfx:open-files', async (e): Promise<OpenedFile[]> => {
    const win = senderWin(e)
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      title: 'Belge Aç',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Belgeler', extensions: ['pdf', 'docx'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Word Belgesi', extensions: ['docx'] },
        { name: 'Tüm Dosyalar', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return readFiles(result.filePaths)
  })
}
