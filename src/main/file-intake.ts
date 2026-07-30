import { basename, join } from 'path'
import { existsSync } from 'fs'
import { readFile, readdir, stat } from 'fs/promises'
import { docxToPdf, isDocx } from './docx'
import { csvToPdf, isCsv, isJson, jsonToPdf } from './tablo'
import { isMarkdown, mdToPdf, isText, txtToPdf } from './md'
import { olayYaz } from './telemetri'

export interface OpenedFile {
  name: string
  data: Uint8Array
  path?: string
}

export const IMPORTABLE =
  /\.(pdf|pdfx|docx|csv|tsv|json|jsonl|ndjson|md|markdown|mdown|mkd|png|jpe?g|webp|gif|bmp|avif|txt|rtf|svg|html?)$/i

export function collectFileArgs(argv: string[]): string[] {
  return argv.filter(
    (arg) =>
      /\.(pdf|pdfx|docx|csv|tsv|json|jsonl|ndjson|md|markdown|mdown|mkd|txt|text|log)$/i.test(arg) &&
      existsSync(arg)
  )
}

/** Uzantıyı .pdf yapar — çevrilen belgeler okuyucuya PDF olarak iner. */
const pdfAdi = (yol: string): string => basename(yol).replace(/\.[^./\\]+$/, '.pdf')

export async function readFiles(paths: string[]): Promise<OpenedFile[]> {
  return Promise.all(
    paths.map(async (p) => {
      const data = new Uint8Array(await readFile(p))
      const boyutKb = Math.round(data.byteLength / 1024)
      // DOCX/CSV/JSON açılırken PDF'e çevrilir; okuyucu tarafı tek bir biçim görür.
      // Dönüşüm başarısız olursa dosya sessizce yutulmaz — hata yukarı taşınır.
      // DİKKAT: telemetriye yalnız TÜR ve BOYUT gider; dosya adı/yolu ASLA gönderilmez.
      if (isDocx(p)) {
        const pdf = await docxToPdf(data)
        olayYaz('belge_acildi', { tur: 'docx', boyutKb })
        return { name: pdfAdi(p), data: pdf, path: p }
      }
      if (isCsv(p)) {
        const pdf = await csvToPdf(data, basename(p))
        olayYaz('belge_acildi', { tur: 'csv', boyutKb })
        return { name: pdfAdi(p), data: pdf, path: p }
      }
      if (isJson(p)) {
        const pdf = await jsonToPdf(data, basename(p))
        olayYaz('belge_acildi', { tur: 'json', boyutKb })
        return { name: pdfAdi(p), data: pdf, path: p }
      }
      if (isMarkdown(p)) {
        // .md → GitHub tarzı render PDF. path: p ORİJİNAL .md yolunu taşır (Ctrl+E
        // ile Sublime'da açmak için); okuyucu bunu asla düzenlemez/üzerine yazmaz.
        const pdf = await mdToPdf(data, basename(p))
        olayYaz('belge_acildi', { tur: 'md', boyutKb })
        return { name: pdfAdi(p), data: pdf, path: p }
      }
      if (isText(p)) {
        // .txt → düz metin (satır sonları korunur), tema-duyarlı. Kaynağa dokunmaz;
        // path: p ile Ctrl+E dış editörde açar.
        const pdf = await txtToPdf(data, basename(p))
        olayYaz('belge_acildi', { tur: 'txt', boyutKb })
        return { name: pdfAdi(p), data: pdf, path: p }
      }
      olayYaz('belge_acildi', { tur: 'pdf', boyutKb })
      return { name: basename(p), data, path: p }
    })
  )
}

export const importable = (p: string): boolean => IMPORTABLE.test(p) && !basename(p).startsWith('.')

// Bound a single drag-drop expansion so a deeply nested or pathological directory
// tree can't make the renderer read an unbounded number of files into memory.
const MAX_DROP_FILES = 10_000

export async function expandDropPaths(paths: string[]): Promise<string[]> {
  const out: string[] = []
  for (const p of paths) {
    if (out.length >= MAX_DROP_FILES) break
    try {
      const info = await stat(p)
      if (info.isDirectory()) {
        const entries = await readdir(p, { recursive: true, withFileTypes: true })
        out.push(
          // isFile() is false for symlinks and directories, so symlinked entries
          // are skipped and the recursive walk never follows a link out of the tree.
          ...entries
            .filter((e) => e.isFile())
            .map((e) => join(e.parentPath ?? p, e.name))
            .filter(importable)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        )
      } else if (info.isFile() && importable(p)) {
        out.push(p)
      }
    } catch {
      continue
    }
  }
  return out.slice(0, MAX_DROP_FILES)
}
