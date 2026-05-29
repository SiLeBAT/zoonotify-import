import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWorkbook } from './fixtures/make-workbook.js';
import { parseReferenceSheet } from '../src/core/parser.js';
import { referenceSpec } from '../src/core/reference-collections.js';
import { MissingColumnError, SheetNotFoundError } from '../src/core/errors.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zni-refparse-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseReferenceSheet — name-only collections', () => {
  it('parses paired EN/DE name rows for a name-only collection (specie)', async () => {
    const path = join(dir, 'specie.xlsx');
    await writeWorkbook(path, [
      {
        name: 'specie',
        columns: ['name_en', 'name_de'],
        rows: [
          ['Gallus gallus', 'Haushuhn'],
          ['Sus scrofa', 'Hausschwein'],
        ],
      },
    ]);

    const rows = await parseReferenceSheet(path, referenceSpec('specie'));

    expect(rows).toEqual([
      { en: { name: 'Gallus gallus' }, de: { name: 'Haushuhn' } },
      { en: { name: 'Sus scrofa' }, de: { name: 'Hausschwein' } },
    ]);
  });
});

describe('parseReferenceSheet — paired-iri collections', () => {
  it('splits paired iri_en/iri_de across the two locale payloads (matrix-group)', async () => {
    const path = join(dir, 'matrix-group.xlsx');
    await writeWorkbook(path, [
      {
        name: 'matrix-group',
        columns: ['name_en', 'name_de', 'iri_en', 'iri_de'],
        rows: [['Poultry', 'Geflügel', 'http://iri/poultry', 'http://iri/gefluegel']],
      },
    ]);

    const rows = await parseReferenceSheet(path, referenceSpec('matrix-group'));

    expect(rows).toEqual([
      {
        en: { name: 'Poultry', iri: 'http://iri/poultry' },
        de: { name: 'Geflügel', iri: 'http://iri/gefluegel' },
      },
    ]);
  });
});

describe('parseReferenceSheet — matrix (single non-localized iri)', () => {
  it('puts the single iri column on the en payload only; name stays paired', async () => {
    const path = join(dir, 'matrix.xlsx');
    await writeWorkbook(path, [
      {
        name: 'matrix',
        columns: ['name_en', 'name_de', 'iri'],
        rows: [['Chicken meat', 'Hähnchenfleisch', 'http://iri/matrix/chicken']],
      },
    ]);

    const rows = await parseReferenceSheet(path, referenceSpec('matrix'));

    expect(rows).toEqual([
      {
        en: { name: 'Chicken meat', iri: 'http://iri/matrix/chicken' },
        de: { name: 'Hähnchenfleisch' },
      },
    ]);
  });
});

describe('parseReferenceSheet — structural errors', () => {
  it('throws MissingColumnError naming a paired field column that is absent', async () => {
    const path = join(dir, 'mg-no-iride.xlsx');
    await writeWorkbook(path, [
      {
        name: 'matrix-group',
        columns: ['name_en', 'name_de', 'iri_en'], // iri_de missing
        rows: [['Poultry', 'Geflügel', 'http://iri/poultry']],
      },
    ]);

    const promise = parseReferenceSheet(path, referenceSpec('matrix-group'));
    await expect(promise).rejects.toBeInstanceOf(MissingColumnError);
    await expect(parseReferenceSheet(path, referenceSpec('matrix-group'))).rejects.toThrow(
      /iri_de/,
    );
  });

  it('throws SheetNotFoundError when the collection sheet is absent', async () => {
    const path = join(dir, 'wrong-sheet.xlsx');
    await writeWorkbook(path, [
      { name: 'specie', columns: ['name_en', 'name_de'], rows: [['Gallus gallus', 'Haushuhn']] },
    ]);

    await expect(parseReferenceSheet(path, referenceSpec('matrix'))).rejects.toBeInstanceOf(
      SheetNotFoundError,
    );
  });
});

describe('parseReferenceSheet — sentinel and locale handling', () => {
  it('treats sentinel values ("-", "_", "") as no value: skips DE half, omits empty iri', async () => {
    const path = join(dir, 'sentinels.xlsx');
    await writeWorkbook(path, [
      {
        name: 'matrix-group',
        columns: ['name_en', 'name_de', 'iri_en', 'iri_de'],
        rows: [
          ['Poultry', '-', 'http://iri/poultry', '_'], // DE name sentinel → no DE half
          ['Cattle', 'Rind', '', 'http://iri/rind'], // EN iri empty → omitted; DE present
        ],
      },
    ]);

    const rows = await parseReferenceSheet(path, referenceSpec('matrix-group'));

    expect(rows).toEqual([
      { en: { name: 'Poultry', iri: 'http://iri/poultry' } },
      { en: { name: 'Cattle' }, de: { name: 'Rind', iri: 'http://iri/rind' } },
    ]);
  });
});
