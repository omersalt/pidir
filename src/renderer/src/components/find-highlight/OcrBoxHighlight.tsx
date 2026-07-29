import { foldCase } from '../../search/normalize'
import type { OcrWord } from '../../ocr/types'

interface OcrBoxHighlightProps {
  words: OcrWord[]
  query: string
}

export function OcrBoxHighlight({ words, query }: OcrBoxHighlightProps): React.JSX.Element {
  // Motorla AYNI katlama: OCR kelimesi ham geldiği için ('İSTANBUL') o da katlanmalı,
  // yoksa sayfa "eşleşti" işaretlenir ama tek bir kutu vurgulanmaz.
  const tokens = foldCase(query.trim()).split(/\s+/).filter(Boolean)
  const hits =
    tokens.length > 0
      ? words.filter((word) => {
          const text = foldCase(word.text)
          return tokens.some((t) => text.includes(t))
        })
      : []

  return (
    <div className="ocr-highlight-layer" aria-hidden="true">
      {hits.map((word, index) => (
        <span
          key={index}
          className="ocr-highlight"
          style={{
            left: `${word.x * 100}%`,
            top: `${word.y * 100}%`,
            width: `${word.w * 100}%`,
            height: `${word.h * 100}%`
          }}
        />
      ))}
    </div>
  )
}
