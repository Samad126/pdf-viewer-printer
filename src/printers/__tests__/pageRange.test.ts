import { parsePageRangeInput } from '../pageRange';

describe('parsePageRangeInput', () => {
  it('treats blank input as "all pages"', () => {
    expect(parsePageRangeInput('', 10)).toBeUndefined();
    expect(parsePageRangeInput('   ', 10)).toBeUndefined();
  });

  it('treats the word "all" (any case) as "all pages"', () => {
    expect(parsePageRangeInput('all', 10)).toBeUndefined();
    expect(parsePageRangeInput('ALL', 10)).toBeUndefined();
    expect(parsePageRangeInput('  All  ', 10)).toBeUndefined();
  });

  it('parses a mix of single pages and ranges into 0-based, sorted, deduplicated indices', () => {
    expect(parsePageRangeInput('1-3, 5, 7-9', 12)).toEqual([0, 1, 2, 4, 6, 7, 8]);
  });

  it('deduplicates overlapping ranges and out-of-order input', () => {
    expect(parsePageRangeInput('5, 1-3, 2-4', 10)).toEqual([0, 1, 2, 3, 4]);
  });

  it('handles a single page', () => {
    expect(parsePageRangeInput('4', 10)).toEqual([3]);
  });

  it('tolerates surrounding whitespace around ranges', () => {
    expect(parsePageRangeInput(' 1 - 3 , 5 ', 10)).toEqual([0, 1, 2, 4]);
  });

  it('throws for non-numeric input', () => {
    expect(() => parsePageRangeInput('abc', 10)).toThrow();
  });

  it('throws for a reversed range', () => {
    expect(() => parsePageRangeInput('5-2', 10)).toThrow();
  });

  it('throws for page 0', () => {
    expect(() => parsePageRangeInput('0', 10)).toThrow();
  });

  it('throws for a page beyond pageCount', () => {
    expect(() => parsePageRangeInput('11', 10)).toThrow();
  });

  it('throws when any segment in a comma list is invalid', () => {
    expect(() => parsePageRangeInput('1-3, abc', 10)).toThrow();
  });
});
