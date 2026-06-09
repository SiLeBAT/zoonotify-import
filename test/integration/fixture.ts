import ExcelJS from 'exceljs';
import { MASTERDATA, AMR, PREV, type Cells } from '../fixtures/valid-3sheet.js';

/**
 * Integration fixture for the 3-sheet contract (ADR 0007). The source workbook
 * has exactly three sheets — `masterdata`, `amr_resrate`, `prevalence` — and the
 * importer's normalizer derives the 12 Strapi collections from them. The
 * EXPECTED/EXPECTED_FACTS tables below describe the post-import DB state the
 * integration test asserts through the content-manager API.
 *
 * Under this contract every i18n row carries both locales (both mandatory, so
 * `enCount === deCount`), and `iri` is deprecated (no iri columns, none persisted).
 * `matrix-detail` is non-i18n and harvested from the fact sheets' `Matrixdetail`
 * column; a `?locale=de` query on a non-localized type returns the same rows, so
 * its `deCount` equals its `enCount`.
 */

export interface ExpectedCollection {
  collection: string;
  /** Rows expected per locale after import. */
  enCount: number;
  deCount: number;
}

export interface ExpectedFact {
  collection: string;
  enCount: number;
  deCount: number;
}

/** Per-column values of the `masterdata` sheet (column-parallel lists, §3). */
const MASTERDATA_VALUES: Record<string, string[]> = {
  Oberkategorie_Probenursprung: ['Tier'],
  Superordinate_sample_origin: ['Animal'],
  Probenursprung: ['Bauernhof'],
  Sample_origin: ['Farm'],
  Matrixgruppe: ['Geflügel', 'Rind'],
  Matrix_group: ['Poultry', 'Cattle'],
  Matrix_DE: ['Hähnchenfleisch', 'Rindfleisch'],
  Matrix_EN: ['Chicken meat', 'Beef'],
  Mikroorganismus: ['Salmonella spp.', 'Campylobacter jejuni'],
  Microorganism: ['Salmonella spp.', 'Campylobacter jejuni'],
  Probenahmestelle: ['Schlachthof'],
  Sampling_stage: ['Slaughterhouse'],
  Probentyp: ['Blinddarminhalt'],
  Sample_type: ['Caecal content'],
  Spezies: ['Haushuhn'],
  Species: ['Gallus gallus'],
  Antimiktobielle_Subtanz: ['Ampicillin'],
  Antimicrobial_substance: ['Ampicillin'],
};

/** One amr_resrate row whose every relation resolves against masterdata, both locales. */
const AMR_ROW: Cells = {
  'ZoMo-Programm': 'ZP 2024',
  Jahr: 2024,
  'Sampling year': 2024,
  Mikroorganismus: 'Salmonella spp.',
  Microorganism: 'Salmonella spp.',
  Spezies: 'Haushuhn',
  Species: 'Gallus gallus',
  Probentyp: 'Blinddarminhalt',
  'Sample type': 'Caecal content',
  'Oberkategorie Probenursprung (Tier/Lebensmittel/Futtermittel)': 'Tier',
  'Superordinate sample origin': 'Animal',
  'Probenursprung (Tier/Lebensmittel/Futtermittel)': 'Bauernhof',
  'Sample origin': 'Farm',
  Probenahmestelle: 'Schlachthof',
  'Sampling stage': 'Slaughterhouse',
  Matrixgruppe: 'Geflügel',
  'Matrix group': 'Poultry',
  Matrix_neu: 'Hähnchenfleisch',
  Matrix_new: 'Chicken meat',
  Matrixdetail: 'Breast meat',
  Matrix_detail_en: 'Breast meat',
  'Antimikrobielle Substanz': 'Ampicillin',
  'Antimicrobial substance': 'Ampicillin',
  'Anzahl getesteter Isolate': 100,
  'Anzahl resistenter Isolate': 5,
  'Resistenzrate (%)': 5,
  'Min. 95% Konfidenzintervall': 1.6,
  'Max. 95% Konfidenzintervall': 11.3,
  string_dbid: 'R-2024-001',
};

/** One prevalence row; its `Matrixdetail` differs from amr so matrix-detail unions to two. */
const PREV_ROW: Cells = {
  ID: 1,
  'ZoMo-Programm': 'ZP 2024',
  Jahr: 2024,
  Mikroorganismus: 'Salmonella spp.',
  Microorganism: 'Salmonella spp.',
  Probentyp: 'Blinddarminhalt',
  'Sample type': 'Caecal content',
  'Oberkategorie Probenursprung (Tier/Lebensmittel/Futtermittel)': 'Tier',
  'Superordinate sample origin': 'Animal',
  'Probenursprung (Tier/Lebensmittel/Futtermittel)': 'Bauernhof',
  'Sample origin': 'Farm',
  Probenahmestelle: 'Schlachthof',
  'Sampling stage': 'Slaughterhouse',
  Matrixgruppe: 'Geflügel',
  'Matrix group': 'Poultry',
  Matrix_neu: 'Hähnchenfleisch',
  Matrix_new: 'Chicken meat',
  Matrixdetail: 'Skin',
  Matrix_detail_en: 'Skin',
  'Weitere Details': 'note',
  Anzahl_Proben_N: 50,
  Positive_Proben_N: 3,
  prevalence: 6,
  min_95_KI: 1.2,
  max_95_KI: 16.5,
  Gruppe: 'g',
  Produktionsrichtung: 'pr',
};

/**
 * Expected reference state. masterdata supplies nine collections (distinct
 * column-pair values); `matrix-detail` is the union of `Matrixdetail` across the
 * two fact sheets — `Breast meat` + `Skin` → 2.
 */
export const EXPECTED: ExpectedCollection[] = [
  { collection: 'super-category-sample-origin', enCount: 1, deCount: 1 },
  { collection: 'sample-origin', enCount: 1, deCount: 1 },
  { collection: 'matrix-group', enCount: 2, deCount: 2 },
  { collection: 'matrix', enCount: 2, deCount: 2 },
  { collection: 'microorganism', enCount: 2, deCount: 2 },
  { collection: 'sampling-stage', enCount: 1, deCount: 1 },
  { collection: 'sample-type', enCount: 1, deCount: 1 },
  { collection: 'specie', enCount: 1, deCount: 1 },
  { collection: 'antimicrobial-substance', enCount: 1, deCount: 1 },
  { collection: 'matrix-detail', enCount: 2, deCount: 2 },
];

export const EXPECTED_FACTS: ExpectedFact[] = [
  { collection: 'resistance', enCount: 1, deCount: 1 },
  { collection: 'prevalence', enCount: 1, deCount: 1 },
];

/** Builds the masterdata sheet's data rows from the column-parallel value lists. */
function masterdataRows(): (string | null)[][] {
  const length = Math.max(...Object.values(MASTERDATA_VALUES).map((v) => v.length));
  const rows: (string | null)[][] = [];
  for (let i = 0; i < length; i++) {
    rows.push(MASTERDATA.columns.map((c) => MASTERDATA_VALUES[c]?.[i] ?? null));
  }
  return rows;
}

/** Maps a fact row record to a cell array in the sheet's column order. */
function factRow(columns: string[], record: Cells): (string | number | null)[] {
  return columns.map((c) => record[c] ?? null);
}

/** Writes the 3-sheet fixture workbook (`masterdata` + `amr_resrate` + `prevalence`). */
export async function writeFixtureWorkbook(filePath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();

  const masterdata = workbook.addWorksheet('masterdata');
  masterdata.addRow(MASTERDATA.columns);
  for (const row of masterdataRows()) {
    masterdata.addRow(row);
  }

  const amr = workbook.addWorksheet('amr_resrate');
  amr.addRow(AMR.columns);
  amr.addRow(factRow(AMR.columns, AMR_ROW));

  const prev = workbook.addWorksheet('prevalence');
  prev.addRow(PREV.columns);
  prev.addRow(factRow(PREV.columns, PREV_ROW));

  await workbook.xlsx.writeFile(filePath);
}
