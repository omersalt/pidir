import { app } from 'electron'
import { execFile } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// DOCX köprüsü: Word belgesi PDF'e çevrilir, Pidır onu normal PDF gibi açar.
// Böylece arama, yakınlaştırma, işaretleme, OCR — hepsi docx'te de çalışır.
// Dönüşüm mammoth (docx→HTML) + PyMuPDF Story (HTML→PDF) ile yapılır;
// LibreOffice veya Word kurulu olması GEREKMEZ.

const MAX_INPUT_BYTES = 256 * 1024 * 1024

function scriptPath(): string {
  // sidecar.ts ile aynı kural: paketlenmiş uygulamada asar içinden okunamaz,
  // extraResources ile process.resourcesPath\arac altına taşınır.
  return app.isPackaged
    ? join(process.resourcesPath, 'arac', 'pidir_docx.py')
    : join(app.getAppPath(), 'arac', 'pidir_docx.py')
}

export interface DocxAyar {
  kagit?: string
  kenarMm?: number
}

/** DOCX baytlarını PDF baytlarına çevirir. */
export async function docxToPdf(input: Uint8Array, ayar: DocxAyar = {}): Promise<Uint8Array> {
  if (!ArrayBuffer.isView(input) || input.byteLength === 0 || input.byteLength > MAX_INPUT_BYTES) {
    throw new Error('docx: geçersiz girdi')
  }
  // DOCX bir ZIP'tir; ilk iki bayt "PK" değilse dosya bozuk ya da başka bir tür.
  if (input[0] !== 0x50 || input[1] !== 0x4b) {
    throw new Error('docx: dosya geçerli bir Word belgesi değil')
  }

  const dir = await mkdtemp(join(tmpdir(), 'pidir-docx-'))
  const inPath = join(dir, 'in.docx')
  const outPath = join(dir, 'out.pdf')
  try {
    await writeFile(inPath, input)
    await new Promise<void>((resolve, reject) => {
      execFile(
        'python',
        [scriptPath(), inPath, outPath, JSON.stringify(ayar)],
        { timeout: 180_000, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) reject(new Error(`docx: ${stderr || stdout || error.message}`))
          else resolve()
        }
      )
    })
    return new Uint8Array(await readFile(outPath))
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
  }
}

export const isDocx = (name: string): boolean => /\.docx$/i.test(name)
