import { parseCsv, parseMemberCsv } from './csv';

describe('parseCsv', () => {
  it('handles quoted fields, escaped quotes, commas and CRLF', () => {
    const out = parseCsv('a,"b, c"\r\n"say ""hi""",d\r\n');
    expect(out).toEqual([
      { line: 1, cells: ['a', 'b, c'] },
      { line: 2, cells: ['say "hi"', 'd'] },
    ]);
  });

  it('keeps newlines inside quotes and tracks line numbers', () => {
    const out = parseCsv('x,"multi\nline"\ny,z');
    expect(out).toEqual([
      { line: 1, cells: ['x', 'multi\nline'] },
      { line: 3, cells: ['y', 'z'] },
    ]);
  });

  it('drops blank lines and strips a BOM', () => {
    expect(parseCsv('﻿\n\n  \na,b\n\n')).toEqual([{ line: 4, cells: ['a', 'b'] }]);
  });
});

describe('parseMemberCsv', () => {
  it('parses rows without a header', () => {
    const r = parseMemberCsv('+919876543210,Asha Verma\n+919812345678,Kiran');
    expect(r.hasHeader).toBe(false);
    expect(r.rows).toEqual([
      { phone: '+919876543210', name: 'Asha Verma' },
      { phone: '+919812345678', name: 'Kiran' },
    ]);
    expect(r.issues).toEqual([]);
  });

  it('skips a header row and supports reordered columns', () => {
    const r = parseMemberCsv('Name,Phone\nAsha,9876543210\n');
    expect(r.hasHeader).toBe(true);
    expect(r.rows).toEqual([{ phone: '+919876543210', name: 'Asha' }]);
  });

  it('ignores blank lines and handles quoted names with commas and quotes', () => {
    const r = parseMemberCsv('phone,name\n\n9876543210,"Rao, Kiran"\n\n   \n9812345678,"Sam ""The Rock"" D"\n');
    expect(r.rows).toEqual([
      { phone: '+919876543210', name: 'Rao, Kiran' },
      { phone: '+919812345678', name: 'Sam "The Rock" D' },
    ]);
    expect(r.issues).toEqual([]);
  });

  it('allows phone-only rows and normalises formatting', () => {
    const r = parseMemberCsv('98765 43210\n(981) 234-5678,\n+1 415 555 0100');
    expect(r.rows).toEqual([{ phone: '+919876543210' }, { phone: '+919812345678' }, { phone: '+14155550100' }]);
  });

  it('accepts name,phone rows when there is no header', () => {
    expect(parseMemberCsv('Asha,9876543210').rows).toEqual([{ phone: '+919876543210', name: 'Asha' }]);
  });

  it('reports invalid phones and duplicates with line numbers', () => {
    const r = parseMemberCsv('phone,name\n12345,Bad\n9876543210,A\n,No phone\n+919876543210,Dup');
    expect(r.rows).toEqual([{ phone: '+919876543210', name: 'A' }]);
    expect(r.issues).toEqual([
      { line: 2, message: '"12345" is not a valid phone number' },
      { line: 4, message: 'Missing phone number' },
      { line: 5, message: 'Duplicate of line 3, skipped' },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseMemberCsv('  \n ')).toEqual({ rows: [], issues: [], hasHeader: false });
  });
});
