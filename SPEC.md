# PDFX Format Specification

**Version 1.0 — draft**

PDFX is a backwards-compatible extension of PDF for bundling multiple documents
into a single file. Every `.pdfx` file is a fully valid PDF; PDFX-aware viewers
additionally recover the original document boundaries and present the bundle as
a collection.

## Design goals

1. **Full backwards compatibility.** A `.pdfx` file opens in any standard PDF
   viewer, which shows all pages sequentially.
2. **Single file.** Multi-PDF workflows (invoices, contracts, review packets)
   become one file that is easy to share, store, and organize.
3. **Trivial to implement.** The format adds exactly one thing to PDF: a JSON
   manifest stored with standard PDF machinery.

## File structure

A PDFX file is a PDF (ISO 32000-1:2008) in which:

1. The pages of every member document are concatenated **in order**: all pages
   of document 1, then all pages of document 2, and so on.
2. A manifest is embedded as a PDF **file attachment** (embedded file stream,
   ISO 32000-1:2008 §7.11.4) with the exact file name:

   ```
   pdfx-manifest.json
   ```

### Manifest schema

The manifest is a UTF-8 encoded JSON object:

```json
{
  "pdfx": "1.0",
  "title": "Q1 Review Packet",
  "documents": [
    { "name": "Invoice March", "pages": 3 },
    { "name": "Contract", "pages": 12 }
  ]
}
```

| Field               | Type    | Required | Description                                       |
| ------------------- | ------- | -------- | ------------------------------------------------- |
| `pdfx`              | string  | yes      | Format version. Currently `"1.0"`.                |
| `title`             | string  | no       | Human-readable title of the collection.           |
| `documents`         | array   | yes      | Member documents, in page order.                  |
| `documents[].name`  | string  | yes      | Display name of the document (no file extension). |
| `documents[].pages` | integer | yes      | Number of pages belonging to this document (≥ 1). |

The page counts partition the PDF's page sequence: document _i_ owns the pages
starting immediately after the pages of document _i − 1_.

## Reader behavior

- If the file has **no** `pdfx-manifest.json` attachment, treat it as a
  collection containing a single document. **Plain PDFs are therefore valid
  PDFX files** and are unaffected.
- If the manifest is present but malformed (invalid JSON, missing fields,
  non-positive page counts), readers SHOULD fall back to single-document
  behavior rather than failing.
- If the page counts sum to **less** than the PDF's page count, readers SHOULD
  treat the remaining pages as one trailing untitled document.
- If the page counts sum to **more** than the PDF's page count, readers SHOULD
  truncate: each document receives the pages still available, in order.

## Writer behavior

- Writers MUST concatenate pages in manifest order and MUST write page counts
  that exactly sum to the PDF's page count.
- Writers SHOULD use the `.pdfx` file extension, and MAY use `.pdf` — the
  format is self-describing through the manifest.
- Writers SHOULD set the attachment's MIME type to `application/json`.

## Presentation (non-normative)

The canonical PDFX reading layout is a two-axis grid:

- **Horizontal** — scroll through the pages of one document.
- **Vertical** — move between the documents of the collection.

## Media type & extension

- File extension: `.pdfx`
- Recommended interim media type: `application/pdf` (the file _is_ a PDF).
