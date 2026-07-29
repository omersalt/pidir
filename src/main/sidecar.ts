import { app } from 'electron'
import { execFile } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// PyMuPDF sidecar: ağır düzenleme işleri (döndürme, sadeleştirme/redaction)
// yerel Python sürecinde yapılır; girdi/çıktı geçici dosyayla taşınır.

export interface SidecarRequest {
  cmd: 'rotate' | 'sadelestir'
  pageIndex?: number
  degrees?: number
  topMm?: number
  bottomMm?: number
}

const MAX_INPUT_BYTES = 512 * 1024 * 1024

function scriptPath(): string {
  // Dev'de betik proje kökünde (app.getAppPath() = kök). Paketlenmiş uygulamada
  // asar içinden okunamaz (Python gerçek dosya ister) → extraResources ile
  // process.resourcesPath\arac altına taşınır.
  return app.isPackaged
    ? join(process.resourcesPath, 'arac', 'pidir_sidecar.py')
    : join(app.getAppPath(), 'arac', 'pidir_sidecar.py')
}

export async function runSidecar(input: Uint8Array, request: SidecarRequest): Promise<Uint8Array> {
  if (!ArrayBuffer.isView(input) || input.byteLength === 0 || input.byteLength > MAX_INPUT_BYTES) {
    throw new Error('sidecar: geçersiz girdi')
  }
  if (request.cmd !== 'rotate' && request.cmd !== 'sadelestir') {
    throw new Error('sidecar: bilinmeyen komut')
  }
  const dir = await mkdtemp(join(tmpdir(), 'pidir-'))
  const inPath = join(dir, 'in.pdf')
  const outPath = join(dir, 'out.pdf')
  try {
    await writeFile(inPath, input)
    await new Promise<void>((resolve, reject) => {
      execFile(
        'python',
        [scriptPath(), inPath, outPath, JSON.stringify(request)],
        { timeout: 120_000, windowsHide: true },
        (error, _stdout, stderr) => {
          if (error) reject(new Error(`sidecar: ${stderr || error.message}`))
          else resolve()
        }
      )
    })
    return new Uint8Array(await readFile(outPath))
  } finally {
    // Temizlik asla sonucu/gerçek hatayı maskelemesin; Windows geçici kilitleri (AV/indeksleyici) için yeniden dene.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
  }
}
