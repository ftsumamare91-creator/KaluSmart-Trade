/**
 * Keyword search over a document's title and extracted fields. Pure function, no I/O.
 * Matching is case-insensitive and literal: the query is never treated as a pattern or as SQL.
 * Extracted values are unverified model output, so results say which field matched.
 */

export interface SearchableDoc {
  id: string;
  title: string;
  category: string;
  status: string;
  extractedFields: unknown;
}

export interface SearchHit {
  id: string;
  title: string;
  category: string;
  status: string;
  matchedIn: string[]; // "title" or an extracted field name, e.g. "supplierName", "items"
  snippet: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  supplierName: 'supplier',
  documentNumber: 'document number',
  documentDate: 'date',
  currency: 'currency',
  subtotal: 'subtotal',
  tax: 'tax',
  discount: 'discount',
  total: 'total',
  paymentReference: 'payment reference',
  items: 'line items',
};

export function normaliseQuery(raw: string): string | null {
  const q = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return q.length >= 2 && q.length <= 100 ? q : null;
}

export function searchDocuments(docs: SearchableDoc[], rawQuery: string, limit = 50): SearchHit[] {
  const q = normaliseQuery(rawQuery);
  if (!q) return [];
  const needle = q.toLowerCase();
  const hits: SearchHit[] = [];

  for (const doc of docs) {
    const matchedIn: string[] = [];
    let snippet: string | null = null;

    if (doc.title.toLowerCase().includes(needle)) matchedIn.push('title');

    const fields = (doc.extractedFields && typeof doc.extractedFields === 'object' ? doc.extractedFields : {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(fields)) {
      if (!(key in FIELD_LABELS)) continue;
      const text = key === 'items'
        ? (Array.isArray(value) ? value.map((it) => (it && typeof it === 'object' ? Object.values(it).filter((v) => typeof v === 'string').join(' ') : '')).join(' ') : '')
        : (typeof value === 'string' ? value : '');
      if (text && text.toLowerCase().includes(needle)) {
        matchedIn.push(key);
        snippet ??= makeSnippet(text, needle);
      }
    }

    if (matchedIn.length > 0) {
      hits.push({
        id: doc.id,
        title: doc.title,
        category: doc.category,
        status: doc.status,
        matchedIn: matchedIn.map((k) => (k === 'title' ? 'title' : FIELD_LABELS[k])),
        snippet,
      });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

/** A short piece of text around the match, so users can see why a document was returned. */
export function makeSnippet(text: string, lowerNeedle: string, radius = 30): string {
  const at = text.toLowerCase().indexOf(lowerNeedle);
  if (at < 0) return text.slice(0, 2 * radius);
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + lowerNeedle.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
