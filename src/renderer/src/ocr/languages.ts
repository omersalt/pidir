export interface OcrLanguage {
  code: string
  label: string
}

export const OCR_LANGUAGES: OcrLanguage[] = [
  { code: 'tur', label: 'Türkçe' },
  { code: 'eng', label: 'English' }
]

export const DEFAULT_OCR_LANGUAGE = 'tur'
