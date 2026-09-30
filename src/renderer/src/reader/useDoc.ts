import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPdf } from './load'
import type { DocEntry } from '../types'

interface IntakeFile {
  name: string
  data: Uint8Array
  path?: string
}

const LAST_KEY = 'pidir:last-path'
const isPdf = (name: string): boolean => /\.pdf$/i.test(name)

export interface ReaderDocApi {
  doc: DocEntry | null
  name: string
  path: string | null
  loading: boolean
  error: string | null
  lastPath: string | null
  openViaDialog: () => Promise<void>
  openDropped: (files: File[]) => Promise<void>
  reopenLast: () => Promise<void>
  /** Düzenlemeden dönen yeni baytları yükleyip belgeyi tazeler. */
  replaceBytes: (bytes: Uint8Array, name?: string) => Promise<void>
  close: () => void
  /** Düzenleme/kaydetme için geçerli PDF baytları. */
  bytes: () => Uint8Array | null
}

export function useReaderDoc(flash: (message: string) => void): ReaderDocApi {
  const [doc, setDoc] = useState<DocEntry | null>(null)
  const [name, setName] = useState('')
  const [path, setPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastPath, setLastPath] = useState<string | null>(() => localStorage.getItem(LAST_KEY))
  const bytesRef = useRef<Uint8Array | null>(null)
  const docRef = useRef<DocEntry | null>(null)
  // Monoton istek jetonu: yalnız EN SON yükleme commit olur; geç dönen eski
  // yükleme, gösterilen belgenin pdf'ini disposePrev ile yok etmesin (use-after-free).
  const reqSeq = useRef(0)

  // Önceki belgenin pdf.js proxy'sini serbest bırak (bellek sızıntısını önle).
  const disposePrev = useCallback(() => {
    const prev = docRef.current
    const pdf = prev?.pages[0]?.source.pdf
    if (pdf) {
      try {
        void pdf.destroy()
      } catch {
        /* yoksay */
      }
    }
  }, [])

  const apply = useCallback(
    (next: DocEntry, nextBytes: Uint8Array, fileName: string, filePath?: string) => {
      disposePrev()
      docRef.current = next
      bytesRef.current = nextBytes
      setDoc(next)
      setName(fileName)
      if (filePath !== undefined) setPath(filePath)
      if (filePath) {
        localStorage.setItem(LAST_KEY, filePath)
        setLastPath(filePath)
      }
    },
    [disposePrev]
  )

  const openFile = useCallback(
    async (file: IntakeFile) => {
      const token = ++reqSeq.current
      setLoading(true)
      setError(null)
      try {
        const next = await loadPdf(file.name, file.data)
        if (token !== reqSeq.current) {
          void next.pages[0]?.source.pdf.destroy() // eskimiş yükleme: öksüz pdf'i serbest bırak
          return
        }
        // yeniDosya: okuyucu başa sarar (replaceBytes'taki düzenleme tazelemesi konumu korur).
        apply({ ...next, yeniDosya: true }, file.data, file.name, file.path ?? '')
      } catch (e) {
        if (token !== reqSeq.current) return
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        flash(`Açılamadı: ${msg}`)
      } finally {
        if (token === reqSeq.current) setLoading(false)
      }
    },
    [apply, flash]
  )

  const openViaDialog = useCallback(async () => {
    const files = await window.api.openFiles()
    const pick = files.find((f) => isPdf(f.name)) ?? files[0]
    if (pick) await openFile(pick)
  }, [openFile])

  const openDropped = useCallback(
    async (files: File[]) => {
      const paths = files.map((f) => window.api.getPathForFile(f)).filter(Boolean)
      if (paths.length === 0) return
      const opened = await window.api.expandDropPaths(paths)
      const pick = opened.find((f) => isPdf(f.name)) ?? opened[0]
      if (pick) await openFile(pick)
      else flash('Sürüklenen dosyada PDF yok')
    },
    [openFile, flash]
  )

  const reopenLast = useCallback(async () => {
    if (!lastPath) return
    const opened = await window.api.expandDropPaths([lastPath])
    if (opened[0]) await openFile(opened[0])
    else flash('Son dosya bulunamadı')
  }, [lastPath, openFile, flash])

  const replaceBytes = useCallback(
    async (nextBytes: Uint8Array, nextName?: string) => {
      const token = ++reqSeq.current
      setLoading(true)
      try {
        const label = nextName ?? (name || 'belge.pdf')
        const next = await loadPdf(label, nextBytes)
        if (token !== reqSeq.current) {
          void next.pages[0]?.source.pdf.destroy()
          return
        }
        apply(next, nextBytes, label)
      } catch {
        if (token === reqSeq.current) flash('Düzenleme uygulanamadı')
      } finally {
        if (token === reqSeq.current) setLoading(false)
      }
    },
    [apply, name, flash]
  )

  const close = useCallback(() => {
    reqSeq.current++ // uçuştaki yüklemeleri geçersiz kıl (kapanıştan sonra yeniden açılmasın)
    disposePrev()
    docRef.current = null
    bytesRef.current = null
    setDoc(null)
    setPath(null)
    setName('')
  }, [disposePrev])

  // OS "birlikte aç" / komut satırı argümanı → main süreç renderer'a iletir.
  useEffect(() => {
    const off = window.api.onFilesOpened((files) => {
      const pick = files.find((f) => isPdf(f.name)) ?? files[0]
      if (pick) void openFile(pick)
    })
    void window.api.rendererReady()
    return off
  }, [openFile])

  return {
    doc,
    name,
    path,
    loading,
    error,
    lastPath,
    openViaDialog,
    openDropped,
    reopenLast,
    replaceBytes,
    close,
    bytes: () => bytesRef.current
  }
}
