import { describe, it, expect } from 'vitest';
import { runPreflight } from '../src/core/preflight.js';
import { normalizeFacts, normalizeReferences } from '../src/core/normalizer.js';
import { syncImport } from '../src/core/orchestrator.js';
import type { BulkRow } from '../src/core/domain.js';
import type { BulkCreateResult, StrapiClient, TruncateResult } from '../src/core/strapi-client.js';
import { MASTERDATA, AMR, PREV, MULTIRES, spec, workbookWith } from './fixtures/valid-3sheet.js';

/** Records what each bulk-create was sent; like the server, returns no `id_de` for an EN-only row. */
class RecordingStrapi implements StrapiClient {
  sent = new Map<string, BulkRow[]>();
  private nextId = 1;

  async truncate(): Promise<TruncateResult> {
    return { en: 0, de: 0 };
  }

  async bulkCreate(collection: string, rows: BulkRow[]): Promise<BulkCreateResult[]> {
    this.sent.set(collection, rows);
    return rows.map((row, rowIndex) => ({
      rowIndex,
      documentId: `${collection}-${rowIndex}`,
      id_en: this.nextId++,
      ...(row.de ? { id_de: this.nextId++ } : {}),
    }));
  }

  fetchSchema(): Promise<never> {
    throw new Error('not used');
  }
}

describe('multires sheet → multi-resistance (ADR 0008)', () => {
  it('passes a valid 4-sheet workbook and counts its multi-resistance rows', async () => {
    const report = await runPreflight(
      workbookWith(spec(MASTERDATA), spec(AMR), spec(PREV), spec(MULTIRES)),
    );

    expect(report.errors).toEqual([]);
    expect(report.summary.rowsByCollection['multi-resistance']).toBe(1);
  });

  it('#2 — a workbook without the multires sheet fails pre-flight', async () => {
    const report = await runPreflight(workbookWith(spec(MASTERDATA), spec(AMR), spec(PREV)));

    expect(report.ok).toBe(false);
    expect(report.errors.some((f) => f.check === 2 && f.sheet === 'multires')).toBe(true);
  });

  // One code scale for both steward schemes: most microorganisms stop at "> 4 x",
  // MRSA continues 5 x … 8 x, "> 8 x". Codes 0–5 are the 6-group scheme.
  it.each([
    ['sensibel', 'sensibel', 0],
    ['1 x resistent', '1 x resistant', 1],
    ['4 x resistent', '4 x resistant', 4],
    ['> 4 x resistent', '> 4 x resistant', 5],
    ['5 x resistent', '5 x resistant', 6],
    ['8 x resistent', '8 x resistant', 9],
    ['> 8 x resistent', '> 8 x resistant', 10],
  ])('maps group label %s / %s to resistanceGroup %i', (de, en, code) => {
    const wb = workbookWith(
      spec(MULTIRES, [{ ...MULTIRES.row, multires_group_de: de, multires_group_en: en }]),
    );
    const row = normalizeFacts(wb).find((c) => c.collection === 'multi-resistance')?.rows[0];

    expect(row?.scalars.en.resistanceGroup).toBe(code);
    expect(row?.scalars.de.resistanceGroup).toBe(code);
  });

  it('#4 — an unknown group label is an error naming the raw column and value', async () => {
    const report = await runPreflight(
      workbookWith(
        spec(MASTERDATA),
        spec(AMR),
        spec(PREV),
        spec(MULTIRES, [{ ...MULTIRES.row, multires_group_en: '9 x resistant' }]),
      ),
    );

    expect(report.errors).toContainEqual(
      expect.objectContaining({
        check: 4,
        sheet: 'multires',
        row: 2,
        field: 'multires_group_en',
        value: '9 x resistant',
      }),
    );
  });

  it.each(['string_dbid', 'Jahr', 'multires_group_en', 'no_res_isolates', 'total_isol'])(
    '#5 — an empty %s is a required-field error',
    async (column) => {
      const report = await runPreflight(
        workbookWith(
          spec(MASTERDATA),
          spec(AMR),
          spec(PREV),
          spec(MULTIRES, [{ ...MULTIRES.row, [column]: '-' }]),
        ),
      );

      expect(report.errors).toContainEqual(
        expect.objectContaining({ check: 5, sheet: 'multires', row: 2, field: column }),
      );
    },
  );

  it('#6 — dbId is not unique here: two Combinations may share a string_dbid', async () => {
    const otherStage = {
      ...MULTIRES.row,
      Probenahmestelle: 'Schlachthof',
      'Sampling stage': 'Slaughterhouse',
    };
    const report = await runPreflight(
      workbookWith(
        spec(MASTERDATA, [
          MASTERDATA.row,
          { Probenahmestelle: 'Schlachthof', Sampling_stage: 'Slaughterhouse' },
        ]),
        spec(AMR),
        spec(PREV),
        spec(MULTIRES, [MULTIRES.row, otherStage]),
      ),
    );

    expect(report.errors).toEqual([]);
  });

  it('links the non-localized matrix detail by the same id in both locale payloads', async () => {
    const wb = workbookWith(
      spec(MASTERDATA),
      spec(AMR, [{ ...AMR.row, Matrixdetail: '-', Matrix_detail_en: '-' }]),
      spec(PREV, [{ ...PREV.row, Matrixdetail: '-', Matrix_detail_en: '-' }]),
      spec(MULTIRES, [{ ...MULTIRES.row, Matrixdetail: 'tiefgekühlt' }]),
    );
    const client = new RecordingStrapi();

    await syncImport(client, normalizeReferences(wb), normalizeFacts(wb));

    const detailRows = client.sent.get('matrix-detail') ?? [];
    expect(detailRows.map((r) => r.en.name)).toEqual(['tiefgekühlt']);
    const [row] = client.sent.get('multi-resistance') ?? [];
    expect(row?.en.matrixDetail).toEqual(expect.any(Number));
    expect(row?.de?.matrixDetail).toBe(row?.en.matrixDetail);
  });

  it('#6 — a second row for the same Combination × year × group is a duplicate', async () => {
    const report = await runPreflight(
      workbookWith(
        spec(MASTERDATA),
        spec(AMR),
        spec(PREV),
        spec(MULTIRES, [
          MULTIRES.row,
          { ...MULTIRES.row, 'ZoMo-Programm': 'EH3', string_dbid: 'x' },
        ]),
      ),
    );

    expect(report.errors).toContainEqual(
      expect.objectContaining({ check: 6, sheet: 'multires', row: 3 }),
    );
  });

  it('#6 — the same Combination and group in another year or microorganism is fine', async () => {
    const report = await runPreflight(
      workbookWith(
        spec(MASTERDATA, [
          MASTERDATA.row,
          { Mikroorganismus: 'Salmonella spp.', Microorganism: 'Salmonella spp.' },
        ]),
        spec(AMR),
        spec(PREV),
        spec(MULTIRES, [
          MULTIRES.row,
          { ...MULTIRES.row, Jahr: 2023 },
          { ...MULTIRES.row, Mikroorganismus: 'Salmonella spp.', Microorganism: 'Salmonella spp.' },
        ]),
      ),
    );

    expect(report.errors).toEqual([]);
  });

  it('#6 — rows of one Combination × year that disagree on total_isol are an error', async () => {
    const oneResistant = {
      ...MULTIRES.row,
      multires_group_de: '1 x resistent',
      multires_group_en: '1 x resistant',
      total_isol: 12,
    };
    const report = await runPreflight(
      workbookWith(
        spec(MASTERDATA),
        spec(AMR),
        spec(PREV),
        spec(MULTIRES, [MULTIRES.row, oneResistant]),
      ),
    );

    expect(report.errors).toContainEqual(
      expect.objectContaining({
        check: 6,
        sheet: 'multires',
        row: 3,
        field: 'total_isol',
        value: '12',
      }),
    );
  });
});
