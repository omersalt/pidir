import { countOccurrences, normalizeQuery, normalizeText } from './normalize'
import { extractPageText, pageHasRasterImage } from './extract'
import { createOcrClient, type OcrClient } from '../ocr/ocr-client'
import { DEFAULT_OCR_LANGUAGE } from '../ocr/languages'
import type { OcrWord } from '../ocr/types'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { DocEntry } from '../types'

export interface SearchResult {
  pageIds: Set<string>
  docIds: Set<string>
  pages: number
  occurrences: number
}

export const EMPTY_RESULT: SearchResult = {
  pageIds: new Set(),
  docIds: new Set(),
  pages: 0,
  occurrences: 0
}

export interface SearchEngine {
  reconcile: (docs: DocEntry[]) => void
  search: (query: string) => SearchResult
  setLanguage: (lang: string) => void
  /** OCR yalnız kullanıcı aramayı açınca çalışsın diye kapı. Açılınca birikmiş adaylar taranır. */
  setOcrEnabled: (enabled: boolean) => void
  getOcrWords: (sourceKey: string) => OcrWord[] | undefined
  dispose: () => void
}

export interface EngineCallbacks {
  onChange: () => void
  onProgress: (remaining: number, hasScanned: boolean) => void
  getDocs: () => DocEntry[]
}

interface OcrJob {
  key: string
  pdf: PDFDocumentProxy
  pageIndex: number
}

const OCR_CONCURRENCY = 2

export function createSearchEngine({
  onChange,
  onProgress,
  getDocs
}: EngineCallbacks): SearchEngine {
  const pageText = new Map<string, string>()
  const sourceBorn = new Map<string, string>()
  const sourceOcr = new Map<string, string>()
  const sourceOcrWords = new Map<string, OcrWord[]>()
  const scanned = new Set<string>()
  // Metni olmayan ama henüz "gerçekten taranmış mı" diye bakılmamış sayfalar.
  // OCR kapalıyken buraya birikir; kullanıcı aramayı açınca tek seferde işlenir.
  const sparsePending = new Set<string>()
  const ocrQueued = new Set<string>()
  const ocrQueue: OcrJob[] = []
  const pagesBySource = new Map<string, Set<string>>()
  const sourceRef = new Map<string, OcrJob>()

  let ocrInFlight = 0
  let jobSeq = 0
  let lang = DEFAULT_OCR_LANGUAGE
  let client: OcrClient | null = null
  let reconcileToken = 0
  // Belge açılır açılmaz OCR başlatmıyoruz: her sayfa 300 dpi'da (~8,7 Mpx / 35 MB)
  // ANA İŞ PARÇACIĞINDA rasterleştiriliyor ve ikisi aynı anda koşuyordu — ekrana
  // basılan görüntünün ~5 katı iş, hem de kullanıcı Ctrl+F'e basmadan.
  let ocrEnabled = false

  const sourceKeyOf = (page: DocEntry['pages'][number]): string =>
    `${page.source.id}:${page.pageIndex}`
  const effective = (key: string): string => sourceOcr.get(key) ?? sourceBorn.get(key) ?? ''
  const reportProgress = (): void => onProgress(ocrQueue.length + ocrInFlight, scanned.size > 0)

  function ensureClient(): OcrClient {
    if (!client) {
      client = createOcrClient()
      client.setLanguage(lang)
    }
    return client
  }

  function applySource(key: string): void {
    const ids = pagesBySource.get(key)
    if (!ids) return
    const text = effective(key)
    for (const id of ids) pageText.set(id, text)
  }

  function enqueueOcr(job: OcrJob): void {
    if (ocrQueued.has(job.key)) return
    ocrQueued.add(job.key)
    ocrQueue.push(job)
    reportProgress()
    pumpOcr()
  }

  function pumpOcr(): void {
    while (ocrInFlight < OCR_CONCURRENCY && ocrQueue.length > 0) {
      const job = ocrQueue.shift()!
      ocrInFlight++
      reportProgress()
      const jobId = `${++jobSeq}`
      ensureClient()
        .recognize(job.pdf, job.pageIndex, jobId)
        .then(({ text, words }) => {
          if (!pagesBySource.has(job.key)) return
          sourceOcr.set(job.key, normalizeText(text))
          sourceOcrWords.set(job.key, words)
          applySource(job.key)
          onChange()
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          if (message !== 'cancelled') console.warn('OCR failed', error)
        })
        .finally(() => {
          ocrInFlight--
          reportProgress()
          pumpOcr()
        })
    }
  }

  async function runExtraction(
    jobs: { pageId: string; key: string; pdf: PDFDocumentProxy; pageIndex: number }[],
    token: number
  ): Promise<void> {
    for (const job of jobs) {
      if (token !== reconcileToken) return
      if (sourceBorn.has(job.key)) {
        pageText.set(job.pageId, effective(job.key))
        if (ocrEnabled && scanned.has(job.key) && !ocrQueued.has(job.key)) {
          enqueueOcr({ key: job.key, pdf: job.pdf, pageIndex: job.pageIndex })
        }
        onChange()
        continue
      }
      try {
        const { text, sparse, needsOcr } = await extractPageText(job.pdf, job.pageIndex, ocrEnabled)
        sourceBorn.set(job.key, normalizeText(text))
        if (sparse && !needsOcr) sparsePending.add(job.key)
        if (needsOcr) {
          sparsePending.delete(job.key)
          scanned.add(job.key)
          reportProgress()
          enqueueOcr({ key: job.key, pdf: job.pdf, pageIndex: job.pageIndex })
        }
        pageText.set(job.pageId, effective(job.key))
        onChange()
      } catch (error) {
        console.error(`Failed to index page ${job.pageIndex + 1}`, error)
      }
    }
  }

  return {
    reconcile(docs) {
      const token = ++reconcileToken
      const presentPages = new Set<string>()
      const presentKeys = new Set<string>()
      const toExtract: { pageId: string; key: string; pdf: PDFDocumentProxy; pageIndex: number }[] =
        []
      let changed = false

      pagesBySource.clear()
      sourceRef.clear()

      for (const doc of docs) {
        for (const page of doc.pages) {
          presentPages.add(page.id)
          const key = sourceKeyOf(page)
          presentKeys.add(key)
          let ids = pagesBySource.get(key)
          if (!ids) pagesBySource.set(key, (ids = new Set()))
          ids.add(page.id)
          if (!sourceRef.has(key)) {
            sourceRef.set(key, { key, pdf: page.source.pdf, pageIndex: page.pageIndex })
          }
          if (pageText.has(page.id)) continue
          if (sourceBorn.has(key)) {
            pageText.set(page.id, effective(key))
            changed = true
            if (ocrEnabled && scanned.has(key) && !ocrQueued.has(key)) {
              enqueueOcr({ key, pdf: page.source.pdf, pageIndex: page.pageIndex })
            }
          } else {
            toExtract.push({
              pageId: page.id,
              key,
              pdf: page.source.pdf,
              pageIndex: page.pageIndex
            })
          }
        }
      }

      for (const id of [...pageText.keys()]) {
        if (!presentPages.has(id)) {
          pageText.delete(id)
          changed = true
        }
      }

      for (const key of [...sourceBorn.keys()]) {
        if (!presentKeys.has(key)) {
          sourceBorn.delete(key)
          sourceOcr.delete(key)
          sourceOcrWords.delete(key)
          scanned.delete(key)
          sparsePending.delete(key)
          ocrQueued.delete(key)
        }
      }

      if (ocrQueue.length > 0) {
        for (let i = ocrQueue.length - 1; i >= 0; i--) {
          if (!presentKeys.has(ocrQueue[i].key)) {
            ocrQueued.delete(ocrQueue[i].key)
            ocrQueue.splice(i, 1)
          }
        }
        reportProgress()
      }

      if (changed) onChange()
      if (toExtract.length > 0) void runExtraction(toExtract, token)
    },

    search(query) {
      const q = normalizeQuery(query)
      if (!q) return EMPTY_RESULT
      const pageIds = new Set<string>()
      let occurrences = 0
      for (const [pageId, text] of pageText) {
        const count = countOccurrences(text, q)
        if (count > 0) {
          pageIds.add(pageId)
          occurrences += count
        }
      }
      const docIds = new Set<string>()
      for (const doc of getDocs()) {
        if (doc.pages.some((p) => pageIds.has(p.id))) docIds.add(doc.id)
      }
      return { pageIds, docIds, pages: pageIds.size, occurrences }
    },

    setOcrEnabled(enabled) {
      if (enabled === ocrEnabled) return
      ocrEnabled = enabled
      if (!enabled) return
      // Kapı açıldı: OCR kapalıyken biriken adayları şimdi gerçekten sınıflandır.
      // pageHasRasterImage pahalı olduğu için bu iş yalnız burada, bir kez yapılır.
      const token = reconcileToken
      void (async () => {
        for (const key of [...sparsePending]) {
          if (token !== reconcileToken || !ocrEnabled) return
          const job = sourceRef.get(key)
          if (!job || !sourceBorn.has(key)) {
            sparsePending.delete(key)
            continue
          }
          try {
            if (await pageHasRasterImage(job.pdf, job.pageIndex)) {
              scanned.add(key)
              enqueueOcr(job)
            }
          } catch (error) {
            console.warn('OCR adayı incelenemedi', error)
          }
          sparsePending.delete(key)
        }
        reportProgress()
      })()
    },

    setLanguage(next) {
      if (next === lang) return
      lang = next
      if (client) {
        client.cancelAll()
        client.setLanguage(next)
      }
      sourceOcr.clear()
      sourceOcrWords.clear()
      ocrQueued.clear()
      ocrQueue.length = 0
      for (const key of scanned) {
        applySource(key)
        const job = sourceRef.get(key)
        if (job) enqueueOcr(job)
      }
      reportProgress()
      onChange()
    },

    getOcrWords(sourceKey) {
      return sourceOcrWords.get(sourceKey)
    },

    dispose() {
      ocrQueue.length = 0
      client?.dispose()
      client = null
    }
  }
}
