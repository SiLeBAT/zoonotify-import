import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWorkbook } from './fixtures/in-memory-workbook.js';
import { normalizeReferences, normalizeFacts } from '../src/core/normalizer.js';

/** The nine DE/EN column pairs of the masterdata sheet, in source order. */
const MASTERDATA_COLUMNS = [
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
];

/** Builds a masterdata-only workbook from a per-column map; columns pad to equal length. */
function masterdataWorkbook(byColumn: Record<string, (string | null)[]>): ExcelJS.Workbook {
  const len = Math.max(0, ...Object.values(byColumn).map((v) => v.length));
  const rows: (string | null)[][] = [];
  for (let i = 0; i < len; i++) {
    rows.push(MASTERDATA_COLUMNS.map((c) => byColumn[c]?.[i] ?? null));
  }
  return buildWorkbook([{ name: 'masterdata', columns: MASTERDATA_COLUMNS, rows }]);
}

describe('normalizeReferences — masterdata column pairs', () => {
  it('parses a column pair into distinct localized rows (matrix), EN as base locale', () => {
    const wb = masterdataWorkbook({
      Matrix_DE: ['(Hals)haut', 'Babyspinat'],
      Matrix_EN: ['(Neck) skin', 'Baby spinach'],
    });

    const matrix = normalizeReferences(wb).find((c) => c.collection === 'matrix');

    expect(matrix?.rows).toEqual([
      { en: { name: '(Neck) skin' }, de: { name: '(Hals)haut' } },
      { en: { name: 'Baby spinach' }, de: { name: 'Babyspinat' } },
    ]);
  });

  it('dedupes repeated pairs and skips blank/sentinel rows', () => {
    const wb = masterdataWorkbook({
      Matrix_DE: ['(Hals)haut', '(Hals)haut', '-', 'Babyspinat'],
      Matrix_EN: ['(Neck) skin', '(Neck) skin', '-', 'Baby spinach'],
    });

    const matrix = normalizeReferences(wb).find((c) => c.collection === 'matrix');

    expect(matrix?.rows).toEqual([
      { en: { name: '(Neck) skin' }, de: { name: '(Hals)haut' } },
      { en: { name: 'Baby spinach' }, de: { name: 'Babyspinat' } },
    ]);
  });

  it('treats columns as independent lists of unequal length, not row tuples', () => {
    const wb = masterdataWorkbook({
      Matrix_DE: ['(Hals)haut', 'Babyspinat', 'Eierschale'],
      Matrix_EN: ['(Neck) skin', 'Baby spinach', 'Egg shell'],
      Mikroorganismus: ['Campylobacter spp.'],
      Microorganism: ['Campylobacter spp.'],
    });

    const refs = normalizeReferences(wb);

    expect(refs.find((c) => c.collection === 'matrix')?.rows).toHaveLength(3);
    expect(refs.find((c) => c.collection === 'microorganism')?.rows).toEqual([
      { en: { name: 'Campylobacter spp.' }, de: { name: 'Campylobacter spp.' } },
    ]);
  });

  it('emits all nine masterdata reference collections with their column bindings', () => {
    const wb = masterdataWorkbook({
      Oberkategorie_Probenursprung: ['Huhn'],
      Superordinate_sample_origin: ['Chicken'],
      Probenursprung: ['Masthähnchen'],
      Sample_origin: ['Broiler'],
      Matrixgruppe: ['Fleisch'],
      Matrix_group: ['Meat'],
      Matrix_DE: ['(Hals)haut'],
      Matrix_EN: ['(Neck) skin'],
      Mikroorganismus: ['Campylobacter spp.'],
      Microorganism: ['Campylobacter spp.'],
      Probenahmestelle: ['Einzelhandel'],
      Sampling_stage: ['Retail'],
      Probentyp: ['Lebensmittel'],
      Sample_type: ['Food'],
      Spezies: ['C. coli'],
      Species: ['C. coli'],
      Antimiktobielle_Subtanz: ['AMP'],
      Antimicrobial_substance: ['AMP'],
    });

    const refs = normalizeReferences(wb);

    expect(refs.map((c) => c.collection)).toEqual(
      expect.arrayContaining([
        'matrix',
        'matrix-group',
        'microorganism',
        'specie',
        'antimicrobial-substance',
        'sample-type',
        'sample-origin',
        'super-category-sample-origin',
        'sampling-stage',
      ]),
    );
    expect(refs.find((c) => c.collection === 'super-category-sample-origin')?.rows).toEqual([
      { en: { name: 'Chicken' }, de: { name: 'Huhn' } },
    ]);
    expect(refs.find((c) => c.collection === 'antimicrobial-substance')?.rows).toEqual([
      { en: { name: 'AMP' }, de: { name: 'AMP' } },
    ]);
  });
});

describe('normalizeReferences — matrix-detail (harvested from fact sheets, non-i18n)', () => {
  it('unions distinct Matrixdetail values across both fact sheets as en-only rows', () => {
    const wb = buildWorkbook([
      { name: 'masterdata', columns: MASTERDATA_COLUMNS, rows: [] },
      {
        name: 'amr_resrate',
        columns: ['Matrixdetail'],
        rows: [['gekühlt'], ['Poolprobe'], ['gekühlt']],
      },
      { name: 'prevalence', columns: ['Matrixdetail'], rows: [['aufgeschnitten'], ['Poolprobe']] },
    ]);

    const md = normalizeReferences(wb).find((c) => c.collection === 'matrix-detail');

    expect(md?.rows).toEqual([
      { en: { name: 'gekühlt' } },
      { en: { name: 'Poolprobe' } },
      { en: { name: 'aufgeschnitten' } },
    ]);
  });
});

describe('normalizeFacts — amr_resrate → resistance', () => {
  it('coerces scalar measures by type (comma decimals) and maps dbId from string_dbid', () => {
    const wb = buildWorkbook([
      {
        name: 'amr_resrate',
        columns: ['string_dbid', 'Jahr', 'Resistenzrate (%)'],
        rows: [['R-1', '2024', '12,5']],
      },
    ]);

    const resistance = normalizeFacts(wb).find((c) => c.collection === 'resistance');

    expect(resistance?.rows[0]?.scalars.en).toEqual({
      dbId: 'R-1',
      samplingYear: 2024,
      resistenzrate: 12.5,
    });
  });
});

describe('normalizeFacts — resistance scalar/relation rules (regression guards)', () => {
  it('copies the single ZoMo-Programm code into both locale payloads', () => {
    const wb = buildWorkbook([
      { name: 'amr_resrate', columns: ['ZoMo-Programm'], rows: [['EH2']] },
    ]);

    const row = normalizeFacts(wb).find((c) => c.collection === 'resistance')?.rows[0];

    expect(row?.scalars.en.zomoProgram).toBe('EH2');
    expect(row?.scalars.de.zomoProgram).toBe('EH2');
  });

  it('captures relation references by name and locale (DE column → ref.de, EN → ref.en)', () => {
    const wb = buildWorkbook([
      {
        name: 'amr_resrate',
        columns: ['Matrix_neu', 'Matrix_new'],
        rows: [['(Hals)haut', '(Neck) skin']],
      },
    ]);

    const row = normalizeFacts(wb).find((c) => c.collection === 'resistance')?.rows[0];
    const matrixRef = row?.relations.find((r) => r.attr === 'matrix');

    expect(matrixRef).toEqual({
      attr: 'matrix',
      collection: 'matrix',
      en: '(Neck) skin',
      de: '(Hals)haut',
    });
    expect(row?.hasDe).toBe(true);
  });

  it('reads samplingYear from Jahr and ignores the duplicate Sampling year column', () => {
    const wb = buildWorkbook([
      { name: 'amr_resrate', columns: ['Jahr', 'Sampling year'], rows: [['2024', '9999']] },
    ]);

    const row = normalizeFacts(wb).find((c) => c.collection === 'resistance')?.rows[0];

    expect(row?.scalars.en.samplingYear).toBe(2024);
  });
});

describe('normalizeFacts — prevalence', () => {
  it('maps prevalence measures and drops schema-less columns', () => {
    const wb = buildWorkbook([
      {
        name: 'prevalence',
        columns: [
          'ID',
          'Jahr',
          'Anzahl_Proben_N',
          'Positive_Proben_N',
          'prevalence',
          'min_95_KI',
          'max_95_KI',
          'Weitere Details',
          'Gruppe',
          'Produktionsrichtung',
          'Probentyp',
          'Sample type',
        ],
        rows: [
          [
            '42',
            '2024',
            '100',
            '7',
            '7,0',
            '3,1',
            '12,9',
            'note',
            'g',
            'pr',
            'Lebensmittel',
            'Food',
          ],
        ],
      },
    ]);

    const row = normalizeFacts(wb).find((c) => c.collection === 'prevalence')?.rows[0];

    expect(row?.scalars.en).toEqual({
      samplingYear: 2024,
      numberOfSamples: 100,
      numberOfPositive: 7,
      percentageOfPositive: 7,
      ciMin: 3.1,
      ciMax: 12.9,
    });
    // sampleType is not a prevalence relation; the columns are dropped silently.
    expect(row?.relations.map((r) => r.attr)).not.toContain('sampleType');
  });
});
