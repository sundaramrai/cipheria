import Papa from 'papaparse';
import { MAX_EXPORT_BYTES } from './vaultImport.ts';
import type { PlainImportItem } from './vaultImport';

export const CSV_FIELDS = ['name', 'url', 'username', 'password', 'notes'] as const;
export type CsvMapping = Record<typeof CSV_FIELDS[number], number>;
export interface CsvTable { headers: string[]; rows: string[][] }
export interface CsvIssue { row: number; reason: string }

const aliases: Record<typeof CSV_FIELDS[number], string[]> = {
  name: ['name', 'title'], url: ['url', 'website', 'origin'],
  username: ['username', 'user name', 'login'], password: ['password'], notes: ['note', 'notes'],
};
// Other nonempty unmapped columns require explicit acknowledgement in the UI.
const browserMetadata = new Set(['guid', 'timecreated', 'timelastused', 'timepasswordchanged', 'formactionorigin']);
const normalize = (header: string) => header.trim().toLowerCase();

export function parseCsv(source: string): CsvTable {
  if (new TextEncoder().encode(source).byteLength > MAX_EXPORT_BYTES) throw new Error('Choose a file smaller than 2 MiB.');
  const parsed = Papa.parse<string[]>(source.replace(/^\uFEFF/, ''), {
    delimiter: ',', dynamicTyping: false, skipEmptyLines: 'greedy', preview: 1002,
  });
  if (parsed.errors.length) throw new Error('The CSV has malformed quoting. Correct the file before importing.');
  const [headers, ...rows] = parsed.data;
  if (!headers?.length || headers.length > 100 || headers.some(header => !normalize(header) || header.length > 128) ||
      new Set(headers.map(normalize)).size !== headers.length) {
    throw new Error('Use at most 100 unique, nonempty column headers, each up to 128 characters.');
  }
  if (!rows.length || rows.length > 1000 || parsed.meta.truncated) throw new Error('Choose a CSV containing 1 to 1000 records.');
  return { headers, rows };
}

export function suggestCsvMapping(table: CsvTable): CsvMapping {
  return Object.fromEntries(CSV_FIELDS.map(field => [field,
    table.headers.findIndex(header => aliases[field].includes(normalize(header))),
  ])) as CsvMapping;
}

export function mapCsvRows(table: CsvTable, mapping: CsvMapping) {
  const columns = CSV_FIELDS.map(field => mapping[field]).filter(index => index !== -1);
  if (columns.some(index => !Number.isInteger(index) || index < 0 || index >= table.headers.length) ||
      new Set(columns).size !== columns.length || mapping.password === -1 || (mapping.url === -1 && mapping.name === -1)) {
    throw new Error('Map Password and either Website URL or Title. Each field must use a different column.');
  }
  const omittedColumns = table.headers.filter((header, index) => !columns.includes(index) &&
    !browserMetadata.has(normalize(header)) && table.rows.some(row => (row[index] ?? '') !== ''));
  const ignoredMetadata = table.headers.filter((header, index) => !columns.includes(index) &&
    browserMetadata.has(normalize(header)) && table.rows.some(row => (row[index] ?? '') !== ''));
  const items: PlainImportItem[] = [];
  const issues: CsvIssue[] = [];
  const created_at = new Date().toISOString();
  table.rows.forEach((row, index) => {
    const sourceRow = index + 2; // CSV record number, including the header; not a physical line number.
    if (row.length !== table.headers.length) {
      issues.push({ row: sourceRow, reason: 'Column count does not match the header.' });
      return;
    }
    const read = (field: typeof CSV_FIELDS[number]) => mapping[field] === -1 ? '' : row[mapping[field]];
    const url = read('url');
    let name = read('name').trim();
    if (!name && url) {
      try { name = new URL(url).hostname; } catch { /* Invalid identifiers are reported below. */ }
    }
    if (!name || name.length > 255 || !read('password').length) {
      issues.push({ row: sourceRow, reason: 'Needs a title (up to 255 characters) or website URL, and a nonempty password.' });
      return;
    }
    const payload = { username: read('username'), password: read('password'), url, notes: read('notes') };
    if (17 + 4 * Math.ceil((new TextEncoder().encode(JSON.stringify(payload)).byteLength + 16) / 3) > 100_000) {
      issues.push({ row: sourceRow, reason: 'Item exceeds the encrypted item size limit.' });
      return;
    }
    items.push({ name, category: 'login', is_favourite: false, created_at, sourceRow, payload });
  });
  return { items, issues, omittedColumns, ignoredMetadata };
}
