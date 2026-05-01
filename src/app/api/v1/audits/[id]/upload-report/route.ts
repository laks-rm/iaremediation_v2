import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { writeAuditLog } from "../../../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireRole } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";
import { uploadFile } from "../../../../../../lib/storage";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
}

function isPdf(buffer: Buffer, file: File) {
  const header = buffer.subarray(0, 5).toString("ascii");
  return header === "%PDF-" && file.type === "application/pdf";
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam"]);
    const { id } = await context.params;
    const audit = await prisma.audits.findFirst({
      where: {
        id,
        is_deleted: false,
      },
      select: {
        id: true,
        report_pdf_path: true,
        report_pdf_filename: true,
      },
    });

    if (!audit) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A single PDF file field is required" }, { status: 400 });
    }

    if (file.size <= 0 || file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "PDF must be under 50MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!isPdf(buffer, file)) {
      return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });
    }

    const storagePath = `audit-reports/${id}/${randomUUID()}.pdf`;
    const uploadedPath = await uploadFile(buffer, storagePath, "application/pdf");
    const updatedAudit = await prisma.audits.update({
      where: {
        id,
      },
      data: {
        report_pdf_path: uploadedPath,
        report_pdf_filename: file.name,
      },
      select: {
        id: true,
        report_pdf_path: true,
        report_pdf_filename: true,
      },
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "Update",
      entityType: "audits",
      entityId: id,
      beforeJson: audit,
      afterJson: updatedAudit,
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ audit: updatedAudit });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
