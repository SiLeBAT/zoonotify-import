import { describe, it, expect } from 'vitest';
import { buildWorkbook } from './fixtures/in-memory-workbook.js';
import { checkLocaleCompleteness } from '../src/core/preflight-checks.js';
import { describeCollection } from '../src/core/descriptors.js';

const specie = describeCollection('specie');
const resistance = describeCollection('resistance');

function sheet(collection: string, columns: string[], rows: (string | number | null)[][]) {
  return buildWorkbook([{ name: collection, columns, rows }]).getWorksheet(collection)!;
}

describe('checkLocaleCompleteness (check #8)', () => {
  it('passes a fully-translated row', () => {
    const ws = sheet('specie', ['name_en', 'name_de'], [['Gallus gallus', 'Haushuhn']]);
    expect(checkLocaleCompleteness(ws, specie)).toEqual([]);
  });

  it('warns (does not error) when DE is missing but EN is present', () => {
    const ws = sheet('specie', ['name_en', 'name_de'], [['Sus scrofa', '-']]);
    const findings = checkLocaleCompleteness(ws, specie);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: 8,
      level: 'warning',
      sheet: 'specie',
      row: 2,
      field: 'name_de',
    });
  });

  it('errors when EN is missing but DE is present (EN is the base locale)', () => {
    const ws = sheet('specie', ['name_en', 'name_de'], [['-', 'Haushuhn']]);
    const findings = checkLocaleCompleteness(ws, specie);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: 8,
      level: 'error',
      sheet: 'specie',
      row: 2,
      field: 'name_en',
    });
  });

  it('is a no-op for collections without a localized name (fact tables)', () => {
    const ws = sheet('resistance', ['dbId'], [['R-1']]);
    expect(checkLocaleCompleteness(ws, resistance)).toEqual([]);
  });
});
