import { describe, it, expect } from 'vitest';
import { buildWorkbook } from './fixtures/in-memory-workbook.js';
import { checkCellTypes } from '../src/core/preflight-checks.js';
import { describeCollection } from '../src/core/descriptors.js';

const resistance = describeCollection('resistance');

function sheet(columns: string[], rows: (string | number | null)[][]) {
  return buildWorkbook([{ name: 'resistance', columns, rows }]).getWorksheet('resistance')!;
}

describe('checkCellTypes (check #4)', () => {
  it('passes integers, floats (comma or dot), and sentinels', () => {
    const ws = sheet(
      ['samplingYear', 'resistenzrate'],
      [
        [2024, '5,5'],
        ['2023', 5.5],
        ['-', '_'], // sentinels are "no value", not type errors
      ],
    );
    expect(checkCellTypes(ws, resistance)).toEqual([]);
  });

  it('flags a non-numeric value in a numeric column with row, field and value', () => {
    const ws = sheet(['samplingYear', 'resistenzrate'], [['not-a-year', 'nope']]);
    const findings = checkCellTypes(ws, resistance);

    expect(findings).toHaveLength(2);
    const year = findings.find((f) => f.field === 'samplingYear')!;
    expect(year).toMatchObject({
      check: 4,
      level: 'error',
      sheet: 'resistance',
      row: 2,
      value: 'not-a-year',
    });
  });

  it('does not flag string columns', () => {
    const ws = sheet(['zomoProgram_en'], [['anything goes here']]);
    expect(checkCellTypes(ws, resistance)).toEqual([]);
  });
});
