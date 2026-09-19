import { isDocxFileName, isLegacyDocFileName, toPdfFileName } from '../documentTypes';

describe('isDocxFileName', () => {
  it('recognises the OOXML extensions in any case', () => {
    expect(isDocxFileName('Report.docx')).toBe(true);
    expect(isDocxFileName('REPORT.DOCX')).toBe(true);
    expect(isDocxFileName('macro.docm')).toBe(true);
  });

  it('does not confuse the legacy .doc format for a .docx', () => {
    expect(isDocxFileName('Report.doc')).toBe(false);
    expect(isDocxFileName('report.DOC')).toBe(false);
  });

  it('rejects PDFs and extension-less names', () => {
    expect(isDocxFileName('Report.pdf')).toBe(false);
    expect(isDocxFileName('report')).toBe(false);
  });

  it('rejects an extension that merely contains "docx"', () => {
    expect(isDocxFileName('report.docx.bak')).toBe(false);
    expect(isDocxFileName('mydocx')).toBe(false);
  });
});

describe('isLegacyDocFileName', () => {
  it('recognises the binary format', () => {
    expect(isLegacyDocFileName('Report.doc')).toBe(true);
    expect(isLegacyDocFileName('REPORT.DOC')).toBe(true);
  });

  it('does not match the OOXML formats', () => {
    expect(isLegacyDocFileName('Report.docx')).toBe(false);
    expect(isLegacyDocFileName('Report.docm')).toBe(false);
  });
});

describe('toPdfFileName', () => {
  it('swaps a Word extension for .pdf', () => {
    expect(toPdfFileName('Report.docx')).toBe('Report.pdf');
    expect(toPdfFileName('Quarterly macro.docm')).toBe('Quarterly macro.pdf');
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
