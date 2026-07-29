import type { PdfxApi } from './index'

declare global {
  interface Window {
    api: PdfxApi
  }
}

export {}
