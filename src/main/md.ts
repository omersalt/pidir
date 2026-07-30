import { basename, extname } from 'path'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { nativeTheme } from 'electron'
import { marked } from 'marked'
import { markupToPdf } from './markup'

/** .md / .markdown uzantısı — okuyucu bunları PDF gibi render eder (SALT-OKUNUR). */
export function isMarkdown(p: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(p)
}

// GitHub README estetiği, açık + koyu palet. Tek dosyalık (harici kaynak yok —
// markup.ts'in CSP'si default-src 'none'; img data:; style-src 'unsafe-inline' data:
// dayatır). Koyu palet Windows gece modunda seçilir → PDF zemini o an gömülür.
interface Palet {
  bg: string; fg: string; kenar: string; link: string; sessiz: string
  kodBg: string; preBg: string; thBg: string; ciftBg: string
}
const ACIK: Palet = {
  bg: '#ffffff', fg: '#1f2328', kenar: '#d1d9e0', link: '#0969da', sessiz: '#59636e',
  kodBg: '#eff1f3', preBg: '#f6f8fa', thBg: '#f6f8fa', ciftBg: '#f6f8fa'
}
const KOYU: Palet = {
  bg: '#0d1117', fg: '#e6edf3', kenar: '#30363d', link: '#4493f8', sessiz: '#9198a1',
  kodBg: '#656c7633', preBg: '#161b22', thBg: '#161b22', ciftBg: '#151b23'
}

// A4 sayfa + doğal sayfalama (preferCSSPageSize markup.ts'te açık).
function githubCss(p: Palet): string {
  return `
/* margin: 0 → sayfanın "kâğıt" kenar boşluğu YOK (koyu modda beyaz bar yapıyordu).
   Boşluk body padding'ine taşındı: koyu zemin kâğıdın ta kenarına kadar dolar. */
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html { margin: 0; padding: 0; background: ${p.bg}; }
body {
  margin: 0; padding: 16mm 15mm;
  font: 15px/1.6 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: ${p.fg}; background: ${p.bg};
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
  word-wrap: break-word;
}
h1, h2, h3, h4, h5, h6 { margin: 24px 0 16px; font-weight: 600; line-height: 1.25; }
h1 { font-size: 2em; padding-bottom: .3em; border-bottom: 1px solid ${p.kenar}; }
h2 { font-size: 1.5em; padding-bottom: .3em; border-bottom: 1px solid ${p.kenar}; }
h3 { font-size: 1.25em; } h4 { font-size: 1em; } h5 { font-size: .875em; } h6 { font-size: .85em; color: ${p.sessiz}; }
p, blockquote, ul, ol, dl, table, pre { margin: 0 0 16px; }
a { color: ${p.link}; text-decoration: none; } a:hover { text-decoration: underline; }
strong { font-weight: 600; }
ul, ol { padding-left: 2em; }
li + li { margin-top: .25em; }
li.task-list-item { list-style: none; }
li.task-list-item input { margin: 0 .4em .15em -1.4em; vertical-align: middle; }
blockquote { padding: 0 1em; color: ${p.sessiz}; border-left: .25em solid ${p.kenar}; }
code {
  font: .85em/1.45 ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace;
  background: ${p.kodBg}; padding: .2em .4em; border-radius: 6px;
}
pre {
  background: ${p.preBg}; padding: 14px 16px; border-radius: 8px; overflow: auto;
  font-size: .85em; line-height: 1.45;
}
pre code { background: none; padding: 0; font-size: 100%; white-space: pre; }
table { border-collapse: collapse; display: block; width: max-content; max-width: 100%; overflow: auto; }
table th, table td { padding: 6px 13px; border: 1px solid ${p.kenar}; }
table th { font-weight: 600; background: ${p.thBg}; }
table tr:nth-child(2n) { background: ${p.ciftBg}; }
img { max-width: 100%; }
hr { height: .25em; margin: 24px 0; background: ${p.kenar}; border: 0; }
h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
`
}

// Sistem temasına göre palet seç (Windows gece modu → koyu). themeSource varsayılan
// 'system' olduğu için shouldUseDarkColors OS'u yansıtır.
function paletSec(): Palet {
  return nativeTheme.shouldUseDarkColors ? KOYU : ACIK
}

// GitHub Flavored Markdown, satır sonu = <br> DEĞİL (README davranışı).
marked.setOptions({ gfm: true, breaks: false })

function utf8(data: Uint8Array): string {
  // BOM'u at (bazı editörler .md'yi BOM'lu yazar → ilk başlıkta görünür # bozulur).
  const s = new TextDecoder('utf-8').decode(data)
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/** .md baytlarını GitHub tarzı render edilmiş bir PDF'e çevirir. Kaynağa DOKUNMAZ. */
export async function mdToPdf(data: Uint8Array, name: string): Promise<Uint8Array> {
  const bodyHtml = await marked.parse(utf8(data))
  const title = basename(name).replace(/\.[^.]+$/, '')
  const html =
    '<!doctype html><html lang="tr"><head><meta charset="utf-8">' +
    `<title>${escapeHtml(title)}</title><style>${githubCss(paletSec())}</style></head>` +
    `<body class="markdown-body">${bodyHtml}</body></html>`
  // fitPageHeightPx VERİLMEZ → doğal çok-sayfalı A4 (CSV'deki tek-sayfa sığdırma değil).
  return markupToPdf(html)
}

/** .txt uzantısı. */
export function isText(p: string): boolean {
  return /\.(txt|text|log)$/i.test(p)
}

/** .txt baytlarını DÜZ METİN olarak (satır sonları korunur, monospace) PDF'e çevirir.
 * Markdown parse EDİLMEZ — .txt'te tek satır sonları anlamlıdır (log/not). Tema-duyarlı. */
export async function txtToPdf(data: Uint8Array, name: string): Promise<Uint8Array> {
  const p = paletSec()
  const metin = escapeHtml(utf8(data))
  const title = basename(name).replace(/\.[^.]+$/, '')
  const css = `
@page { size: A4; margin: 0; }
html { margin: 0; padding: 0; background: ${p.bg}; }
body {
  margin: 0; padding: 16mm 15mm;
  color: ${p.fg}; background: ${p.bg};
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
pre {
  margin: 0;
  font: 12px/1.5 ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace;
  white-space: pre-wrap; word-wrap: break-word; overflow-wrap: anywhere;
}`
  const html =
    '<!doctype html><html lang="tr"><head><meta charset="utf-8">' +
    `<title>${escapeHtml(title)}</title><style>${css}</style></head>` +
    `<body><pre>${metin}</pre></body></html>`
  return markupToPdf(html)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

// Sublime Text kurulu olduğu bilinen yollar; yoksa Notepad'e düş. Kullanıcı .md'yi
// DÜZENLEMEK istediğinde (Ctrl+E) çağrılır — PİDİR asla .md'ye yazmadığı için
// düzenleme HER ZAMAN dış editörde yapılır.
const SUBLIME_PATHS = [
  'C:\\Program Files\\Sublime Text\\sublime_text.exe',
  'C:\\Program Files\\Sublime Text 3\\sublime_text.exe',
  'C:\\Program Files (x86)\\Sublime Text\\sublime_text.exe',
  'C:\\Program Files (x86)\\Sublime Text 3\\sublime_text.exe'
]

export function openInEditor(path: string): { ok: boolean; editor: string } {
  if (!path || !existsSync(path)) return { ok: false, editor: '' }
  const sublime = SUBLIME_PATHS.find((p) => existsSync(p))
  const exe = sublime ?? 'notepad.exe'
  try {
    // detached + unref: editör PİDİR'den bağımsız yaşasın; PİDİR kapansa da kalsın.
    const child = spawn(exe, [path], { detached: true, stdio: 'ignore' })
    child.unref()
    return { ok: true, editor: sublime ? 'Sublime Text' : 'Notepad' }
  } catch {
    return { ok: false, editor: '' }
  }
}

/** Uzantıyı .pdf yapar — render edilmiş belge okuyucuya PDF olarak iner. */
export const mdPdfName = (path: string): string =>
  basename(path).slice(0, -extname(path).length) + '.pdf'
