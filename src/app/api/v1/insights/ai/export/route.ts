import {
  Document,
  HeadingLevel,
  PageBreak,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../../lib/auth/getCurrentUser";
import { prisma } from "../../../../../../lib/db/prisma";
import {
  INSIGHT_CATEGORY_ORDER,
  type AiInsightCard,
  type AiInsightsSnapshotPayload,
  type InsightType,
} from "../../../../../../lib/ai/insights/types";

const CATEGORY_LABELS: Record<InsightType, string> = {
  risk_concentration: "Risk Concentration",
  bottleneck: "Bottleneck",
  quality_gap: "Quality Gap",
  forward_look: "Forward Look",
  anomaly: "Anomaly",
  risk_mitigated: "Risk Mitigated",
};

function isSnapshotPayload(value: unknown): value is AiInsightsSnapshotPayload {
  return Boolean(value) && typeof value === "object" && "cards" in value && Array.isArray((value as { cards?: unknown }).cards);
}

function textParagraph(text: string, options: { heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel] } = {}) {
  return new Paragraph({
    heading: options.heading,
    children: [new TextRun(text)],
    spacing: {
      after: 160,
    },
  });
}

function metadataParagraph(label: string, value: string, small = false) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: small ? 18 : undefined }),
      new TextRun({ text: value, size: small ? 18 : undefined }),
    ],
    spacing: {
      after: 80,
    },
  });
}

function formatGeneratedAt(value: Date) {
  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(value);
  const year = value.getUTCFullYear();
  const hours = String(value.getUTCHours()).padStart(2, "0");
  const minutes = String(value.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
}

function supportingNumbersTable(card: AiInsightCard) {
  return new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Metric", bold: true })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Value", bold: true })] })] }),
        ],
      }),
      ...card.supportingNumbers.map(
        (item) =>
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph(String(item.label))] }),
              new TableCell({ children: [new Paragraph(String(item.value))] }),
            ],
          }),
      ),
    ],
  });
}

function buildDocument(payload: AiInsightsSnapshotPayload, snapshot: { generated_at: Date; model_used: string; prompt_version: string }) {
  const children: (Paragraph | Table)[] = [
    textParagraph("AI Insights — Internal Audit Remediation", { heading: HeadingLevel.TITLE }),
    metadataParagraph("Generated", formatGeneratedAt(snapshot.generated_at)),
    metadataParagraph("Model used", snapshot.model_used, true),
    metadataParagraph("Prompt version", snapshot.prompt_version, true),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  if (payload.executiveBrief.trim()) {
    children.push(textParagraph("Executive Brief", { heading: HeadingLevel.HEADING_1 }));
    children.push(textParagraph(payload.executiveBrief));
    children.push(new Paragraph({ text: "" }));
  }

  INSIGHT_CATEGORY_ORDER.forEach((category) => {
    const cards = payload.cards.filter((card) => card.insightType === category);
    if (cards.length === 0) return;

    children.push(textParagraph(CATEGORY_LABELS[category], { heading: HeadingLevel.HEADING_1 }));
    cards.forEach((card) => {
      children.push(textParagraph(card.headline, { heading: HeadingLevel.HEADING_2 }));
      children.push(textParagraph(`Severity: ${card.severity} — Confidence: ${card.confidence}`));
      if (card.narrative.trim()) {
        children.push(textParagraph(card.narrative));
      }
      children.push(supportingNumbersTable(card));
      children.push(new Paragraph({ text: "" }));
    });
  });

  return new Document({
    sections: [
      {
        children,
      },
    ],
  });
}

export async function GET() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const snapshot = await prisma.ai_insights_snapshot.findFirst({
      orderBy: {
        generated_at: "desc",
      },
    });

    if (!snapshot || !isSnapshotPayload(snapshot.payload)) {
      return NextResponse.json({ error: "No insights snapshot available" }, { status: 404 });
    }

    const document = buildDocument(snapshot.payload, snapshot);
    const buffer = await Packer.toBuffer(document);
    const body = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(body).set(buffer);
    const filenameDate = snapshot.generated_at.toISOString().slice(0, 10);

    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="ai-insights-${filenameDate}.docx"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
