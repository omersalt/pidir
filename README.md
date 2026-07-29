# Pidır

A minimal PDF reader for Windows. The content fills the window; the interface stays out of the way until you reach for it.

![version](https://img.shields.io/badge/version-0.1.0-555?style=flat-square)
[![license](https://img.shields.io/badge/license-MIT-2e7d32?style=flat-square)](LICENSE)

> 🇹🇷 Türkçe belge: [README.tr.md](README.tr.md)

> _Screenshot placeholder — put the reading view at `docs/gorseller/okuma.png` and link it here._

## What it is

Pidır opens a PDF and shows it. There is no sidebar, no ribbon, no permanent toolbar. The
top bar appears when the pointer moves near the top edge of the window and disappears again;
everything else lives in the right-click menu. The window itself is frameless and keeps an
A4 aspect ratio, so an open document looks like a sheet of paper rather than an application.

It is a desktop app built with Electron, React and TypeScript. Rendering is done by
[pdf.js](https://mozilla.github.io/pdf.js/); page editing by [pdf-lib](https://pdf-lib.js.org/).

## What it does

- **Reading** — continuous vertical scroll, `Ctrl` + mouse wheel to zoom around the pointer,
  fit-to-width and fit-to-page.
- **Search** — searches the text layer. If a page turns out to be scanned (no text layer),
  it is run through Tesseract OCR on demand, in Turkish or English. OCR only starts once you
  actually open the search bar, so plain reading never pays for it.
- **Page manager** — delete, rotate and reorder pages, or select a few and export them to a
  separate PDF. These run locally through pdf-lib; encrypted PDFs are refused rather than
  silently corrupted.
- **PiP mode** — shrinks the window into a small always-on-top panel with adjustable opacity,
  for reading alongside something else.
- **DOCX** — Word documents are converted to PDF on open, so search, zoom and OCR work on
  them too. Neither Word nor LibreOffice is needed; see [Python](#python) below.
- **CSV and JSON** — `.csv`, `.tsv`, `.json`, `.jsonl` and `.ndjson` are laid out as a
  readable document and opened the same way. The delimiter is detected automatically, and
  very large files are truncated rather than left to grind. No Python needed for these.
- **Simplify** — strips the repeating header and footer bands from every page. Useful for
  scanned books and papers where the running head gets in the way.
- **Multiple windows**, light/dark following the system theme, and Windows 11 snap layouts
  (the maximise button keeps its native hover flyout even though the title bar is hidden).

Double-clicking a `.pdf` or `.docx` file opens it in Pidır once the app is installed.

## Install

Download the installer from the [latest release](../../releases/latest) — the file is named
`pidir-<version>-kurulum.exe` — and run it. It installs per-machine, so it asks for
administrator rights, and it lets you change the install directory.

Windows only for now. The code has no Windows-specific assumptions beyond the title bar
handling, but no other platform is built or tested.

## Build from source

Node 22 or newer is required (`pdfjs-dist` needs it).

```bash
npm install        # also fetches the Tesseract language data into resources/ocr
npm run dev        # run in development, with watch
npm run build:win  # type-check, bundle, and produce the NSIS installer in dist/
```

Other useful scripts: `npm run typecheck` (node + renderer), `npm run build:unpack`
(unpacked build, no installer), `npm run format`.

## Python

Python is **not** required to read PDFs, search them, run OCR, or edit pages. Everything on
the reading path is self-contained.

Two features shell out to a local Python process:

- opening `.docx` files
- **Simplify** (header/footer removal)

Both use the scripts under `arac/`, which are shipped alongside the app. They need `python`
on `PATH` plus:

```bash
pip install pymupdf mammoth
```

If Python is missing, those two features report an error and the rest of the app carries on
working normally.

## Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl+O` | Open |
| `Ctrl+N` | New window |
| `Ctrl+S` | Save as |
| `Ctrl+F` | Find (enables OCR for scanned pages) |
| `Ctrl+P` | Toggle PiP mode |
| `Ctrl` + `+` / `-` | Zoom in / out |
| `Ctrl+0` | Fit width |
| `Ctrl` + wheel | Zoom around the pointer |
| `Esc` | Close the menu, page manager, find bar, or PiP |
| `Ctrl+Shift+I` | Developer tools |

On macOS builds, `⌘` replaces `Ctrl`. Page manager, fit-to-page, rotate and Simplify are in
the right-click menu.

## Why

Every PDF reader on Windows either wants to be an office suite or wants to sell you a
subscription. Most of them put a permanent 200-pixel band of buttons above a document you
are trying to read. Pidır was written because the alternative — a reader that shows the page
and nothing else — did not seem to exist.

It is a personal tool, published in case it is useful to someone else. It is not trying to
replace Acrobat, and it will not grow an editing suite.

## Privacy

Pidır collects usage data and sends it to `https://bisiler.com/pidir/tlm`. This is on by
default and the app does not ask first. Read this section before installing.

What is sent, with each batch:

- an install identifier — a UUID generated on first run and stored in the app's user-data
  directory
- **the MAC addresses of your physical network interfaces**, both as a SHA-256 hash and as a
  plain list
- the app version, the OS version, and the CPU architecture
- which features you use, and error counts
- how long each session lasted

**File names and document contents are never sent.** Nothing you open, search for, or save
leaves your machine, and the app does not send your IP address in the payload (the server
sees it anyway, as it does for any HTTP request).

Be clear about what the MAC address means: it is a hardware identifier that survives
reinstalls and OS reinstalls, and it identifies your machine on any network it joins. Data
carrying it is not anonymous in any useful sense — it is pseudonymous at best, and under
GDPR and KVKK it counts as personal data. It is described here plainly so you can decide
whether that is acceptable to you.

Events are batched, sent about once a minute, and queued to disk if the network is down, so
they are retried rather than dropped. Nothing is sent during development builds.

To turn it off completely, set this environment variable before launching:

```
PIDIR_TLM_KAPALI=1
```

Separately, the app checks for updates on startup and installs them on quit. That contacts
the update server regardless of the telemetry setting.

## Credits

Pidır started as a fork of PDFx by Alex Gounis and kept its Electron/React shell and PDF
plumbing — the original copyright notice is preserved in [LICENSE](LICENSE). The reader
behaviour, page manager, OCR search, DOCX support and PiP mode were written for Pidır.

## License

MIT — see [LICENSE](LICENSE).
