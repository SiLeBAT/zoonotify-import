import { describe, it, expect } from 'vitest';
import { buildWorkbook } from './fixtures/in-memory-workbook.js';
import { checkSheetsPresent } from '../src/core/preflight-checks.js';
import { describeAllCollections } from '../src/core/descriptors.js';

const descriptors = describeAllCollections();

describe('checkSheetsPresent (check #2)', () => {
  it('returns no findings when every expected sheet is present', () => {
    const workbook = buildWorkbook(descriptors.map((d) => ({ name: d.collection, columns: [] })));
    expect(checkSheetsPresent(workbook, descriptors)).toEqual([]);
  });

  it('flags each missing sheet as a check-2 error naming the sheet', () => {
    const present = descriptors.filter((d) => d.collection !== 'resistance');
    const workbook = buildWorkbook(present.map((d) => ({ name: d.collection, columns: [] })));

    const findings = checkSheetsPresent(workbook, descriptors);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ check: 2, level: 'error', sheet: 'resistance' });
    expect(findings[0]!.message).toMatch(/resistance/);
  });

  it('accumulates one finding per missing sheet (does not stop at the first)', () => {
    const workbook = buildWorkbook([{ name: 'matrix', columns: [] }]);
    const findings = checkSheetsPresent(workbook, descriptors);
    expect(findings.length).toBe(descriptors.length - 1);
    expect(findings.every((f) => f.check === 2 && f.level === 'error')).toBe(true);
  });
});
