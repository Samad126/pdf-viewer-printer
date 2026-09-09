# PDF Press

An Android PDF viewer and printer app built with React Native. It reads and prints PDFs entirely
through [PDFium](https://pdfium.googlesource.com/pdfium/), never through Android's built-in
`PdfRenderer`, because `PdfRenderer` silently drops content on PDFs with CID-keyed / Type1C
embedded fonts.

## Why PDFium instead of `PdfRenderer`

Android ships two unrelated PDF APIs under `android.graphics.pdf`:

- `PdfRenderer` — a *reader*, used to rasterize existing PDF pages to bitmaps. This app never uses
  it, because it mishandles certain embedded font types and can render pages with missing text.
- `PdfDocument` — a *writer*, used to assemble a brand-new PDF from bitmaps/canvas drawing. This
  app uses it for every print and annotation output.

Instead, every page this app needs to display or rasterize goes through PDFium
(`io.legere:pdfiumandroid`), which renders correctly regardless of embedded font type. The
print pipeline is: **rasterize each page with PDFium → composite anything that needs to be added
(e.g. drawn annotations) onto the bitmap → reassemble the pages into a new PDF with
`android.graphics.pdf.PdfDocument`.** This same rasterize/rebuild pipeline backs both printing and
the "Draw / Annotate" feature.

## Features

- **View** any PDF via [`react-native-pdf`](https://github.com/wonday/react-native-pdf), with
  night mode (colour inversion), table of contents (from the PDF outline), and in-document find
  (PDFium full-text search).
- **Print** two ways:
  - Through Android's system print spooler (`PrintManager`), with copies, page range, color mode,
    duplex, and orientation options, plus job cancellation.
  - **Direct IPP printing** — a hand-rolled IPP/1.1 client (RFC 8010/8011) that talks straight to a
    network printer over `HttpURLConnection`, bypassing the Android print spooler entirely. This
    exists because some printers show a blocking "no longer accepts encrypted jobs" system dialog
    through the normal print path; going direct avoids it. Supports mDNS printer discovery, the
    same print options as above, and both local and remote (`Cancel-Job`) job cancellation.
- **Draw / Annotate** — freehand drawing over any page, with whole-document pinch-to-zoom,
  undo/clear, and a save-as flow.
- **Share** any open PDF via the system share sheet, and receive PDFs shared into the app from
  other apps ("Open with" / "Share").
- **Export** a PDF as a zip of per-page PNGs, or as extracted plain text.
- Registered as a PDF viewer for Android's file-open and share intents.

## Requirements

- Node.js ≥ 22.11
- Android SDK (compileSdk 37, targetSdk 36, minSdk 26)
- A physical device or emulator — this app is Android-only

## Getting started

```sh
npm install
npm run android      # builds and installs a debug build via Metro
```

Debug builds load JavaScript from the Metro dev server; if you're not running one, build a release
APK instead (bundles JS at build time):

```sh
cd android
./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/app-release.apk
```

## Project structure

- `android/app/src/main/java/com/pdfprinter/pdf/` — PDFium bridging: opening documents,
  rasterizing pages, text extraction/search.
- `android/app/src/main/java/com/pdfprinter/print/` — the system print path
  (`PrintDocumentAdapter` + `PrintManager`).
- `android/app/src/main/java/com/pdfprinter/printers/` — the direct IPP print path (encoder,
  response parser, HTTP transport, mDNS discovery).
- `android/app/src/main/java/com/pdfprinter/annotate/` — server-side rasterize + composite +
  rebuild for the drawing feature.
- `android/app/src/main/java/com/pdfprinter/sharing/` — send/receive sides of PDF sharing.
- `src/viewer/` — the main viewer screen and its overlays (menus, find, print flow).
- `src/annotate/` — the drawing/annotation screen.
- `src/printers/` — JS side of the direct IPP print pipeline and printer picker UI.
- `src/pdf-tools/` — find, export, and share features.

## Scripts

```sh
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # jest
```

## License

MIT — see [LICENSE](LICENSE).
