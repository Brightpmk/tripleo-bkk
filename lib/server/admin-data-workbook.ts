import "server-only";

import ExcelJS from "exceljs";
import { dataTableIds, dataTables, type AdminDataSnapshot } from "@/lib/admin-data";

export async function createAdminDataWorkbook(snapshot: AdminDataSnapshot) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Tripleo.bkk";
  workbook.created = new Date(snapshot.loadedAt);

  for (const id of dataTableIds) {
    const { label, columns } = dataTables[id];
    const sheet = workbook.addWorksheet(label, {
      views: [{ state: "frozen", xSplit: 1, ySplit: 1 }]
    });
    sheet.columns = columns.map((column) => ({
      header: column.label, key: column.key, width: column.width ?? 20,
      style: {
        numFmt: column.kind === "date" ? 'yyyy-mm-dd hh:mm:ss' : column.kind === "number" ? '#,##0.00' : "@",
        font: { name: "Calibri", size: 11 },
        alignment: { vertical: "top", wrapText: true }
      }
    }));
    for (const row of snapshot.tables[id]) {
      sheet.addRow(columns.map((column) => {
        const value = row[column.key];
        if (column.kind === "date" && typeof value === "string") {
          const date = new Date(value);
          return Number.isNaN(date.getTime()) ? value : date;
        }
        // Strings stay literal, including leading zeroes and formula-like customer input.
        return value;
      }));
    }
    const header = sheet.getRow(1);
    header.height = 30;
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F352D" } };
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: columns.length } };
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1 && rowNumber % 2 === 0) {
        row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F5F2" } }; });
      }
    });
    for (const column of columns.filter((entry) => ["quantity", "sort_order"].includes(entry.key))) {
      sheet.getColumn(column.key).numFmt = "0";
    }
  }
  return workbook.xlsx.writeBuffer();
}
