import ExcelJS from 'exceljs';

/**
 * The expected post-import state for one reference collection, used both to
 * build the fixture workbook and to assert the DB state after the import.
 * `enCount` / `deCount` are the number of rows that should exist per locale
 * (a row with a sentinel/blank `name_de` contributes to `enCount` only).
 */
export interface ExpectedCollection {
  collection: string;
  /** Sheet header, row 1. */
  columns: string[];
  /** Data rows, in column order. */
  rows: (string | null)[][];
  enCount: number;
  deCount: number;
  /** A representative EN row to spot-check after import. */
  sample: { name: string; iri?: string };
}

/**
 * Fixture covering all 9 standard reference collections (#003). Each shape is
 * represented: name-only, paired-iri, and matrix's single non-localized iri.
 * One matrix-group row omits its DE half (sentinel) to exercise locale skipping.
 */
export const EXPECTED: ExpectedCollection[] = [
  {
    collection: 'microorganism',
    columns: ['name_en', 'name_de'],
    rows: [
      ['Salmonella spp.', 'Salmonella spp.'],
      ['Campylobacter jejuni', 'Campylobacter jejuni'],
    ],
    enCount: 2,
    deCount: 2,
    sample: { name: 'Salmonella spp.' },
  },
  {
    collection: 'specie',
    columns: ['name_en', 'name_de'],
    rows: [['Gallus gallus', 'Haushuhn']],
    enCount: 1,
    deCount: 1,
    sample: { name: 'Gallus gallus' },
  },
  {
    collection: 'antimicrobial-substance',
    columns: ['name_en', 'name_de'],
    rows: [['Ampicillin', 'Ampicillin']],
    enCount: 1,
    deCount: 1,
    sample: { name: 'Ampicillin' },
  },
  {
    collection: 'matrix',
    columns: ['name_en', 'name_de', 'iri'],
    rows: [['Chicken meat', 'Hähnchenfleisch', 'http://iri/matrix/chicken']],
    enCount: 1,
    deCount: 1,
    sample: { name: 'Chicken meat', iri: 'http://iri/matrix/chicken' },
  },
  {
    collection: 'matrix-group',
    columns: ['name_en', 'name_de', 'iri_en', 'iri_de'],
    rows: [
      ['Poultry', 'Geflügel', 'http://iri/mg/poultry', 'http://iri/mg/gefluegel'],
      ['Cattle', '-', 'http://iri/mg/cattle', '-'], // DE omitted via sentinel
    ],
    enCount: 2,
    deCount: 1,
    sample: { name: 'Poultry', iri: 'http://iri/mg/poultry' },
  },
  {
    collection: 'sample-type',
    columns: ['name_en', 'name_de', 'iri_en', 'iri_de'],
    rows: [['Caecal content', 'Blinddarminhalt', 'http://iri/st/caecal', 'http://iri/st/blind']],
    enCount: 1,
    deCount: 1,
    sample: { name: 'Caecal content', iri: 'http://iri/st/caecal' },
  },
  {
    collection: 'sample-origin',
    columns: ['name_en', 'name_de', 'iri_en', 'iri_de'],
    rows: [['Farm', 'Bauernhof', 'http://iri/so/farm', 'http://iri/so/hof']],
    enCount: 1,
    deCount: 1,
    sample: { name: 'Farm', iri: 'http://iri/so/farm' },
  },
  {
    collection: 'super-category-sample-origin',
    columns: ['name_en', 'name_de', 'iri_en', 'iri_de'],
    rows: [['Animal', 'Tier', 'http://iri/scso/animal', 'http://iri/scso/tier']],
    enCount: 1,
    deCount: 1,
    sample: { name: 'Animal', iri: 'http://iri/scso/animal' },
  },
  {
    collection: 'sampling-stage',
    columns: ['name_en', 'name_de', 'iri_en', 'iri_de'],
    rows: [['Slaughterhouse', 'Schlachthof', 'http://iri/ss/slaughter', 'http://iri/ss/schlacht']],
    enCount: 1,
    deCount: 1,
    sample: { name: 'Slaughterhouse', iri: 'http://iri/ss/slaughter' },
  },
];

/** Writes the fixture workbook (one sheet per collection) to `filePath`. */
export async function writeFixtureWorkbook(filePath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  for (const spec of EXPECTED) {
    const sheet = workbook.addWorksheet(spec.collection);
    sheet.addRow(spec.columns);
    for (const row of spec.rows) {
      sheet.addRow(row);
    }
  }
  await workbook.xlsx.writeFile(filePath);
}
