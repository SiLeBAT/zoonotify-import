import ExcelJS from 'exceljs';

export interface SheetSpec {
  name: string;
  columns: string[];
  rows: (string | number | null)[][];
}

/**
 * Writes a real .xlsx file at `filePath` with the given sheets. Row 1 of each
 * sheet is the header. Used to build parser fixtures without committing opaque
 * binaries — the bytes are produced by the same exceljs the parser reads with.
 */
export async function writeWorkbook(filePath: string, sheets: SheetSpec[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(spec.name);
    sheet.addRow(spec.columns);
    for (const row of spec.rows) {
      sheet.addRow(row);
    }
  }
  await workbook.xlsx.writeFile(filePath);
}
