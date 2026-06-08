import ExcelJS from 'exceljs';
import { buildWorkbook, type SheetSpec } from './in-memory-workbook.js';

/**
 * A consistent, valid 3-sheet dataset (ADR 0007): every fact relation name
 * resolves against masterdata in both locales, every required field is present,
 * all numeric cells are clean. Tests clone a SheetDef and break one thing to
 * drive one pre-flight check; the CLI tests use `validWorkbook()` as the file
 * `readWorkbook` returns so pre-flight passes.
 */
export type Cells = Record<string, string | number>;
export interface SheetDef {
  name: string;
  columns: string[];
  row: Cells;
}

export const MASTERDATA: SheetDef = {
  name: 'masterdata',
  columns: [
    'Oberkategorie_Probenursprung',
    'Superordinate_sample_origin',
    'Probenursprung',
    'Sample_origin',
    'Matrixgruppe',
    'Matrix_group',
    'Matrix_DE',
    'Matrix_EN',
    'Mikroorganismus',
    'Microorganism',
    'Probenahmestelle',
    'Sampling_stage',
    'Probentyp',
    'Sample_type',
    'Spezies',
    'Species',
    'Antimiktobielle_Subtanz',
    'Antimicrobial_substance',
  ],
  row: {
    Oberkategorie_Probenursprung: 'Huhn',
    Superordinate_sample_origin: 'Chicken',
    Probenursprung: 'Masthähnchen',
    Sample_origin: 'Broiler',
    Matrixgruppe: 'Fleisch',
    Matrix_group: 'Meat',
    Matrix_DE: '(Hals)haut',
    Matrix_EN: '(Neck) skin',
    Mikroorganismus: 'Campylobacter spp.',
    Microorganism: 'Campylobacter spp.',
    Probenahmestelle: 'Einzelhandel',
    Sampling_stage: 'Retail',
    Probentyp: 'Lebensmittel',
    Sample_type: 'Food',
    Spezies: 'C. coli',
    Species: 'C. coli',
    Antimiktobielle_Subtanz: 'AMP',
    Antimicrobial_substance: 'AMP',
  },
};

export const AMR: SheetDef = {
  name: 'amr_resrate',
  columns: [
    'ZoMo-Programm',
    'Jahr',
    'Sampling year',
    'Mikroorganismus',
    'Microorganism',
    'Spezies',
    'Species',
    'Probentyp',
    'Sample type',
    'Oberkategorie Probenursprung (Tier/Lebensmittel/Futtermittel)',
    'Superordinate sample origin',
    'Probenursprung (Tier/Lebensmittel/Futtermittel)',
    'Sample origin',
    'Probenahmestelle',
    'Sampling stage',
    'Matrixgruppe',
    'Matrix group',
    'Matrix_neu',
    'Matrix_new',
    'Matrixdetail',
    'Matrix_detail_en',
    'Antimikrobielle Substanz',
    'Antimicrobial substance',
    'Anzahl getesteter Isolate',
    'Anzahl resistenter Isolate',
    'Resistenzrate (%)',
    'Min. 95% Konfidenzintervall',
    'Max. 95% Konfidenzintervall',
    'string_dbid',
  ],
  row: {
    'ZoMo-Programm': 'EH2',
    Jahr: 2024,
    'Sampling year': 2024,
    Mikroorganismus: 'Campylobacter spp.',
    Microorganism: 'Campylobacter spp.',
    Spezies: 'C. coli',
    Species: 'C. coli',
    Probentyp: 'Lebensmittel',
    'Sample type': 'Food',
    'Oberkategorie Probenursprung (Tier/Lebensmittel/Futtermittel)': 'Huhn',
    'Superordinate sample origin': 'Chicken',
    'Probenursprung (Tier/Lebensmittel/Futtermittel)': 'Masthähnchen',
    'Sample origin': 'Broiler',
    Probenahmestelle: 'Einzelhandel',
    'Sampling stage': 'Retail',
    Matrixgruppe: 'Fleisch',
    'Matrix group': 'Meat',
    Matrix_neu: '(Hals)haut',
    Matrix_new: '(Neck) skin',
    Matrixdetail: 'gekühlt',
    Matrix_detail_en: 'gekühlt',
    'Antimikrobielle Substanz': 'AMP',
    'Antimicrobial substance': 'AMP',
    'Anzahl getesteter Isolate': 120,
    'Anzahl resistenter Isolate': 15,
    'Resistenzrate (%)': 12.5,
    'Min. 95% Konfidenzintervall': 5,
    'Max. 95% Konfidenzintervall': 20,
    string_dbid: 'R-1',
  },
};

export const PREV: SheetDef = {
  name: 'prevalence',
  columns: [
    'ID',
    'ZoMo-Programm',
    'Jahr',
    'Mikroorganismus',
    'Microorganism',
    'Probentyp',
    'Sample type',
    'Oberkategorie Probenursprung (Tier/Lebensmittel/Futtermittel)',
    'Superordinate sample origin',
    'Probenursprung (Tier/Lebensmittel/Futtermittel)',
    'Sample origin',
    'Probenahmestelle',
    'Sampling stage',
    'Matrixgruppe',
    'Matrix group',
    'Matrix_neu',
    'Matrix_new',
    'Matrixdetail',
    'Matrix_detail_en',
    'Weitere Details',
    'Anzahl_Proben_N',
    'Positive_Proben_N',
    'prevalence',
    'min_95_KI',
    'max_95_KI',
    'Gruppe',
    'Produktionsrichtung',
  ],
  row: {
    ID: 1,
    'ZoMo-Programm': 'EH2',
    Jahr: 2024,
    Mikroorganismus: 'Campylobacter spp.',
    Microorganism: 'Campylobacter spp.',
    Probentyp: 'Lebensmittel',
    'Sample type': 'Food',
    'Oberkategorie Probenursprung (Tier/Lebensmittel/Futtermittel)': 'Huhn',
    'Superordinate sample origin': 'Chicken',
    'Probenursprung (Tier/Lebensmittel/Futtermittel)': 'Masthähnchen',
    'Sample origin': 'Broiler',
    Probenahmestelle: 'Einzelhandel',
    'Sampling stage': 'Retail',
    Matrixgruppe: 'Fleisch',
    'Matrix group': 'Meat',
    Matrix_neu: '(Hals)haut',
    Matrix_new: '(Neck) skin',
    Matrixdetail: 'gekühlt',
    Matrix_detail_en: 'gekühlt',
    'Weitere Details': 'note',
    Anzahl_Proben_N: 100,
    Positive_Proben_N: 7,
    prevalence: 7,
    min_95_KI: 3.1,
    max_95_KI: 12.9,
    Gruppe: 'g',
    Produktionsrichtung: 'pr',
  },
};

/** Turns a SheetDef + row records into a buildWorkbook sheet spec. */
export function spec(def: SheetDef, rows: Cells[] = [def.row]): SheetSpec {
  return {
    name: def.name,
    columns: def.columns,
    rows: rows.map((rec) => def.columns.map((c) => rec[c] ?? null)),
  };
}

export function workbookWith(...sheets: SheetSpec[]): ExcelJS.Workbook {
  return buildWorkbook(sheets);
}

/** A workbook that passes every pre-flight check. */
export function validWorkbook(): ExcelJS.Workbook {
  return workbookWith(spec(MASTERDATA), spec(AMR), spec(PREV));
}
