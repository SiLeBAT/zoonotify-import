import { describe, it, expect } from 'vitest';
import { buildWorkbook } from './fixtures/in-memory-workbook.js';
import { checkRequiredColumns } from '../src/core/preflight-checks.js';
import { describeCollection } from '../src/core/descriptors.js';

const matrixGroup = describeCollection('matrix-group');

function sheet(columns: string[]) {
  return buildWorkbook([{ name: 'matrix-group', columns }]).getWorksheet('matrix-group')!;
}

describe('checkRequiredColumns (check #3)', () => {
  it('returns no findings when every declared column is in the header', () => {
    const ws = sheet(['name_en', 'name_de', 'iri_en', 'iri_de']);
    expect(checkRequiredColumns(ws, matrixGroup)).toEqual([]);
  });

  it('flags each absent column as a check-3 error naming the column', () => {
    const ws = sheet(['name_en', 'iri_en']); // name_de and iri_de missing
    const findings = checkRequiredColumns(ws, matrixGroup);

    expect(findings.map((f) => f.field).sort()).toEqual(['iri_de', 'name_de']);
    expect(
      findings.every((f) => f.check === 3 && f.level === 'error' && f.sheet === 'matrix-group'),
    ).toBe(true);
  });
});
