import { describe, it, expect } from 'vitest';
import type { SheetSpec } from './fixtures/in-memory-workbook.js';
import type { LiveSchema } from '../src/core/strapi-client.js';
import { runPreflight } from '../src/core/preflight.js';
import {
  MASTERDATA,
  AMR,
  PREV,
  spec,
  workbookWith,
  validWorkbook,
} from './fixtures/valid-3sheet.js';

describe('runPreflight — 3-sheet contract', () => {
  it('passes a valid workbook: no errors, twelve collections, parsed-row summary', async () => {
    const report = await runPreflight(validWorkbook());

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.summary.collections).toBe(12);
    expect(report.summary.rowsByCollection.resistance).toBe(1);
    expect(report.summary.totalRows).toBeGreaterThan(0);
  });

  it('#2 — reports a missing source sheet by its raw name', async () => {
    const report = await runPreflight(workbookWith(spec(MASTERDATA), spec(PREV)));

    expect(report.ok).toBe(false);
    expect(report.errors.some((f) => f.check === 2 && f.sheet === 'amr_resrate')).toBe(true);
  });

  it('#3 — reports a missing raw column naming the steward’s own column', async () => {
    const columns = AMR.columns.filter((c) => c !== 'Anzahl getesteter Isolate');
    const broken: SheetSpec = {
      name: 'amr_resrate',
      columns,
      rows: [columns.map((c) => AMR.row[c] ?? null)],
    };
    const report = await runPreflight(workbookWith(spec(MASTERDATA), broken, spec(PREV)));

    expect(
      report.errors.some(
        (f) =>
          f.check === 3 && f.sheet === 'amr_resrate' && f.field === 'Anzahl getesteter Isolate',
      ),
    ).toBe(true);
  });

  it('#4 — reports a non-numeric value in a numeric source column', async () => {
    const report = await runPreflight(
      workbookWith(
        spec(MASTERDATA),
        spec(AMR, [{ ...AMR.row, 'Resistenzrate (%)': 'not-a-number' }]),
        spec(PREV),
      ),
    );

    expect(
      report.errors.some(
        (f) => f.check === 4 && f.sheet === 'amr_resrate' && f.field === 'Resistenzrate (%)',
      ),
    ).toBe(true);
  });

  it('#5 — reports an empty required field naming the raw column', async () => {
    const report = await runPreflight(
      workbookWith(spec(MASTERDATA), spec(AMR, [{ ...AMR.row, string_dbid: '-' }]), spec(PREV)),
    );

    expect(
      report.errors.some(
        (f) => f.check === 5 && f.sheet === 'amr_resrate' && f.field === 'string_dbid',
      ),
    ).toBe(true);
  });

  it('#6 — reports a duplicate dbId across resistance rows', async () => {
    const report = await runPreflight(
      workbookWith(spec(MASTERDATA), spec(AMR, [AMR.row, { ...AMR.row }]), spec(PREV)),
    );

    expect(
      report.errors.some(
        (f) => f.check === 6 && f.sheet === 'amr_resrate' && f.field === 'string_dbid',
      ),
    ).toBe(true);
  });

  it('#7 — reports a fact relation name absent from masterdata', async () => {
    const report = await runPreflight(
      workbookWith(
        spec(MASTERDATA),
        spec(AMR, [{ ...AMR.row, Matrix_new: 'Mystery meat', Matrix_neu: 'Phantomhaut' }]),
        spec(PREV),
      ),
    );

    expect(
      report.errors.some(
        (f) => f.check === 7 && f.sheet === 'amr_resrate' && f.value === 'Mystery meat',
      ),
    ).toBe(true);
  });

  it('#8 (references) — a masterdata pair with one locale blank is an error', async () => {
    const report = await runPreflight(
      workbookWith(
        spec(MASTERDATA, [{ ...MASTERDATA.row, Matrix_DE: '-' }]),
        spec(AMR),
        spec(PREV),
      ),
    );

    expect(
      report.errors.some(
        (f) => f.check === 8 && f.sheet === 'masterdata' && f.field === 'Matrix_DE',
      ),
    ).toBe(true);
  });

  it('#8 (facts) — a fact relation with EN set but DE blank is an error', async () => {
    const report = await runPreflight(
      workbookWith(spec(MASTERDATA), spec(AMR, [{ ...AMR.row, Matrix_neu: '-' }]), spec(PREV)),
    );

    expect(
      report.errors.some(
        (f) => f.check === 8 && f.sheet === 'amr_resrate' && f.field === 'Matrix_neu',
      ),
    ).toBe(true);
  });

  it('#10 — reports schema drift for a new required field the importer does not provide', async () => {
    const report = await runPreflight(validWorkbook(), {
      fetchSchema: async (collection): Promise<LiveSchema> => ({
        attributes:
          collection === 'resistance'
            ? { brandNewField: { type: 'string', required: true, localized: false } }
            : {},
      }),
    });

    expect(report.errors.some((f) => f.check === 10 && f.field === 'brandNewField')).toBe(true);
  });

  it('accumulates findings from multiple checks in a single pass', async () => {
    const broken = spec(AMR, [
      {
        ...AMR.row,
        string_dbid: '-',
        'Resistenzrate (%)': 'x',
        Matrix_new: 'Nope',
        Matrix_neu: 'Nada',
      },
    ]);
    const report = await runPreflight(workbookWith(spec(MASTERDATA), broken, spec(PREV)));

    expect(report.ok).toBe(false);
    const checks = new Set(report.errors.map((f) => f.check));
    for (const expected of [4, 5, 7]) {
      expect(checks.has(expected), `expected a finding from check #${expected}`).toBe(true);
    }
  });
});
