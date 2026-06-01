import { describe, it, expect } from 'vitest';
import { buildWorkbook } from './fixtures/in-memory-workbook.js';
import { checkRequiredFields } from '../src/core/preflight-checks.js';
import { describeCollection } from '../src/core/descriptors.js';

const resistance = describeCollection('resistance');

function sheet(columns: string[], rows: (string | number | null)[][]) {
  return buildWorkbook([{ name: 'resistance', columns, rows }]).getWorksheet('resistance')!;
}

describe('checkRequiredFields (check #5)', () => {
  it('passes when every required field has a value', () => {
    const ws = sheet(
      ['dbId', 'samplingYear'],
      [
        ['R-1', 2024],
        ['R-2', 2023],
      ],
    );
    expect(checkRequiredFields(ws, resistance)).toEqual([]);
  });

  it('flags an empty required field (sentinel counts as empty) with row and field', () => {
    const ws = sheet(
      ['dbId', 'samplingYear'],
      [
        ['-', 2024], // dbId missing
        ['R-2', '_'], // samplingYear missing
      ],
    );
    const findings = checkRequiredFields(ws, resistance);

    expect(findings).toHaveLength(2);
    expect(findings.find((f) => f.field === 'dbId')).toMatchObject({
      check: 5,
      level: 'error',
      row: 2,
    });
    expect(findings.find((f) => f.field === 'samplingYear')).toMatchObject({
      check: 5,
      level: 'error',
      row: 3,
    });
  });

  it('does not flag optional fields left blank', () => {
    const ws = sheet(['dbId', 'samplingYear', 'zomoProgram_en'], [['R-1', 2024, '-']]);
    expect(checkRequiredFields(ws, resistance)).toEqual([]);
  });
});
