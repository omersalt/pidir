import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface OpenedFile {
  name: string
  data: Uint8Array
  path?: string
}

export type ZoomAction = 'in' | 'out' | 'reset'

export type MenuAction = 'open' | 'save-pdf'

export interface SidecarRequest {
  cmd: 'rotate' | 'sadelestir'
  pageIndex?: number
  degrees?: number
  topMm?: number
  bottomMm?: number
}

export interface SaveFilter {
  name: string
  extensions: string[]
}

const api = {
  platform: process.platform,
  rendererReady: (): Promise<void> => ipcRenderer.invoke('pdfx:renderer-ready'),
  /** İlk belge boyandığında ana sürece haber ver → pencere o an gösterilir. */
  firstDocReady: (): Promise<void> => ipcRenderer.invoke('pdfx:first-doc-ready'),
  chooseSavePath: (defaultName: string, filter?: SaveFilter): Promise<string | null> =>
    ipcRenderer.invoke('pdfx:choose-save-path', defaultName, filter),
  readClipboardImage: (): Promise<Uint8Array | null> =>
    ipcRenderer.invoke('pdfx:read-clipboard-image'),
  readClipboardFiles: (): Promise<OpenedFile[]> => ipcRenderer.invoke('pdfx:read-clipboard-files'),
  clearClipboard: (): Promise<void> => ipcRenderer.invoke('pdfx:clipboard-clear'),
  writeClipboardText: (text: string): Promise<boolean> =>
    ipcRenderer.invoke('pdfx:write-clipboard-text', text),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  expandDropPaths: (paths: string[]): Promise<OpenedFile[]> =>
    ipcRenderer.invoke('pdfx:expand-drop-paths', paths),
  readResource: (
    htmlPath: string,
    ref: string
  ): Promise<{ data: Uint8Array; mime: string } | null> =>
    ipcRenderer.invoke('pdfx:read-resource', htmlPath, ref),
  markupToPdf: (html: string, fitPageHeightPx?: number): Promise<Uint8Array> =>
    ipcRenderer.invoke('pdfx:markup-to-pdf', html, fitPageHeightPx),
  writeFile: (path: string, data: Uint8Array): Promise<string> =>
    ipcRenderer.invoke('pdfx:write-file', path, data),
  openFiles: (): Promise<OpenedFile[]> => ipcRenderer.invoke('pdfx:open-files'),
  /** .md kaynağını dış editörde (Sublime/Notepad) açar. Yalnız markdown yolları geçer. */
  openInEditor: (path: string): Promise<{ ok: boolean; editor: string }> =>
    ipcRenderer.invoke('pdfx:open-in-editor', path),
  newWindow: (): Promise<void> => ipcRenderer.invoke('pdfx:new-window'),
  captionSymbols: (visible: boolean): Promise<void> =>
    ipcRenderer.invoke('pdfx:caption-symbols', visible),
  winMinimize: (): Promise<void> => ipcRenderer.invoke('pdfx:win-minimize'),
  winMaximizeToggle: (): Promise<boolean> => ipcRenderer.invoke('pdfx:win-maximize-toggle'),
  winClose: (): Promise<void> => ipcRenderer.invoke('pdfx:win-close'),
  pipToggle: (): Promise<boolean> => ipcRenderer.invoke('pdfx:pip-toggle'),
  pipState: (): Promise<boolean> => ipcRenderer.invoke('pdfx:pip-state'),
  pipOpacity: (value: number): Promise<void> => ipcRenderer.invoke('pdfx:pip-opacity', value),
  /** Pencere en/boy oranını (genişlik/yükseklik) belgeye ya da dikey kilide göre ayarla;
   *  resize=true pencereyi de o orana getirir. */
  setAspect: (ratio: number, resize: boolean): Promise<void> =>
    ipcRenderer.invoke('pdfx:aspect', ratio, resize),
  /** Tam ekrana gir / çık (F11). Dönüş: yeni durum. */
  fullScreenToggle: (): Promise<boolean> => ipcRenderer.invoke('pdfx:fullscreen-toggle'),
  fullScreenState: (): Promise<boolean> => ipcRenderer.invoke('pdfx:fullscreen-state'),
  onFullScreenChanged: (callback: (fs: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, fs: boolean): void => callback(fs)
    ipcRenderer.on('pdfx:fullscreen-changed', listener)
    return () => ipcRenderer.removeListener('pdfx:fullscreen-changed', listener)
  },
  sidecar: (input: Uint8Array, request: SidecarRequest): Promise<Uint8Array> =>
    ipcRenderer.invoke('pdfx:sidecar', input, request),
  /** Kullanılan özelliği bildirir (telemetri). Ateşle-unut: arayüz sonucu beklemez. */
  olay: (ad: string): void => void ipcRenderer.invoke('pdfx:olay', ad),
  onPipChanged: (callback: (pip: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, pip: boolean): void => callback(pip)
    ipcRenderer.on('pdfx:pip-changed', listener)
    return () => ipcRenderer.removeListener('pdfx:pip-changed', listener)
  },
  onFilesOpened: (callback: (files: OpenedFile[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, files: OpenedFile[]): void =>
      callback(files)
    ipcRenderer.on('pdfx:files-opened', listener)
    return () => ipcRenderer.removeListener('pdfx:files-opened', listener)
  },
  onZoom: (callback: (action: ZoomAction) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: ZoomAction): void =>
      callback(action)
    ipcRenderer.on('pdfx:zoom', listener)
    return () => ipcRenderer.removeListener('pdfx:zoom', listener)
  },
  onMenu: (callback: (action: MenuAction) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: MenuAction): void =>
      callback(action)
    ipcRenderer.on('pdfx:menu', listener)
    return () => ipcRenderer.removeListener('pdfx:menu', listener)
  }
}

export type PdfxApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.api = api
}
