import { describe, it, expect } from 'vitest';
import { buildWorkbook } from './fixtures/in-memory-workbook.js';
import { checkSchemaDrift } from '../src/core/preflight-checks.js';
import { describeCollection } from '../src/core/descriptors.js';
import type { LiveSchema } from '../src/core/strapi-client.js';

const resistance = describeCollection('resistance');

function sheet(columns: string[]) {
  return buildWorkbook([{ name: 'resistance', columns }]).getWorksheet('resistance')!;
}

const baseSchema: LiveSchema = {
  attributes: {
    dbId: { type: 'string', required: true, localized: true },
    samplingYear: { type: 'integer', required: true, localized: false },
  },
};

describe('checkSchemaDrift (check #10)', () => {
  it('passes when every required live-schema field has a matching workbook column', () => {
    const ws = sheet(['dbId', 'samplingYear']);
    expect(checkSchemaDrift(ws, resistance, baseSchema)).toEqual([]);
  });

  it('flags a required NON-localized field added to the live schema but missing from the workbook', () => {
    const drifted: LiveSchema = {
      attributes: {
        ...baseSchema.attributes,
        newMandatory: { type: 'string', required: true, localized: false },
      },
    };
    const ws = sheet(['dbId', 'samplingYear']);

    const findings = checkSchemaDrift(ws, resistance, drifted);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: 10,
      level: 'error',
      sheet: 'resistance',
      field: 'newMandatory',
    });
    expect(findings[0]!.message).toMatch(/schema/i);
  });

  it('expects the EN base column for a required localized field', () => {
    const drifted: LiveSchema = {
      attributes: {
        ...baseSchema.attributes,
        note: { type: 'string', required: true, localized: true },
      },
    };
    // note_en is absent → drift.
    expect(checkSchemaDrift(sheet(['dbId', 'samplingYear']), resistance, drifted)).toHaveLength(1);
    // note_en present → satisfied.
    expect(
      checkSchemaDrift(sheet(['dbId', 'samplingYear', 'note_en']), resistance, drifted),
    ).toEqual([]);
  });

  it('does not false-positive on matrix: localized name + non-localized iri match the live schema', () => {
    const matrix = describeCollection('matrix');
    // Live matrix schema as it actually is: name is i18n, iri is a plain string.
    const live: LiveSchema = {
      attributes: {
        name: { type: 'string', required: true, localized: true },
        iri: { type: 'string', required: false, localized: false },
      },
    };
    const ws = buildWorkbook([
      { name: 'matrix', columns: ['name_en', 'name_de', 'iri'] },
    ]).getWorksheet('matrix')!;
    expect(checkSchemaDrift(ws, matrix, live)).toEqual([]);
  });

  it('does not false-positive on matrix-detail: non-i18n name/iri match the live schema', () => {
    const detail = describeCollection('matrix-detail');
    const live: LiveSchema = {
      attributes: {
        name: { type: 'string', required: true, localized: false },
        iri: { type: 'string', required: false, localized: false },
      },
    };
    const ws = buildWorkbook([{ name: 'matrix-detail', columns: ['name', 'iri'] }]).getWorksheet(
      'matrix-detail',
    )!;
    expect(checkSchemaDrift(ws, detail, live)).toEqual([]);
  });

  it('does not flag optional live-schema fields that are absent from the workbook', () => {
    const withOptional: LiveSchema = {
      attributes: {
        ...baseSchema.attributes,
        optionalThing: { type: 'string', required: false, localized: false },
      },
    };
    expect(checkSchemaDrift(sheet(['dbId', 'samplingYear']), resistance, withOptional)).toEqual([]);
  });
});
