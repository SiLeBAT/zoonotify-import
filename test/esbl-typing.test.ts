import { describe, it, expect } from 'vitest';
import { normalizeFacts, normalizeReferences } from '../src/core/normalizer.js';
import { runPreflight } from '../src/core/preflight.js';
import {
  AMR,
  ESBL,
  MASTERDATA,
  MULTIRES,
  PREV,
  spec,
  TYPING,
  validWorkbook,
  workbookWith,
} from './fixtures/valid-3sheet.js';

/** The ESBL/AmpC-gene and typing sheets added to the source workbook (zn1934). */
describe('ESBL/AmpC genes and typing — reference collections', () => {
  const references = () =>
    new Map(normalizeReferences(workbookWith(spec(MASTERDATA))).map((c) => [c.collection, c.rows]));

  it('reads ESBL/AmpC gene names from their single masterdata column, EN only', () => {
    expect(references().get('esbl-ampc-gene')).toEqual([{ en: { name: 'CTX-M-1' } }]);
  });

  it('reads typing methods and typing subgroups as DE/EN pairs', () => {
    expect(references().get('typing')).toEqual([
      { en: { name: 'Salmonella serovars' }, de: { name: 'Salmonella Serovare' } },
    ]);
    expect(references().get('typing-subgroup')).toEqual([
      { en: { name: 'S. Typhimurium monophasic' }, de: { name: 'S. Typhimurium monophasisch' } },
    ]);
  });

  it('reads monitoring as a DE/EN pair', () => {
    expect(references().get('monitoring')).toEqual([
      { en: { name: 'selective' }, de: { name: 'selektiv' } },
    ]);
  });
});

describe('ESBL_AmpC_genes sheet → esbl-ampc-gene-result', () => {
  it('maps a row onto its scalars and relations', () => {
    const row = normalizeFacts(workbookWith(spec(ESBL))).find(
      (c) => c.collection === 'esbl-ampc-gene-result',
    )?.rows[0];

    expect(row?.scalars.en).toEqual({
      dbId: 'EH2_2024_Campylobacter_Broiler_CTX_M_1',
      zomoProgram: 'EH2',
      samplingYear: 2024,
      numberOfIsolates: 8,
      numberOfGenes: 9,
      numberOfIsolatesWithGene: 3,
      relativeGeneAbundance: 33.3,
      relativeGeneAbundanceCiMin: 12.1,
      relativeGeneAbundanceCiMax: 64.6,
      genePrevalence: 37.5,
      genePrevalenceCiMin: 13.5,
      genePrevalenceCiMax: 69.6,
      dataExtractionDate: '2025-05-23',
    });
    expect(row?.relations).toEqual(
      expect.arrayContaining([
        { attr: 'monitoring', collection: 'monitoring', en: 'selective', de: 'selektiv' },
        { attr: 'esblAmpcGene', collection: 'esbl-ampc-gene', en: 'CTX-M-1', shared: true },
        { attr: 'matrixDetail', collection: 'matrix-detail', en: 'gekühlt', shared: true },
        { attr: 'sampleType', collection: 'sample-type', en: 'Food', de: 'Lebensmittel' },
      ]),
    );
  });
});

describe('ESBL_AmpC_genes sheet — pre-flight', () => {
  it('passes a valid workbook and counts its ESBL/AmpC gene rows', async () => {
    const report = await runPreflight(validWorkbook());

    expect(report.errors).toEqual([]);
    expect(report.summary.rowsByCollection['esbl-ampc-gene-result']).toBe(1);
    expect(report.summary.rowsByCollection['esbl-ampc-gene']).toBe(1);
  });

  it('#2 — a workbook without the ESBL_AmpC_genes sheet fails pre-flight', async () => {
    const report = await runPreflight(
      workbookWith(spec(MASTERDATA), spec(AMR), spec(PREV), spec(MULTIRES)),
    );

    expect(report.errors).toContainEqual(
      expect.objectContaining({ check: 2, sheet: 'ESBL_AmpC_genes' }),
    );
  });
});

describe('ESBL_AmpC_genes sheet — uniqueness (#6)', () => {
  const preflightWith = (...rows: (typeof ESBL.row)[]) =>
    runPreflight(
      workbookWith(spec(MASTERDATA), spec(AMR), spec(PREV), spec(MULTIRES), spec(ESBL, rows)),
    );

  it('a second row for the same Combination × year × monitoring × gene is a duplicate', async () => {
    const report = await preflightWith(ESBL.row, { ...ESBL.row, string_dbid: 'other' });

    expect(report.errors).toContainEqual(
      expect.objectContaining({ check: 6, sheet: 'ESBL_AmpC_genes', row: 3 }),
    );
  });

  it('another gene of the same Combination must report the same total_no_isolates', async () => {
    const report = await preflightWith(ESBL.row, {
      ...ESBL.row,
      ESBL_AmpC_genes: 'SHV-12',
      string_dbid: 'other',
      total_no_isolates: 99,
    });

    expect(report.errors).toContainEqual(
      expect.objectContaining({ check: 6, sheet: 'ESBL_AmpC_genes', field: 'total_no_isolates' }),
    );
  });
});

describe('typing sheet → typing-result', () => {
  it('maps a row onto its scalars and relations', () => {
    const row = normalizeFacts(workbookWith(spec(TYPING))).find(
      (c) => c.collection === 'typing-result',
    )?.rows[0];

    expect(row?.scalars.en).toEqual({
      dbId: 'EH2_2024_Campylobacter_Broiler_S._Typhimurium_monophasic',
      zomoProgram: 'EH2',
      samplingYear: 2024,
      numberOfIsolates: 18,
      numberOfIsolatesInSubgroup: 4,
      subgroupPrevalence: 22.2,
      subgroupPrevalenceCiMin: 6.4,
      subgroupPrevalenceCiMax: 47.6,
      dataExtractionDate: '2025-05-23',
    });
    expect(row?.relations).toEqual(
      expect.arrayContaining([
        {
          attr: 'typing',
          collection: 'typing',
          en: 'Salmonella serovars',
          de: 'Salmonella Serovare',
        },
        {
          attr: 'typingSubgroup',
          collection: 'typing-subgroup',
          en: 'S. Typhimurium monophasic',
          de: 'S. Typhimurium monophasisch',
        },
      ]),
    );
  });
});

describe('typing sheet — uniqueness (#6)', () => {
  const preflightWith = (...rows: (typeof TYPING.row)[]) =>
    runPreflight(
      workbookWith(
        spec(MASTERDATA),
        spec(AMR),
        spec(PREV),
        spec(MULTIRES),
        spec(ESBL),
        spec(TYPING, rows),
      ),
    );

  it('a second row for the same Combination × year × typing × subgroup is a duplicate', async () => {
    const report = await preflightWith(TYPING.row, { ...TYPING.row, string_dbid: 'other' });

    expect(report.errors).toContainEqual(
      expect.objectContaining({ check: 6, sheet: 'typing', row: 3 }),
    );
  });

  it('another subgroup of the same typing must report the same total_no_isolates', async () => {
    const report = await preflightWith(TYPING.row, {
      ...TYPING.row,
      Typing_subgroup_DE: 'S. Infantis',
      Typing_subgroup_EN: 'S. Infantis',
      string_dbid: 'other',
      total_no_isolates: 99,
    });

    expect(report.errors).toContainEqual(
      expect.objectContaining({ check: 6, sheet: 'typing', field: 'total_no_isolates' }),
    );
  });
});

// The delivered sheet has 82 `STEC serotype` rows with no subgroup (and no
// string_dbid); they are a steward fix, not rows to import (zn1934).
describe('typing sheet — required subgroup (#5)', () => {
  it('a row without a typing subgroup is a required-field error', async () => {
    const report = await runPreflight(
      workbookWith(
        spec(MASTERDATA),
        spec(AMR),
        spec(PREV),
        spec(MULTIRES),
        spec(ESBL),
        spec(TYPING, [{ ...TYPING.row, Typing_subgroup_DE: '', Typing_subgroup_EN: '' }]),
      ),
    );

    expect(report.errors).toContainEqual(
      expect.objectContaining({ check: 5, sheet: 'typing', row: 2, field: 'Typing_subgroup_EN' }),
    );
  });
});

describe('matrix-detail harvest', () => {
  it('includes Matrixdetail values found only on the ESBL and typing sheets', () => {
    const wb = workbookWith(
      spec(ESBL, [{ ...ESBL.row, Matrixdetail: 'Sammelkot' }]),
      spec(TYPING, [{ ...TYPING.row, Matrixdetail: 'gekühlt, mit Haut' }]),
    );
    const names = normalizeReferences(wb)
      .find((c) => c.collection === 'matrix-detail')
      ?.rows.map((r) => r.en.name);

    expect(names).toEqual(['Sammelkot', 'gekühlt, mit Haut']);
  });
});
