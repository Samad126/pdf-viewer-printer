import {
  DOCX_MIME_TYPE,
  DOC_MIME_TYPE,
  fallbackNameForMimeType,
  isWordFileName,
  isWordMimeType,
  toPdfFileName,
} from '../documentTypes';

describe('isWordFileName', () => {
  it('recognises every Word extension in any case', () => {
    expect(isWordFileName('Report.docx')).toBe(true);
    expect(isWordFileName('REPORT.DOCX')).toBe(true);
    expect(isWordFileName('macro.docm')).toBe(true);
  });

  it('accepts the legacy binary format, which the conversion server reads', () => {
    expect(isWordFileName('Report.doc')).toBe(true);
    expect(isWordFileName('report.DOC')).toBe(true);
  });

  it('rejects PDFs and extension-less names', () => {
    expect(isWordFileName('Report.pdf')).toBe(false);
    expect(isWordFileName('report')).toBe(false);
  });

  it('rejects an extension that merely contains "doc"', () => {
    expect(isWordFileName('report.docx.bak')).toBe(false);
    expect(isWordFileName('mydocx')).toBe(false);
    expect(isWordFileName('documentation.pdf')).toBe(false);
  });
});

describe('isWordMimeType', () => {
  it('recognises both Word MIME types', () => {
    expect(isWordMimeType(DOCX_MIME_TYPE)).toBe(true);
    expect(isWordMimeType(DOC_MIME_TYPE)).toBe(true);
  });

  it('ignores case, which providers are inconsistent about', () => {
    expect(isWordMimeType('Application/MSWord')).toBe(true);
  });

  it('rejects other types and a missing one', () => {
    expect(isWordMimeType('application/pdf')).toBe(false);
    expect(isWordMimeType('application/octet-stream')).toBe(false);
    expect(isWordMimeType(null)).toBe(false);
    expect(isWordMimeType(undefined)).toBe(false);
  });
});

describe('fallbackNameForMimeType', () => {
  // The extension decides which of the app's two opening paths the file takes, so the fallback has
  // to carry the right one - a .doc named .pdf would be handed to the PDF viewer and fail there.
  it('names a Word document after the format it actually is', () => {
    expect(fallbackNameForMimeType(DOCX_MIME_TYPE)).toBe('document.docx');
    expect(fallbackNameForMimeType(DOC_MIME_TYPE)).toBe('document.doc');
  });

  it('falls back to a PDF for anything unrecognised', () => {
    expect(fallbackNameForMimeType('application/pdf')).toBe('document.pdf');
    expect(fallbackNameForMimeType(undefined)).toBe('document.pdf');
  });
});

describe('toPdfFileName', () => {
  it('swaps a Word extension for .pdf', () => {
    expect(toPdfFileName('Report.docx')).toBe('Report.pdf');
    expect(toPdfFileName('Quarterly macro.docm')).toBe('Quarterly macro.pdf');
    expect(toPdfFileName('Legacy report.doc')).toBe('Legacy report.pdf');
  });

  it('leaves an existing name ending in .pdf alone', () => {
    expect(toPdfFileName('Report.pdf')).toBe('Report.pdf');
  });

  it('appends .pdf to a name with no extension', () => {
    expect(toPdfFileName('Report')).toBe('Report.pdf');
  });

  it('preserves dots that are not the extension separator', () => {
    expect(toPdfFileName('Q3.2026 report.docx')).toBe('Q3.2026 report.pdf');
  });

  it('handles a leading dot rather than truncating the whole name', () => {
    expect(toPdfFileName('.gitignore')).toBe('.gitignore.pdf');
  });
});
