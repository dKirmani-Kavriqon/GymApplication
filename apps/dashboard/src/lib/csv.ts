import { phoneSchema } from '@gymverse/shared';
import { normalizePhone } from './format';

export interface ImportRow {
  phone: string;
  name?: string;
}

export interface CsvIssue {
  line: number;
  message: string;
}

export interface MemberCsvResult {
  rows: ImportRow[];
  issues: CsvIssue[];
  hasHeader: boolean;
}

export const MAX_IMPORT_ROWS = 5000;

/** Minimal RFC-4180 reader: quoted fields, "" escapes, commas/newlines inside quotes, CRLF. */
export function parseCsv(text: string): Array<{ line: number; cells: string[] }> {
  const src = text.replace(/^﻿/, '');
  const records: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      cell = '';
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else if (ch === '\r') {
      // ignored: "\n" ends the record
    } else if (ch === '\n') {
      cells.push(cell);
      records.push({ line: recordLine, cells });
      cells = [];
      cell = '';
      line++;
      recordLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || cells.length > 0) {
    cells.push(cell);
    records.push({ line: recordLine, cells });
  }
  return records
    .map((r) => ({ line: r.line, cells: r.cells.map((c) => c.trim()) }))
    .filter((r) => r.cells.some((c) => c !== ''));
}

const PHONE_HEADERS = ['phone', 'mobile', 'phone number', 'mobile number', 'number', 'contact', 'whatsapp'];
const NAME_HEADERS = ['name', 'full name', 'member', 'member name'];

function looksLikePhone(value: string): boolean {
  return phoneSchema.safeParse(normalizePhone(value)).success;
}

/**
 * Parses `phone,name` rows for `/members/import`. The header row is optional
 * (and may reorder columns); blank lines are ignored; bad phones and duplicates
 * are reported per line instead of failing the whole file.
 */
export function parseMemberCsv(text: string): MemberCsvResult {
  const records = parseCsv(text);
  const issues: CsvIssue[] = [];
  const rows: ImportRow[] = [];
  let phoneIdx = 0;
  let nameIdx = 1;
  let hasHeader = false;

  if (records.length > 0) {
    const lower = records[0].cells.map((c) => c.toLowerCase());
    const p = lower.findIndex((c) => PHONE_HEADERS.includes(c));
    const n = lower.findIndex((c) => NAME_HEADERS.includes(c));
    if (p >= 0 || n >= 0) {
      hasHeader = true;
      phoneIdx = p >= 0 ? p : n === 0 ? 1 : 0;
      nameIdx = n >= 0 ? n : phoneIdx === 0 ? 1 : 0;
      records.shift();
    }
  }

  const seen = new Map<string, number>();
  for (const { line, cells } of records) {
    let rawPhone = cells[phoneIdx] ?? '';
    let rawName = cells[nameIdx] ?? '';
    // Without a header, accept "name,phone" rows too.
    if (!hasHeader && !looksLikePhone(rawPhone) && looksLikePhone(rawName)) {
      [rawPhone, rawName] = [rawName, rawPhone];
    }
    if (!rawPhone) {
      issues.push({ line, message: 'Missing phone number' });
      continue;
    }
    const phone = normalizePhone(rawPhone);
    if (!phoneSchema.safeParse(phone).success) {
      issues.push({ line, message: `"${rawPhone}" is not a valid phone number` });
      continue;
    }
    const first = seen.get(phone);
    if (first !== undefined) {
      issues.push({ line, message: `Duplicate of line ${first}, skipped` });
      continue;
    }
    seen.set(phone, line);
    const name = rawName.slice(0, 60).trim();
    rows.push(name ? { phone, name } : { phone });
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    issues.push({ line: 0, message: `Only ${MAX_IMPORT_ROWS} members can be imported at once` });
  }
  return { rows, issues, hasHeader };
}
