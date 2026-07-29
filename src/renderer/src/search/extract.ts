import { OPS } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

export interface ExtractedPage {
  text: string
  /** Sayfada kayda değer metin yok — OCR ADAYI (ucuz kontrol, operatör listesi gerekmez). */
  sparse: boolean
  /** Kesin karar: metin yok VE sayfa raster görüntü boyuyor. Yalnız `detectOcr` ile hesaplanır. */
  needsOcr: boolean
}

const MIN_TEXT_CHARS = 16

const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject
])

function isRealGlyph(code: number): boolean {
  return code !== 32 && code !== 9 && code !== 10 && code !== 13
}

async function paintsRasterImage(page: PDFPageProxy): Promise<boolean> {
  const { fnArray } = await page.getOperatorList()
  return fnArray.some((fn) => IMAGE_OPS.has(fn))
}

/**
 * Sayfanın raster görüntü boyayıp boymadığı — yani OCR'ın anlamı olup olmadığı.
 * PAHALI: sayfanın tam operatör listesini ayrıştırtır. Bu yüzden yalnız kullanıcı
 * aramayı açtığında, sadece metinsiz sayfalar için çağrılır.
 */
export async function pageHasRasterImage(
  pdf: PDFDocumentProxy,
  pageIndex: number
): Promise<boolean> {
  return paintsRasterImage(await pdf.getPage(pageIndex + 1))
}

export async function extractPageText(
  pdf: PDFDocumentProxy,
  pageIndex: number,
  detectOcr: boolean
): Promise<ExtractedPage> {
  const page = await pdf.getPage(pageIndex + 1)
  const content = await page.getTextContent()

  let text = ''
  let chars = 0
  for (const item of content.items) {
    if (!('str' in item)) continue
    text += item.str
    if (item.hasEOL) text += '\n'
    for (let i = 0; i < item.str.length; i++) {
      if (isRealGlyph(item.str.charCodeAt(i))) chars++
    }
  }

  // getOperatorList taranmış bir PDF'te sayfa başına tam ayrıştırma demek; OCR
  // kapalıyken bu maliyeti hiç ödemiyoruz — "aday" işareti ucuz karakter sayımından.
  const sparse = chars < MIN_TEXT_CHARS
  const needsOcr = detectOcr && sparse ? await paintsRasterImage(page) : false
  return { text, sparse, needsOcr }
}
