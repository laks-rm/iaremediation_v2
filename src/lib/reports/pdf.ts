import path from "path";

import type { Content, StyleDictionary, TDocumentDefinitions } from "pdfmake/interfaces";

const FONT_BASE = path.join(process.cwd(), "node_modules/pdfmake/build/fonts/Roboto/");

// Lazy-initialised singleton to avoid loading pdfmake on every request
let _pdfmakeReady = false;
function getPdfMake() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pm = require("pdfmake") as {
    fonts: Record<string, unknown>;
    setLocalAccessPolicy: (fn: (p: string) => boolean) => void;
    setUrlAccessPolicy: (fn: () => boolean) => void;
    createPdf: (def: TDocumentDefinitions) => { getBuffer(): Promise<Buffer> };
  };
  if (!_pdfmakeReady) {
    pm.setLocalAccessPolicy((p: string) => p.startsWith(FONT_BASE));
    pm.setUrlAccessPolicy(() => false);
    pm.fonts = {
      Roboto: {
        normal: `${FONT_BASE}Roboto-Regular.ttf`,
        bold: `${FONT_BASE}Roboto-Medium.ttf`,
        italics: `${FONT_BASE}Roboto-Italic.ttf`,
        bolditalics: `${FONT_BASE}Roboto-MediumItalic.ttf`,
      },
    };
    _pdfmakeReady = true;
  }
  return pm;
}

export const PDF_STYLES: StyleDictionary = {
  reportTitle: { fontSize: 18, bold: true, margin: [0, 0, 0, 4] },
  reportSubtitle: { fontSize: 11, color: "#64748b", margin: [0, 0, 0, 16] },
  sectionHeader: { fontSize: 13, bold: true, margin: [0, 16, 0, 6], color: "#1e293b" },
  tableHeader: { bold: true, fillColor: "#1e293b", color: "#ffffff", fontSize: 9 },
  tableCell: { fontSize: 9 },
  small: { fontSize: 8, color: "#64748b" },
  stat: { fontSize: 11, bold: true },
  statLabel: { fontSize: 9, color: "#64748b" },
  groupHeader: { fontSize: 10, bold: true, fillColor: "#f1f5f9", margin: [0, 8, 0, 2] },
};

export const PDF_TABLE_LAYOUT = {
  hLineWidth: (i: number, node: { table: { headerRows?: number; body: unknown[] } }) =>
    i === 0 || i === (node.table.headerRows ?? 1) || i === node.table.body.length ? 1 : 0.5,
  vLineWidth: () => 0,
  hLineColor: (i: number, node: { table: { headerRows?: number; body: unknown[] } }) =>
    i === (node.table.headerRows ?? 1) ? "#1e293b" : "#e2e8f0",
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 4,
  paddingBottom: () => 4,
};

export function makeHeaderRow(cols: string[]): Content[] {
  return cols.map((c) => ({ text: c, style: "tableHeader" }));
}

export function makePdfFooter(userName: string): TDocumentDefinitions["footer"] {
  return (currentPage: number, pageCount: number) => ({
    columns: [
      { text: `Generated on ${new Date().toLocaleDateString("en-GB")} by ${userName}`, style: "small", margin: [40, 0, 0, 0] },
      { text: `Page ${currentPage} of ${pageCount}`, style: "small", alignment: "right", margin: [0, 0, 40, 0] },
    ],
  });
}

export async function buildPdfBuffer(docDefinition: TDocumentDefinitions): Promise<Buffer> {
  const pm = getPdfMake();
  const doc = pm.createPdf(docDefinition);
  return doc.getBuffer();
}
