import { NextRequest, NextResponse } from "next/server";

import { AuthError, requireRole } from "../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../lib/db/prisma";
import { getFileStream } from "../../../../../../lib/storage";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function contentDisposition(filename: string) {
  const safeFallback = filename.replaceAll(/[^\w .-]/g, "_");
  return `attachment; filename="${safeFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireRole(["AuditTeam"]);
    const { id } = await context.params;
    const audit = await prisma.audits.findFirst({
      where: {
        id,
        is_deleted: false,
      },
      select: {
        report_pdf_path: true,
        report_pdf_filename: true,
      },
    });

    if (!audit?.report_pdf_path || !audit.report_pdf_filename) {
      return NextResponse.json({ error: "Report PDF not found" }, { status: 404 });
    }

    const buffer = await getFileStream(audit.report_pdf_path);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(audit.report_pdf_filename),
        "Content-Length": String(buffer.byteLength),
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
