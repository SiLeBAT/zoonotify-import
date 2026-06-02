import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWorkbook } from './fixtures/make-workbook.js';
import { parseFactSheet } from '../src/core/fact-parser.js';
import { factSpec } from '../src/core/fact-collections.js';
import { SheetNotFoundError, MissingColumnError } from '../src/core/errors.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zni-factparse-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const RESISTANCE_COLUMNS = [
  'dbId',
  'samplingYear',
  'zomoProgram_en',
  'zomoProgram_de',
  'matrix_en',
  'matrix_de',
  'matrixGroup_en',
  'matrixGroup_de',
  'microorganism_en',
  'microorganism_de',
  'specie_en',
  'specie_de',
  'sampleType_en',
  'sampleType_de',
  'sampleOrigin_en',
  'sampleOrigin_de',
  'superCategorySampleOrigin_en',
  'superCategorySampleOrigin_de',
  'samplingStage_en',
  'samplingStage_de',
  'antimicrobialSubstance_en',
  'antimicrobialSubstance_de',
  'anzahlGetesteterIsolate',
  'anzahlResistenterIsolate',
  'resistenzrate',
  'minKonfidenzintervall',
  'maxKonfidenzintervall',
];

function resistanceRow(
  overrides: Record<string, string | number> = {},
): (string | number | null)[] {
  const base: Record<string, string | number> = {
    dbId: 'R-2024-001',
    samplingYear: 2024,
    zomoProgram_en: 'ZP 2024',
    zomoProgram_de: 'ZP 2024',
    matrix_en: 'Chicken meat',
    matrix_de: 'Hähnchenfleisch',
    matrixGroup_en: 'Poultry',
    matrixGroup_de: 'Geflügel',
    microorganism_en: 'Salmonella spp.',
    microorganism_de: 'Salmonella spp.',
    specie_en: 'Gallus gallus',
    specie_de: 'Haushuhn',
    sampleType_en: 'Caecal content',
    sampleType_de: 'Blinddarminhalt',
    sampleOrigin_en: 'Farm',
    sampleOrigin_de: 'Bauernhof',
    superCategorySampleOrigin_en: 'Animal',
    superCategorySampleOrigin_de: 'Tier',
    samplingStage_en: 'Slaughterhouse',
    samplingStage_de: 'Schlachthof',
    antimicrobialSubstance_en: 'Ampicillin',
    antimicrobialSubstance_de: 'Ampicillin',
    anzahlGetesteterIsolate: 100,
    anzahlResistenterIsolate: 5,
    resistenzrate: 5.0,
    minKonfidenzintervall: 1.6,
    maxKonfidenzintervall: 11.3,
    ...overrides,
  };
  return RESISTANCE_COLUMNS.map((c) => base[c] ?? null);
}

describe('parseFactSheet — resistance happy path', () => {
  it('parses scalars and relation references with a 1-based worksheet row number', async () => {
    const path = join(dir, 'resistance-ok.xlsx');
    await writeWorkbook(path, [
      { name: 'resistance', columns: RESISTANCE_COLUMNS, rows: [resistanceRow()] },
    ]);

    const rows = await parseFactSheet(path, factSpec('resistance'));

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.rowNumber).toBe(2); // header is row 1
    expect(row.hasDe).toBe(true);

    // Single scalars shared into both locales; paired scalar split by suffix.
    expect(row.scalars.en).toMatchObject({
      dbId: 'R-2024-001',
      samplingYear: 2024,
      zomoProgram: 'ZP 2024',
      anzahlGetesteterIsolate: 100,
      resistenzrate: 5,
    });
    expect(row.scalars.de).toMatchObject({ dbId: 'R-2024-001', samplingYear: 2024 });

    // Relations carried by name+locale, not yet resolved.
    const matrix = row.relations.find((r) => r.attr === 'matrix');
    expect(matrix).toEqual({
      attr: 'matrix',
      collection: 'matrix',
      en: 'Chicken meat',
      de: 'Hähnchenfleisch',
    });
  });
});

describe('parseFactSheet — numeric coercion', () => {
  it('coerces integers and floats, accepting a comma decimal separator', async () => {
    const path = join(dir, 'resistance-comma.xlsx');
    await writeWorkbook(path, [
      {
        name: 'resistance',
        columns: RESISTANCE_COLUMNS,
        rows: [resistanceRow({ resistenzrate: '5,5', anzahlGetesteterIsolate: '100' })],
      },
    ]);

    const row = (await parseFactSheet(path, factSpec('resistance')))[0]!;

    expect(row.scalars.en.resistenzrate).toBe(5.5);
    expect(row.scalars.en.anzahlGetesteterIsolate).toBe(100);
  });
});

describe('parseFactSheet — DE-half detection and sentinels', () => {
  it('marks hasDe=false and omits DE relation names when every _de column is a sentinel', async () => {
    const path = join(dir, 'resistance-no-de.xlsx');
    const overrides: Record<string, string | number> = {};
    for (const c of RESISTANCE_COLUMNS) if (c.endsWith('_de')) overrides[c] = '-';
    await writeWorkbook(path, [
      { name: 'resistance', columns: RESISTANCE_COLUMNS, rows: [resistanceRow(overrides)] },
    ]);

    const row = (await parseFactSheet(path, factSpec('resistance')))[0]!;

    expect(row.hasDe).toBe(false);
    expect(row.relations.find((r) => r.attr === 'matrix')).toEqual({
      attr: 'matrix',
      collection: 'matrix',
      en: 'Chicken meat',
    });
  });

  it('omits an optional relation entirely when both locale cells are empty', async () => {
    const path = join(dir, 'resistance-no-specie.xlsx');
    await writeWorkbook(path, [
      {
        name: 'resistance',
        columns: RESISTANCE_COLUMNS,
        rows: [resistanceRow({ specie_en: '-', specie_de: '-' })],
      },
    ]);

    const row = (await parseFactSheet(path, factSpec('resistance')))[0]!;
    const specie = row.relations.find((r) => r.attr === 'specie');
    expect(specie).toEqual({ attr: 'specie', collection: 'specie' });
  });
});

describe('parseFactSheet — prevalence ignored columns', () => {
  it('silently drops matrixDetail_*/sampleType_* columns and reports they were present', async () => {
    const path = join(dir, 'prevalence-ignored.xlsx');
    const columns = [
      'samplingYear',
      'zomoProgram_en',
      'zomoProgram_de',
      'matrix_en',
      'matrix_de',
      'matrixGroup_en',
      'matrixGroup_de',
      'microorganism_en',
      'microorganism_de',
      'sampleOrigin_en',
      'sampleOrigin_de',
      'superCategorySampleOrigin_en',
      'superCategorySampleOrigin_de',
      'samplingStage_en',
      'samplingStage_de',
      'numberOfSamples',
      'numberOfPositive',
      'percentageOfPositive',
      'ciMin',
      'ciMax',
      'matrixDetail_en',
      'matrixDetail_de',
      'sampleType_en',
      'sampleType_de',
    ];
    const row = columns.map((c) => {
      if (c === 'samplingYear') return 2024;
      if (['numberOfSamples', 'numberOfPositive'].includes(c)) return 10;
      if (['percentageOfPositive', 'ciMin', 'ciMax'].includes(c)) return 1.0;
      return 'x';
    });
    await writeWorkbook(path, [{ name: 'prevalence', columns, rows: [row] }]);

    const { rows, droppedColumns } = await parseFactSheet(path, factSpec('prevalence'), {
      reportDropped: true,
    });

    expect(rows[0]!.relations.find((r) => r.attr === 'matrixDetail')).toBeUndefined();
    expect(rows[0]!.scalars.en.matrixDetail_en).toBeUndefined();
    expect(droppedColumns.sort()).toEqual([
      'matrixDetail_de',
      'matrixDetail_en',
      'sampleType_de',
      'sampleType_en',
    ]);
  });
});

describe('parseFactSheet — structural errors', () => {
  it('throws SheetNotFoundError when the fact sheet is absent', async () => {
    const path = join(dir, 'no-sheet.xlsx');
    await writeWorkbook(path, [{ name: 'specie', columns: ['name_en'], rows: [['x']] }]);
    await expect(parseFactSheet(path, factSpec('resistance'))).rejects.toBeInstanceOf(
      SheetNotFoundError,
    );
  });

  it('throws MissingColumnError naming a required relation column that is absent', async () => {
    const path = join(dir, 'missing-col.xlsx');
    const columns = RESISTANCE_COLUMNS.filter((c) => c !== 'matrix_de');
    await writeWorkbook(path, [{ name: 'resistance', columns, rows: [] }]);
    await expect(parseFactSheet(path, factSpec('resistance'))).rejects.toBeInstanceOf(
      MissingColumnError,
    );
    await expect(parseFactSheet(path, factSpec('resistance'))).rejects.toThrow(/matrix_de/);
  });
});
