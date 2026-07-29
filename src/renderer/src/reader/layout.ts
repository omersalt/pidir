import type { DocEntry } from '../types'

// Sürekli-kaydırma okuyucusunun dikey yerleşimi. Bu sabitler CSS ile BİREBİR
// aynı olmalı (.reader-column padding-top = READER_PAD_Y, gap = READER_GAP),
// çünkü kaydırma matematiği (hangi sayfa görünür / bir sayfaya git) buradan hesaplanır.
export const READER_PAD_Y = 40
// Yatay boşluk küçük: sayfa pencere genişliğine neredeyse tam otursun (yanlarda
// gereksiz çerçeve bırakma). Sayfa gölgesinin nefes alması için minik pay kalır.
export const READER_PAD_X = 10
export const READER_GAP = 24

/** Her sayfanın sütun içindeki üst kenar ofseti (px), geçerli ölçekte. */
export function pageTops(doc: DocEntry, scale: number): number[] {
  const tops: number[] = []
  let y = READER_PAD_Y
  for (const p of doc.pages) {
    tops.push(y)
    y += p.height * scale + READER_GAP
  }
  return tops
}

/** Verilen dikey orta çizgiye (scrollTop + clientHeight/2) düşen 0-tabanlı sayfa. */
export function pageAtMid(tops: number[], mid: number): number {
  let idx = 0
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= mid) idx = i
    else break
  }
  return idx
}
