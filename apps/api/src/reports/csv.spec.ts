import { csvField, safeCell, safeFilename, toCsv } from './csv';

describe('CSV safety', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(safeCell('=HYPERLINK("http://x")')).toBe("'=HYPERLINK(\"http://x\")");
    expect(safeCell('+1')).toBe("'+1");
    expect(safeCell('-2')).toBe("'-2");
    expect(safeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeCell('normal text')).toBe('normal text');
  });
  it('quotes fields with commas, quotes and line breaks', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });
  it('renders null as an empty cell', () => {
    expect(csvField(null)).toBe('');
  });
  it('starts with a UTF-8 BOM and keeps Amharic text intact', () => {
    const out = toCsv(['Name'], [['ቃል ኤሌክትሪካል']]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toContain('ቃል ኤሌክትሪካል');
    expect(out.endsWith('\r\n')).toBe(true);
  });
  it('builds a filename without user text or path characters', () => {
    expect(safeFilename(['sales', '2026-10-01', '../../etc'])).toBe('sales_2026-10-01_etc.csv');
  });
});
