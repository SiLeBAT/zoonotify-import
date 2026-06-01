import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWorkbook } from './fixtures/in-memory-workbook.js';
import { EXPECTED, EXPECTED_FACTS } from './integration/fixture.js';
import { runPreflight } from '../src/core/preflight.js';
import { describeAllCollections, describeCollection } from '../src/core/descriptors.js';

/** Builds an in-memory workbook from the (valid) integration fixture data. */
function validWorkbook(): ExcelJS.Workbook {
  return buildWorkbook([
    ...EXPECTED.map((e) => ({ name: e.collection, columns: e.columns, rows: e.rows })),
    ...EXPECTED_FACTS.map((f) => ({ name: f.collection, columns: f.columns, rows: f.rows })),
  ]);
}

describe('runPreflight', () => {
  it('passes a valid workbook with no errors and a summary of parsed rows', async () => {
    const report = await runPreflight(validWorkbook(), describeAllCollections());

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.summary.collections).toBe(12);
    expect(report.summary.rowsByCollection.resistance).toBe(1);
    expect(report.summary.totalRows).toBeGreaterThan(0);
  });

  it('accumulates findings from every check in a single pass (never fails fast)', async () => {
    const resistanceColumns = describeCollection('resistance')
      .columns.map((c) => c.name)
      .filter((name) => name !== 'samplingYear'); // drop a required column → check #3

    const blankRow = resistanceColumns.map((name) => {
      if (name === 'matrix_en') return 'Mystery meat'; // unknown relation → check #7
      if (name === 'anzahlGetesteterIsolate') return 'not-a-number'; // bad type → check #4
      if (name === 'dbId') return '-'; // required empty → check #5
      return 'x';
    });

    const workbook = buildWorkbook([
      {
        name: 'matrix',
        columns: ['name_en', 'name_de', 'iri'],
        rows: [
          ['Chicken meat', 'Hähnchenfleisch', 'iri:1'],
          ['Chicken meat', 'Hähnchen2', 'iri:2'], // duplicate name_en → check #6
          ['Beef', '-', 'iri:3'], // DE missing → check #8 warning
        ],
      },
      { name: 'resistance', columns: resistanceColumns, rows: [blankRow] },
    ]);

    const report = await runPreflight(workbook, [
      describeCollection('matrix'),
      describeCollection('resistance'),
    ]);

    expect(report.ok).toBe(false);
    const checks = new Set([...report.errors, ...report.warnings].map((f) => f.check));
    for (const expected of [3, 4, 5, 6, 7, 8]) {
      expect(checks.has(expected), `expected a finding from check #${expected}`).toBe(true);
    }
    // check #8 missing-DE is a warning, not an error.
    expect(report.warnings.some((f) => f.check === 8)).toBe(true);
  });

  it('reports a missing sheet as a check-2 error and still validates the others', async () => {
    const workbook = buildWorkbook([{ name: 'matrix', columns: ['name_en', 'name_de', 'iri'] }]);
    const report = await runPreflight(workbook, [
      describeCollection('matrix'),
      describeCollection('resistance'),
    ]);

    expect(report.ok).toBe(false);
    expect(report.errors.some((f) => f.check === 2 && f.sheet === 'resistance')).toBe(true);
  });

  it('runs schema-drift (check #10) when a schema fetcher is supplied', async () => {
    const report = await runPreflight(validWorkbook(), [describeCollection('resistance')], {
      fetchSchema: async () => ({
        attributes: { brandNewField: { type: 'string', required: true, localized: false } },
      }),
    });

    expect(report.errors.some((f) => f.check === 10 && f.field === 'brandNewField')).toBe(true);
  });
});
