import { describe, it, expect } from 'vitest';
import { buildWorkbook } from './fixtures/in-memory-workbook.js';
import { checkUnique } from '../src/core/preflight-checks.js';
import { describeCollection } from '../src/core/descriptors.js';

const specie = describeCollection('specie');

function sheet(columns: string[], rows: (string | number | null)[][]) {
  return buildWorkbook([{ name: 'specie', columns, rows }]).getWorksheet('specie')!;
}

describe('checkUnique (check #6)', () => {
  it('passes when the unique column has no duplicates', () => {
    const ws = sheet(['name_en'], [['Gallus gallus'], ['Sus scrofa']]);
    expect(checkUnique(ws, specie)).toEqual([]);
  });

  it('flags each repeat occurrence of a duplicated unique value with its row', () => {
    const ws = sheet(['name_en'], [['Gallus gallus'], ['Sus scrofa'], ['Gallus gallus']]);
    const findings = checkUnique(ws, specie);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: 6,
      level: 'error',
      sheet: 'specie',
      field: 'name_en',
      value: 'Gallus gallus',
      row: 4, // the second occurrence (header is row 1)
    });
  });
});
