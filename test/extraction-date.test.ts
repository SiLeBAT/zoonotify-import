import { describe, it, expect } from 'vitest';
import { normalizeFacts } from '../src/core/normalizer.js';
import { runPreflight } from '../src/core/preflight.js';
import { AMR, MASTERDATA, MULTIRES, PREV, spec, workbookWith } from './fixtures/valid-3sheet.js';

/** `Datum der Datenextraktion`: when the steward extracted a row's data (zn1934). */
describe('data extraction date', () => {
  it('reads an ISO date text cell into dataExtractionDate on both locales', () => {
    const wb = workbookWith(spec(AMR, [{ ...AMR.row, 'Datum der Datenextraktion': '2025-05-23' }]));
    const row = normalizeFacts(wb).find((c) => c.collection === 'resistance')?.rows[0];

    expect(row?.scalars.en.dataExtractionDate).toBe('2025-05-23');
    expect(row?.scalars.de.dataExtractionDate).toBe('2025-05-23');
  });

  // The `prevalence` sheet stores the same column as real Excel dates (UTC midnight).
  it('reads an Excel date cell as the same ISO date text', () => {
    const wb = workbookWith(
      spec(PREV, [{ ...PREV.row, 'Datum der Datenextraktion': new Date(Date.UTC(2020, 11, 3)) }]),
    );
    const row = normalizeFacts(wb).find((c) => c.collection === 'prevalence')?.rows[0];

    expect(row?.scalars.en.dataExtractionDate).toBe('2020-12-03');
  });
});

describe('data extraction date — pre-flight', () => {
  it('#4 — a value that is not an ISO date is an error naming the raw column', async () => {
    const report = await runPreflight(
      workbookWith(
        spec(MASTERDATA),
        spec(AMR, [{ ...AMR.row, 'Datum der Datenextraktion': '03.12.2020' }]),
        spec(PREV),
        spec(MULTIRES),
      ),
    );

    expect(report.errors).toContainEqual(
      expect.objectContaining({
        check: 4,
        sheet: 'amr_resrate',
        row: 2,
        field: 'Datum der Datenextraktion',
        value: '03.12.2020',
      }),
    );
  });

  it.each([
    ['amr_resrate', AMR],
    ['prevalence', PREV],
    ['multires', MULTIRES],
  ] as const)('#5 — an empty date on %s is a required-field error', async (sheet, def) => {
    const sheets = { amr_resrate: AMR, prevalence: PREV, multires: MULTIRES };
    const report = await runPreflight(
      workbookWith(
        spec(MASTERDATA),
        ...Object.values(sheets).map((d) =>
          d === def ? spec(d, [{ ...d.row, 'Datum der Datenextraktion': '' }]) : spec(d),
        ),
      ),
    );

    expect(report.errors).toContainEqual(
      expect.objectContaining({ check: 5, sheet, row: 2, field: 'Datum der Datenextraktion' }),
    );
  });
});
