import ExcelJS from 'exceljs';

export interface SheetSpec {
  name: string;
  columns: string[];
  rows?: (string | number | null)[][];
}

/**
 * Builds an in-memory ExcelJS workbook (row 1 = header) without touching disk.
 * Pre-flight checks read worksheets directly, so the check tests drive them
 * with workbooks built here rather than round-tripping through a temp file.
 */
export function buildWorkbook(sheets: SheetSpec[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(spec.name);
    sheet.addRow(spec.columns);
    for (const row of spec.rows ?? []) {
      sheet.addRow(row);
    }
  }
  return workbook;
}
