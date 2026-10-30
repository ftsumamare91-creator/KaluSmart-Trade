import {
  canTransition,
  detectDocument,
  parseModelJson,
  safeTitle,
  sanitizeExtraction,
  storageKeyFor,
} from './document-rules';

const pdf = Buffer.from('%PDF-1.7\n...');
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('xx')]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const zipWith = (part: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`[Content_Types].xml ${part}`)]);

describe('document type detection', () => {
  it('accepts matching bytes for each allowed type', () => {
    expect(detectDocument('receipt.pdf', pdf)?.mime).toBe('application/pdf');
    expect(detectDocument('scan.png', png)?.kind).toBe('image');
    expect(detectDocument('photo.JPG', jpg)?.ext).toBe('jpg');
    expect(detectDocument('notes.md', Buffer.from('# hello'))?.mime).toBe('text/markdown');
    expect(detectDocument('book.xlsx', zipWith('xl/workbook.xml'))?.kind).toBe('document');
  });
  it('refuses a disguised file: bytes must match the extension', () => {
    expect(detectDocument('invoice.pdf', Buffer.from('MZ\x90\x00 executable'))).toBeNull();
    expect(detectDocument('photo.png', pdf)).toBeNull();
    expect(detectDocument('plan.docx', zipWith('xl/workbook.xml'))).toBeNull(); // zip, but not a Word file
  });
  it('refuses unsupported and executable extensions, even with valid bytes', () => {
    expect(detectDocument('run.exe', pdf)).toBeNull();
    expect(detectDocument('page.html', Buffer.from('<html>'))).toBeNull();
    expect(detectDocument('anim.gif', Buffer.from('GIF89a'))).toBeNull();
    expect(detectDocument('noext', pdf)).toBeNull();
  });
  it('refuses binary data posing as text', () => {
    expect(detectDocument('data.csv', Buffer.from([0x61, 0x00, 0x62]))).toBeNull();
  });
});

describe('names and storage keys', () => {
  it('strips path components and control characters from titles', () => {
    expect(safeTitle('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(safeTitle('C:\\Users\\me\\bill\u0000.pdf')).toBe('bill.pdf');
    expect(safeTitle('   ')).toBe('document');
  });
  it('builds storage keys only from server-side values', () => {
    expect(storageKeyFor('org1', 'doc9', 'pdf')).toBe('documents/org1/doc9.pdf');
  });
});

describe('status transitions', () => {
  it('allows the analysis path and refuses skipping steps', () => {
    expect(canTransition('UPLOADED', 'PROCESSING')).toBe(true);
    expect(canTransition('PROCESSING', 'REVIEW_REQUIRED')).toBe(true);
    expect(canTransition('UPLOADED', 'COMPLETED')).toBe(false);
    expect(canTransition('COMPLETED', 'PROCESSING')).toBe(false);
  });
  it('a failed run can be retried', () => {
    expect(canTransition('PROCESSING', 'FAILED')).toBe(true);
    expect(canTransition('FAILED', 'PROCESSING')).toBe(true);
  });
});

describe('model output sanitising', () => {
  it('keeps missing values null instead of inventing them', () => {
    const f = sanitizeExtraction({ supplierName: 'Abay Shop', total: '1200.50' });
    expect(f.supplierName).toBe('Abay Shop');
    expect(f.total).toBe('1200.50');
    expect(f.tax).toBeNull();
    expect(f.documentDate).toBeNull();
    expect(f.items).toEqual([]);
  });
  it('rejects malformed amounts, dates and currencies', () => {
    const f = sanitizeExtraction({ total: 'ETB 1200', subtotal: '1e9', documentDate: '12/03/2026', currency: 'birr' });
    expect(f.total).toBeNull();
    expect(f.subtotal).toBeNull();
    expect(f.documentDate).toBeNull();
    expect(f.currency).toBeNull();
  });
  it('removes control characters and caps long text', () => {
    const f = sanitizeExtraction({ supplierName: 'A\u0007B\n\nC'.padEnd(500, 'x') });
    expect(f.supplierName).toMatch(/^A B C/);
    expect(f.supplierName!.length).toBeLessThanOrEqual(200);
  });
  it('ignores instruction-like keys the model was never asked for', () => {
    const f = sanitizeExtraction({ total: '5', action: 'create sale', confirmed: true });
    expect(Object.keys(f)).not.toContain('action');
    expect(Object.keys(f)).not.toContain('confirmed');
  });
  it('caps the number of line items', () => {
    const many = Array.from({ length: 300 }, () => ({ description: 'x', quantity: '1' }));
    expect(sanitizeExtraction({ items: many }).items).toHaveLength(100);
  });
});

describe('parseModelJson', () => {
  it('parses bare and fenced JSON, and rejects prose', () => {
    expect(parseModelJson('{"total":"5"}')).toEqual({ total: '5' });
    expect(parseModelJson('```json\n{"total":"5"}\n```')).toEqual({ total: '5' });
    expect(parseModelJson('Sure! Here is the total: 5')).toBeNull();
    expect(parseModelJson('[1,2]')).toBeNull();
  });
});
