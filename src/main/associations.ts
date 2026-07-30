import { execFile } from 'child_process'
import { app } from 'electron'

// PİDİR'in kaydettiği tüm ProgID adları (electron-builder fileAssociations `name`).
const PROGIDS = [
  'PDF Belgesi',
  'Word Belgesi',
  'CSV Tablosu',
  'TSV Tablosu',
  'JSON Belgesi',
  'Markdown Belgesi',
  'Metin Belgesi'
]

function reg(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    // execFile → argümanlar CreateProcess'e doğrudan gider; kabuk tırnaklama yok,
    // Türkçe/boşluklu ProgID adları bozulmaz (reg.exe bash'te takılıyordu).
    execFile('reg', args, { windowsHide: true }, (err, stdout) => resolve(err ? '' : stdout))
  })
}

/**
 * electron-builder, kurulum yolunda boşluk varsa (ör. "C:\Users\Ömer Salt\…")
 * ProgID açma komutunu TIRNAKSIZ yazar: `C:\Users\Ömer Salt\…\pidir.exe "%1"`.
 * Boşlukta kırılır → çift-tık `C:\Users\Ömer`i çalıştırmaya çalışır, açılmaz.
 * Bu onarım açılışta komutu `"exe" "%1"` diye tırnaklar. Yalnız gerekiyorsa yazar.
 * Deferred + ateşle-unut: pencere çizimini bloklamaz.
 */
export async function associationlariOnar(): Promise<void> {
  if (process.platform !== 'win32') return
  // Yalnız paketli (kurulu) uygulamada çalış. Dev'de exe = electron.exe olur;
  // onarım kayıtlı ProgID komutunu yanlışlıkla electron.exe'ye yazıp ilişkilendirmeyi
  // bozardı. Kurulu pidir.exe dışında ASLA yazma.
  if (!app.isPackaged) return
  const exe = app.getPath('exe')
  const dogru = `"${exe}" "%1"`
  for (const progId of PROGIDS) {
    const key = `HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`
    const out = await reg(['query', key, '/ve'])
    if (!out) continue // ProgID yok (bu tür kurulu değil) → atla
    // Mevcut değeri kabaca çıkar: exe zaten tırnaklıysa dokunma.
    const m = out.match(/REG_SZ\s+(.*)\S?/)
    const cur = (m?.[1] ?? '').trim()
    if (cur.startsWith('"')) continue // zaten tırnaklı → onarım gereksiz
    if (!cur.toLowerCase().includes('pidir')) continue // bize ait değilse dokunma
    await reg(['add', key, '/ve', '/t', 'REG_SZ', '/d', dogru, '/f'])
  }
}
