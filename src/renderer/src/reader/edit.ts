import { PDFDocument, degrees, EncryptedPDFError } from 'pdf-lib'

// Katman A düzenleme motoru — pdf-lib ile kayıpsız sayfa işlemleri.
// Ağır işler (kalıcı redaction / sadeleştirme) PyMuPDF sidecar'ına gider (bkz. App).

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true })
}

/**
 * PDF şifreli mi? pdf-lib 1.17.1 şifre çözemez; ignoreEncryption'la düzenlersek
 * belge SESSİZCE bozulur. Bu yüzden düzenleme öncesi tespit edip reddediyoruz
 * (pdf.js boş-parolalı izin-kısıtlı PDF'leri sessizce açar, bu yüzden görünmez risk).
 */
export async function isEncrypted(bytes: Uint8Array): Promise<boolean> {
  try {
    await PDFDocument.load(bytes) // ignoreEncryption yok → şifreli ise fırlatır
    return false
  } catch (e) {
    return e instanceof EncryptedPDFError
  }
}

/** Verilen 0-tabanlı sayfaları siler (en az bir sayfa korunur). */
export async function deletePages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const doc = await load(bytes)
  const drop = [...new Set(indices)].sort((a, b) => b - a)
  for (const i of drop) {
    if (i >= 0 && i < doc.getPageCount() && doc.getPageCount() > 1) doc.removePage(i)
  }
  return doc.save()
}

/** Sayfaları 90°'nin katı kadar döndürür (mevcut açıya delta eklenir). */
export async function rotatePages(
  bytes: Uint8Array,
  indices: number[],
  delta: number
): Promise<Uint8Array> {
  const doc = await load(bytes)
  const pages = doc.getPages()
  for (const i of indices) {
    if (i < 0 || i >= pages.length) continue
    const current = pages[i].getRotation().angle
    pages[i].setRotation(degrees((((current + delta) % 360) + 360) % 360))
  }
  return doc.save()
}

/**
 * `order` = yeni sıradaki eski indeksler. Sayfaları YERİNDE yeniden dizer
 * (removePage yaprakları koparır, addPage aynı-belge sayfalarını geri ekler) —
 * böylece outline/yer imi, metadata ve AcroForm alanları KORUNUR (yeniden-kurma
 * bunları düşürüyordu, "kayıpsız" ihlali).
 */
export async function reorderPages(bytes: Uint8Array, order: number[]): Promise<Uint8Array> {
  const doc = await load(bytes)
  const pages = doc.getPages()
  const desired = order.filter((i) => i >= 0 && i < pages.length).map((i) => pages[i])
  if (desired.length === 0) return bytes
  for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i)
  desired.forEach((p) => doc.addPage(p))
  return doc.save()
}

/** Seçili sayfaları (belge sırasında) yeni bir PDF olarak ayıklar; temel metadata'yı kopyalar. */
export async function extractPages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await load(bytes)
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, [...new Set(indices)].sort((a, b) => a - b))
  copied.forEach((p) => out.addPage(p))
  const title = src.getTitle()
  if (title) out.setTitle(title)
  const author = src.getAuthor()
  if (author) out.setAuthor(author)
  const subject = src.getSubject()
  if (subject) out.setSubject(subject)
  return out.save()
}

/** Sona başka PDF('ler)in tüm sayfalarını ekler (birleştir). */
export async function appendPdfs(bytes: Uint8Array, others: Uint8Array[]): Promise<Uint8Array> {
  const out = await load(bytes)
  for (const other of others) {
    const src = await load(other)
    const copied = await out.copyPages(src, src.getPageIndices())
    copied.forEach((p) => out.addPage(p))
  }
  return out.save()
}
