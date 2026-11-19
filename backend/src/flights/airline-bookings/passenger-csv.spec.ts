import { csvCell, toCsv } from './passenger-csv';

describe('passenger CSV (FLT-29)', () => {
  it('leaves a plain cell alone', () => {
    expect(csvCell('Amira Hassan')).toBe('Amira Hassan');
  });

  it('quotes a cell with a comma, a quote or a line break and doubles the quotes', () => {
    expect(csvCell('Hassan, Amira')).toBe('"Hassan, Amira"');
    expect(csvCell('Amira "Mimi" Hassan')).toBe('"Amira ""Mimi"" Hassan"');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  it.each(['=SUM(A1)', '+1', '-1', '@cmd', '\tx'])(
    'defuses a spreadsheet formula: %j',
    (value) => {
      expect(csvCell(value).startsWith("'")).toBe(true);
    },
  );

  it('quotes a defused cell that also needs quotes', () => {
    expect(csvCell('=A1,B1')).toBe('"\'=A1,B1"');
  });

  it('keeps non-latin names as they are', () => {
    expect(csvCell('أميرة حسن')).toBe('أميرة حسن');
  });

  it('writes a BOM, the header and CRLF line ends', () => {
    const csv = toCsv(['A', 'B'], [['1', 'x, y']]);
    expect(csv).toBe('﻿A,B\r\n1,"x, y"\r\n');
  });

  it('writes only the header for no rows', () => {
    expect(toCsv(['A'], [])).toBe('﻿A\r\n');
  });
});
