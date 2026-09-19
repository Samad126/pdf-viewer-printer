import { buildConversionCacheKey, convertedPdfPath } from '../conversionPaths';

describe('buildConversionCacheKey', () => {
  it('is stable for the same source file', () => {
    expect(buildConversionCacheKey('/cache/Report.docx', 1234, 1700000000000)).toBe(
      buildConversionCacheKey('/cache/Report.docx', 1234, 1700000000000),
    );
  });

  it('changes when the file is edited', () => {
    const original = buildConversionCacheKey('/cache/Report.docx', 1234, 1700000000000);
    expect(buildConversionCacheKey('/cache/Report.docx', 1235, 1700000000000)).not.toBe(original);
    expect(buildConversionCacheKey('/cache/Report.docx', 1234, 1700000000001)).not.toBe(original);
  });

  it('differs between two files of the same size saved at the same time', () => {
    expect(buildConversionCacheKey('/cache/A.docx', 1234, 1700000000000)).not.toBe(
      buildConversionCacheKey('/cache/B.docx', 1234, 1700000000000),
    );
  });

  it('is a fixed-width hex string, so it is safe to use in a filename', () => {
    expect(buildConversionCacheKey('/cache/Report.docx', 1, 2)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('convertedPdfPath', () => {
  it('puts the file in the conversion cache directory under its PDF name', () => {
    expect(convertedPdfPath('/cache', 'Report.docx', 'abcdef0123456789')).toBe(
      '/cache/docx-converted/abcdef0123456789-Report.pdf',
    );
  });

  it('keeps the cache key in the name, so two documents cannot collide', () => {
    const first = convertedPdfPath('/cache', 'Report.docx', 'aaaaaaaaaaaaaaaa');
    const second = convertedPdfPath('/cache', 'Report.docx', 'bbbbbbbbbbbbbbbb');
    expect(first).not.toBe(second);
  });

  it('strips characters that would be awkward in a filename', () => {
    expect(convertedPdfPath('/cache', 'Q3 report: final?.docx', 'abcdef0123456789')).toBe(
      '/cache/docx-converted/abcdef0123456789-Q3-report-final.pdf',
    );
  });

  it('keeps the extension even when the name sanitises away to nothing', () => {
    // The name and its extension are sanitised separately for exactly this reason: stripping the
    // leading characters of "???.pdf" together with its dot would leave a file called "-pdf".
    expect(convertedPdfPath('/cache', '???', 'abcdef0123456789')).toBe(
      '/cache/docx-converted/abcdef0123456789-document.pdf',
    );
  });
});
