import { normaliseQuery, searchDocuments } from './document-search';

const docs = [
  { id: 'd1', title: 'Abay shop March.pdf', category: 'RECEIPT', status: 'COMPLETED', extractedFields: { supplierName: 'Abay Trading PLC', total: '1200.50', items: [{ description: 'Cement 50kg', quantity: '10' }] } },
  { id: 'd2', title: 'contract.docx', category: 'CONTRACT', status: 'UPLOADED', extractedFields: null },
  { id: 'd3', title: 'invoice.pdf', category: 'INVOICE', status: 'REVIEW_REQUIRED', extractedFields: { supplierName: null, documentNumber: 'INV-0042' } },
];

describe('document content search', () => {
  it('finds a match in extracted fields and names the field', () => {
    const hits = searchDocuments(docs, 'abay');
    expect(hits.map((h) => h.id)).toEqual(['d1']);
    expect(hits[0].matchedIn).toContain('supplier');
    expect(hits[0].snippet).toContain('Abay');
  });
  it('finds a match inside line items', () => {
    expect(searchDocuments(docs, 'cement')[0].matchedIn).toEqual(['line items']);
  });
  it('matches titles too', () => {
    expect(searchDocuments(docs, 'CONTRACT').map((h) => h.id)).toEqual(['d2']);
  });
  it('finds document numbers', () => {
    expect(searchDocuments(docs, 'inv-0042')[0].id).toBe('d3');
  });
  it('treats the query literally, never as a pattern', () => {
    expect(searchDocuments(docs, '.*')).toEqual([]);
    expect(searchDocuments(docs, "' OR 1=1 --")).toEqual([]);
  });
  it('ignores queries that are too short or too long', () => {
    expect(normaliseQuery('a')).toBeNull();
    expect(normaliseQuery('x'.repeat(101))).toBeNull();
    expect(searchDocuments(docs, 'a')).toEqual([]);
  });
  it('does not match on fields it does not index', () => {
    expect(searchDocuments([{ ...docs[1], extractedFields: { secretNote: 'hidden word' } }], 'hidden')).toEqual([]);
  });
  it('respects the result limit', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ ...docs[1], id: `x${i}`, title: 'match me.txt' }));
    expect(searchDocuments(many, 'match').length).toBe(50);
  });
});
