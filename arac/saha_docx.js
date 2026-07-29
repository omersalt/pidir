// Pidır DOCX köprüsü — uçtan uca saha testi (Electron'suz, saf Node).
// file-intake'in yaptığı işin aynısını yapar: docx oku → python köprüsü → PDF doğrula.
// Kural: feedback_saha_testi_kurali

const { execFile } = require('child_process')
const { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } = require('fs')
const { join } = require('path')
const { tmpdir } = require('os')

const KOK = join(__dirname, '..')
const BETIK = join(KOK, 'arac', 'pidir_docx.py')

function calistir(cmd, args, ms = 180000) {
  return new Promise((res) => {
    execFile(cmd, args, { timeout: ms, windowsHide: true }, (e, so, se) =>
      res({ kod: e ? (e.code ?? 1) : 0, cikti: so || '', hata: se || (e ? e.message : '') })
    )
  })
}

;(async () => {
  console.log('SAHA TESTİ — Pidır DOCX köprüsü (uçtan uca)')
  let tamam = true
  const yaz = (ad, iyi, ek = '') => {
    tamam = tamam && iyi
    console.log(`  [${iyi ? 'OK ' : 'HATA'}] ${ad}${ek ? '  ' + ek : ''}`)
  }

  yaz('köprü betiği yerinde', existsSync(BETIK))

  // 1) Python tarafının kendi saha testi geçiyor mu
  const py = await calistir('python', [BETIK, '--saha'])
  yaz('python köprüsü saha testi', py.kod === 0)

  // 2) Gerçek bir docx üretip boru hattından geçir
  const dir = mkdtempSync(join(tmpdir(), 'pidir-saha-'))
  const docx = join(dir, 'ornek.docx')
  const pdf = join(dir, 'ornek.pdf')
  const uret = await calistir('python', ['-c',
    `import sys; sys.path.insert(0,r'${join(KOK, 'arac').replace(/\\/g, '\\\\')}');` +
    `import pidir_docx,pathlib; pidir_docx._ornek_docx(pathlib.Path(r'${docx.replace(/\\/g, '\\\\')}'))`])
  yaz('örnek .docx üretildi', existsSync(docx) && uret.kod === 0)

  // 3) DOCX'in ZIP imzası — main/docx.ts bu kontrolü yapıyor
  const ham = readFileSync(docx)
  yaz('ZIP imzası (PK) doğru', ham[0] === 0x50 && ham[1] === 0x4b)

  // 4) Dönüştür
  const cev = await calistir('python', [BETIK, docx, pdf, '{}'])
  yaz('dönüştürme çalıştı', cev.kod === 0, cev.kod ? cev.hata.slice(0, 90) : '')

  // 5) Çıktı gerçekten PDF mi ve içi dolu mu
  if (existsSync(pdf)) {
    const p = readFileSync(pdf)
    yaz('çıktı PDF imzalı', p.slice(0, 5).toString() === '%PDF-')
    yaz('çıktı boş değil', p.length > 800, `${Math.round(p.length / 1024)} KB`)
    const okunur = await calistir('python', ['-c',
      `import fitz; d=fitz.open(r'${pdf.replace(/\\/g, '\\\\')}');` +
      `t='\\n'.join(s.get_text() for s in d);` +
      `print('SAYFA',len(d));print('ANAHTAR','ARANACAK_ANAHTAR_KELIME' in t);` +
      `print('TURKCE','ığüşöçİĞÜŞÖÇ' in t)`])
    const c = okunur.cikti
    yaz('PDF açılabiliyor', /SAYFA \d+/.test(c), (c.match(/SAYFA \d+/) || [''])[0])
    yaz('metin aranabilir', c.includes('ANAHTAR True'))
    yaz('Türkçe karakterler sağlam', c.includes('TURKCE True'))
  } else {
    yaz('çıktı PDF üretildi', false)
  }

  // 6) Bozuk girdi reddediliyor mu — sessizce boş PDF üretmemeli
  const bozuk = join(dir, 'bozuk.docx')
  writeFileSync(bozuk, Buffer.from('bu bir word belgesi degil'))
  const bz = await calistir('python', [BETIK, bozuk, join(dir, 'bozuk.pdf'), '{}'])
  yaz('bozuk dosya hata veriyor', bz.kod !== 0)

  rmSync(dir, { recursive: true, force: true })
  console.log('SONUÇ:', tamam ? 'GEÇTİ' : 'KALDI')
  process.exit(tamam ? 0 : 1)
})()
