const SOFT_HYPHEN = /­/g
const WHITESPACE = /\s+/g

// Türkçe'nin noktalı/noktasız I'sı JS'in varsayılan küçültmesinde bozulur:
// 'İ'.toLowerCase() = 'i' + U+0307 (birleşen üst nokta) — İKİ kod noktası. Bu yüzden
// "İstanbul" küçültülünce "i̇stanbul" olur ve kullanıcının yazdığı "istanbul" ile
// EŞLEŞMEZ; 'I'.toLowerCase() ise 'i' verdiğinden "IŞIK" da "ışık"ı bulamaz.
// Dört harfi tek bir 'i'de birleştirip her ikisini de aranabilir kılıyoruz.
const TR_FOLD: Record<string, string> = { İ: 'i', I: 'i', ı: 'i' }

/**
 * Küçük harfe katlar ama ÇIKTI UZUNLUĞUNU KORUR (kod noktası başına 1:1).
 * Vurgu katmanı, eşleşme indeksiyle HAM metinden dilim aldığı için bu şart:
 * uzunluğu değiştiren bir küçültme vurguyu kaydırır.
 */
export function foldCase(input: string): string {
  let out = ''
  for (const ch of input) {
    const tr = TR_FOLD[ch]
    if (tr !== undefined) {
      out += tr
      continue
    }
    const lower = ch.toLowerCase()
    // 'ẞ' → 'ss' gibi uzunluk büyüten katlamaları reddet; hizalama bozulmasın.
    out += lower.length === ch.length ? lower : ch
  }
  return out
}

export function normalizeText(input: string): string {
  return foldCase(input.normalize('NFKC').replace(SOFT_HYPHEN, ''))
    .replace(WHITESPACE, ' ')
    .trim()
}

export const normalizeQuery = normalizeText

export function hasMatch(haystack: string, needle: string): boolean {
  return needle.length > 0 && haystack.includes(needle)
}

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return count
    count++
    from = at + needle.length
  }
}
