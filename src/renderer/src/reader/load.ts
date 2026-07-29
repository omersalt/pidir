import { getDocument } from 'pdfjs-dist'
import type { DocEntry, PageEntry, PdfSource } from '../types'

// Çılgın bir sayfa sayısı bildiren bozuk PDF belleği tüketmesin.
const MAX_PAGES = 10_000

function stripExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, '')
}

/**
 * Baytlardan tek bir PDF yükler — Pidır'ın açık belgesi olur.
 * Orijinal baytlar `source.bytes`'te saklanır (pdf-lib düzenlemesi için);
 * pdf.js'e ayrı bir kopya verilir çünkü worker tamponu devralıp geçersizleştirebilir.
 */
export async function loadPdf(name: string, bytes: Uint8Array): Promise<DocEntry> {
  const pdf = await getDocument({ data: bytes.slice() }).promise
  if (pdf.numPages > MAX_PAGES) {
    await pdf.destroy()
    throw new Error(`PDF ${pdf.numPages} sayfa bildiriyor; ${MAX_PAGES} üstü reddedildi`)
  }
  const source: PdfSource = { id: crypto.randomUUID(), bytes, pdf }
  const pages: PageEntry[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    pages.push({
      id: crypto.randomUUID(),
      source,
      pageIndex: i - 1,
      width: viewport.width,
      height: viewport.height
    })
  }
  return { id: crypto.randomUUID(), name: stripExtension(name), pages }
}
