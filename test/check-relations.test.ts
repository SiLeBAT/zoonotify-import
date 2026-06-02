import { describe, it, expect } from 'vitest';
import { buildWorkbook } from './fixtures/in-memory-workbook.js';
import { checkRelations } from '../src/core/preflight-checks.js';
import { describeCollection } from '../src/core/descriptors.js';

const descriptors = [describeCollection('matrix'), describeCollection('resistance')];

// Minimal resistance columns: just the relation under test plus its DE half.
function workbook(matrixRows: (string | null)[][], resistanceRows: (string | null)[][]) {
  return buildWorkbook([
    { name: 'matrix', columns: ['name_en', 'name_de', 'iri'], rows: matrixRows },
    { name: 'resistance', columns: ['matrix_en', 'matrix_de'], rows: resistanceRows },
  ]);
}

describe('checkRelations (check #7)', () => {
  it('returns no findings when every relation name resolves in its locale', () => {
    const wb = workbook(
      [['Chicken meat', 'Hähnchenfleisch', 'iri:1']],
      [['Chicken meat', 'Hähnchenfleisch']],
    );
    expect(checkRelations(wb, descriptors)).toEqual([]);
  });

  it('flags an unknown name with sheet, row, field, value and the reference sheet', () => {
    const wb = workbook([['Chicken meat', 'Hähnchenfleisch', 'iri:1']], [['Mystery meat', null]]);
    const findings = checkRelations(wb, descriptors);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: 7,
      level: 'error',
      sheet: 'resistance',
      row: 2,
      field: 'matrix_en',
      value: 'Mystery meat',
    });
    expect(findings[0]!.message).toBe(
      "Sheet `resistance` row 2: `matrix_en = 'Mystery meat'` not found in matrix sheet",
    );
  });

  it('is locale-specific: a name present only in EN fails when referenced from the DE column', () => {
    const wb = workbook(
      [['Chicken meat', 'Hähnchenfleisch', 'iri:1']],
      [['Chicken meat', 'Chicken meat']], // DE references the EN-only name
    );
    const findings = checkRelations(wb, descriptors);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.field).toBe('matrix_de');
  });
});
