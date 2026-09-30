import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { OcrWord } from '../../ocr/types'
import { TextLayerHighlight, type SelReq } from './TextLayerHighlight'
import { OcrBoxHighlight } from './OcrBoxHighlight'

export type { SelReq }

interface FindHighlightProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  naturalHeight: number
  query: string
  ocrWords: OcrWord[] | undefined
  selectAt?: SelReq | null
  onSelectResolved?: (ok: boolean) => void
}

export function FindHighlight({
  pdf,
  pageNumber,
  naturalHeight,
  query,
  ocrWords,
  selectAt,
  onSelectResolved
}: FindHighlightProps): React.JSX.Element {
  // Seçim istenmişse metin katmanı dalı KAZANIR. OCR çift tıktan sonra tamamlanırsa
  // (yarış) bu dal OcrBoxHighlight'a döner, katman hiç kurulmaz, onSelectResolved hiç
  // çağrılmaz ve kip sonsuza dek asılı kalırdı. Taranmış sayfada katman zaten BOŞ
  // kurulur, kapı false döner, App seçimi temizler ve bir sonraki render'da OCR dalı
  // geri gelir — kendi kendini düzelten, tek karelik bir sapma.
  if (ocrWords && !selectAt) return <OcrBoxHighlight words={ocrWords} query={query} />
  return (
    <TextLayerHighlight
      pdf={pdf}
      pageNumber={pageNumber}
      naturalHeight={naturalHeight}
      query={query}
      selectAt={selectAt}
      onSelectResolved={onSelectResolved}
    />
  )
}
