import { basename, extname } from 'path'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { marked } from 'marked'
import { markupToPdf } from './markup'

/** .md / .markdown uzantısı — okuyucu bunları PDF gibi render eder (SALT-OKUNUR). */
export function isMarkdown(p: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(p)
}

// GitHub README estetiği, tek dosyalık (harici kaynak yok — markup.ts'in CSP'si
// default-src 'none'; img data:; style-src 'unsafe-inline' data: kuralını dayatır).
// A4 sayfa + doğal sayfalama (preferCSSPageSize markup.ts'te açık).
const GITHUB_CSS = `
@page { size: A4; margin: 16mm 15mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font: 15px/1.6 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #1f2328; background: #fff;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
  word-wrap: break-word;
}
h1, h2, h3, h4, h5, h6 { margin: 24px 0 16px; font-weight: 600; line-height: 1.25; }
h1 { font-size: 2em; padding-bottom: .3em; border-bottom: 1px solid #d1d9e0; }
h2 { font-size: 1.5em; padding-bottom: .3em; border-bottom: 1px solid #d1d9e0; }
h3 { font-size: 1.25em; } h4 { font-size: 1em; } h5 { font-size: .875em; } h6 { font-size: .85em; color: #59636e; }
p, blockquote, ul, ol, dl, table, pre { margin: 0 0 16px; }
a { color: #0969da; text-decoration: none; } a:hover { text-decoration: underline; }
strong { font-weight: 600; }
ul, ol { padding-left: 2em; }
li + li { margin-top: .25em; }
li.task-list-item { list-style: none; }
li.task-list-item input { margin: 0 .4em .15em -1.4em; vertical-align: middle; }
blockquote { padding: 0 1em; color: #59636e; border-left: .25em solid #d1d9e0; }
code {
  font: .85em/1.45 ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace;
  background: #eff1f3; padding: .2em .4em; border-radius: 6px;
}
pre {
  background: #f6f8fa; padding: 14px 16px; border-radius: 8px; overflow: auto;
  font-size: .85em; line-height: 1.45;
}
pre code { background: none; padding: 0; font-size: 100%; white-space: pre; }
table { border-collapse: collapse; display: block; width: max-content; max-width: 100%; overflow: auto; }
table th, table td { padding: 6px 13px; border: 1px solid #d1d9e0; }
table th { font-weight: 600; background: #f6f8fa; }
table tr:nth-child(2n) { background: #f6f8fa; }
img { max-width: 100%; }
hr { height: .25em; margin: 24px 0; background: #d1d9e0; border: 0; }
h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
`

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
    `<title>${escapeHtml(title)}</title><style>${GITHUB_CSS}</style></head>` +
    `<body class="markdown-body">${bodyHtml}</body></html>`
  // fitPageHeightPx VERİLMEZ → doğal çok-sayfalı A4 (CSV'deki tek-sayfa sığdırma değil).
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
