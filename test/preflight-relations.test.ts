import { describe, it, expect } from 'vitest';
import { buildReferenceNameIndex, checkRelationReferences } from '../src/core/preflight.js';
import type { CollectionImport } from '../src/core/orchestrator.js';
import type { FactImport } from '../src/core/fact-parser.js';
import type { ParsedFactRow } from '../src/core/domain.js';

const references: CollectionImport[] = [
  {
    collection: 'matrix',
    rows: [{ en: { name: 'Chicken meat' }, de: { name: 'Hähnchenfleisch' } }],
  },
  { collection: 'microorganism', rows: [{ en: { name: 'Salmonella spp.' } }] },
];

function factRow(relations: ParsedFactRow['relations'], rowNumber = 2): ParsedFactRow {
  return { rowNumber, hasDe: true, scalars: { en: {}, de: {} }, relations };
}

describe('checkRelationReferences (pre-flight check #7)', () => {
  it('returns no findings when every relation name resolves in its locale', () => {
    const index = buildReferenceNameIndex(references);
    const facts: FactImport[] = [
      {
        collection: 'resistance',
        rows: [
          factRow([
            { attr: 'matrix', collection: 'matrix', en: 'Chicken meat', de: 'Hähnchenfleisch' },
            { attr: 'microorganism', collection: 'microorganism', en: 'Salmonella spp.' },
          ]),
        ],
      },
    ];

    expect(checkRelationReferences(facts, index)).toEqual([]);
  });

  it('flags an unknown name with sheet, row, field, value and reference sheet', () => {
    const index = buildReferenceNameIndex(references);
    const facts: FactImport[] = [
      {
        collection: 'resistance',
        rows: [factRow([{ attr: 'matrix', collection: 'matrix', en: 'Mystery meat' }], 47)],
      },
    ];

    const findings = checkRelationReferences(facts, index);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      sheet: 'resistance',
      rowNumber: 47,
      field: 'matrix_en',
      value: 'Mystery meat',
      referenceSheet: 'matrix',
    });
    expect(findings[0]!.message).toBe(
      "Sheet `resistance` row 47: `matrix_en = 'Mystery meat'` not found in matrix sheet",
    );
  });

  it('is locale-specific: a name present in EN but not DE fails for the DE column', () => {
    const index = buildReferenceNameIndex(references);
    const facts: FactImport[] = [
      {
        collection: 'resistance',
        rows: [
          // 'Chicken meat' exists in EN, but DE only has 'Hähnchenfleisch'.
          factRow([
            { attr: 'matrix', collection: 'matrix', en: 'Chicken meat', de: 'Chicken meat' },
          ]),
        ],
      },
    ];

    const findings = checkRelationReferences(facts, index);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.field).toBe('matrix_de');
  });

  it('accumulates findings across rows and collections rather than failing fast', () => {
    const index = buildReferenceNameIndex(references);
    const facts: FactImport[] = [
      {
        collection: 'resistance',
        rows: [factRow([{ attr: 'matrix', collection: 'matrix', en: 'Bad A' }], 2)],
      },
      {
        collection: 'prevalence',
        rows: [factRow([{ attr: 'microorganism', collection: 'microorganism', en: 'Bad B' }], 3)],
      },
    ];

    const findings = checkRelationReferences(facts, index);
    expect(findings.map((f) => f.sheet)).toEqual(['resistance', 'prevalence']);
  });
});
