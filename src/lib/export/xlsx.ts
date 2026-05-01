import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type WorksheetOptions = {
  columns: string[];
  name: string;
  warning?: string;
};

export function formatExportDate(value: Date | null | undefined) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

export function getUtcDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function createExportWorksheet({ columns, name, warning }: WorksheetOptions) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "IA Remediation Tracker";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(name);
  const headerRowNumber = warning ? 2 : 1;
  worksheet.columns = columns.map((header) => ({
    key: header,
    width: Math.max(header.length + 2, 14),
  }));

  if (warning) {
    worksheet.getCell("A1").value = warning;
  }

  const headerRow = worksheet.getRow(headerRowNumber);
  headerRow.values = columns;
  headerRow.font = { bold: true };

  return { workbook, worksheet, dataStartRow: headerRowNumber + 1 };
}

export async function buildXlsxResponse(workbook: ExcelJS.Workbook, filename: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const body = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer);

  return new NextResponse(body, {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
