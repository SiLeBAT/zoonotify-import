import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWorkbook } from './fixtures/make-workbook.js';
import { parseMicroorganismSheet } from '../src/core/parser.js';
import { MissingColumnError, SheetNotFoundError } from '../src/core/errors.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zni-parser-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseMicroorganismSheet', () => {
  it('parses paired EN/DE rows from the microorganism sheet', async () => {
    const path = join(dir, 'ok.xlsx');
    await writeWorkbook(path, [
      {
        name: 'microorganism',
        columns: ['name_en', 'name_de'],
        rows: [
          ['Salmonella spp.', 'Salmonella spp.'],
          ['Campylobacter jejuni', 'Campylobacter jejuni'],
        ],
      },
    ]);

    const rows = await parseMicroorganismSheet(path);

    expect(rows).toEqual([
      { en: { name: 'Salmonella spp.' }, de: { name: 'Salmonella spp.' } },
      { en: { name: 'Campylobacter jejuni' }, de: { name: 'Campylobacter jejuni' } },
    ]);
  });

  it('throws MissingColumnError naming the absent required column', async () => {
    const path = join(dir, 'no-de.xlsx');
    await writeWorkbook(path, [
      {
        name: 'microorganism',
        columns: ['name_en'],
        rows: [['Salmonella spp.']],
      },
    ]);

    await expect(parseMicroorganismSheet(path)).rejects.toBeInstanceOf(MissingColumnError);
    await expect(parseMicroorganismSheet(path)).rejects.toThrow(/name_de/);
  });

  it('throws SheetNotFoundError when the microorganism sheet is absent', async () => {
    const path = join(dir, 'wrong-sheet.xlsx');
    await writeWorkbook(path, [
      { name: 'matrix', columns: ['name_en', 'name_de'], rows: [['Chicken meat', 'Hähnchen']] },
    ]);

    await expect(parseMicroorganismSheet(path)).rejects.toBeInstanceOf(SheetNotFoundError);
  });
});
