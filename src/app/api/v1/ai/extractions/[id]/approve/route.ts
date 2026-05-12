import {
  AuditOpinionRating,
  AuditType,
  ControlRating,
  Priority,
  Prisma,
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import {
  ExtractedActionPlan,
  ExtractedAuditData,
  ExtractedFinding,
  mergeExtractionData,
  nullableString,
  parseNullableDate,
  toPrismaJson,
} from "../../../../../../../lib/ai/extraction";
import { inferAuditTypeFromReference } from "../../../../../../../lib/audit-type-mapping";
import { writeAuditLog } from "../../../../../../../lib/audit-log/writeAuditLog";
import { AuthError, requireRole } from "../../../../../../../lib/auth/requireRole";
import { prisma } from "../../../../../../../lib/db/prisma";
import { generateDisplayId } from "../../../../../../../lib/ids/generateDisplayId";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
}

async function getUniqueDisplayId(auditReportIssueYear?: number) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const displayId = generateDisplayId(auditReportIssueYear);
    const existing = await prisma.action_plans.findUnique({
      where: {
        display_id: displayId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return displayId;
    }
  }

  throw new Error("Unable to generate display id");
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

async function resolveEntityIds(data: ExtractedAuditData) {
  if (Array.isArray(data.entity_ids) && data.entity_ids.length > 0) {
    return [...new Set(data.entity_ids)];
  }

  const mentioned = new Set((data.entities_mentioned ?? []).map(normalize));
  if (mentioned.size === 0) {
    return [];
  }

  const entities = await prisma.entities.findMany({
    where: {
      is_active: true,
    },
    select: {
      id: true,
      code: true,
      full_name: true,
    },
  });

  return entities
    .filter((entity) => mentioned.has(normalize(entity.code)) || mentioned.has(normalize(entity.full_name)))
    .map((entity) => entity.id);
}

async function resolveOwnerId(actionPlan: ExtractedActionPlan) {
  if (actionPlan.owner_user_id) {
    return actionPlan.owner_user_id;
  }

  const ownerNames = actionPlan.owner_names?.map(normalize).filter(Boolean) ?? [];
  if (ownerNames.length === 0) {
    return null;
  }

  const users = await prisma.users.findMany({
    where: {
      is_active: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });

  return (
    users.find(
      (user) => ownerNames.includes(normalize(user.name)) || ownerNames.includes(normalize(user.email)),
    )?.id ?? null
  );
}

function actionPlansForFinding(data: ExtractedAuditData, finding: ExtractedFinding) {
  const nested = finding.action_plans ?? [];
  if (nested.length > 0) {
    return nested;
  }

  const externalRef = nullableString(finding.external_ref);
  const topLevel = (data.action_plans ?? []).filter((actionPlan) => {
    const findingReference = nullableString(actionPlan.finding_reference);
    return externalRef && findingReference && normalize(externalRef) === normalize(findingReference);
  });

  return topLevel;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const currentUser = await requireRole(["AuditTeam"]);
    const { id } = await context.params;
    const extraction = await prisma.ai_extractions.findFirst({
      where: {
        id,
      },
    });

    if (!extraction) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (extraction.status !== "Pending") {
      return NextResponse.json({ error: "Only pending extractions can be approved" }, { status: 400 });
    }

    const finalData = mergeExtractionData(extraction.extracted_json, extraction.human_edits_json);
    const auditEntityIds = await resolveEntityIds(finalData);
    const errors: string[] = [];

    const reportIssueDate = parseNullableDate(finalData.report_issue_date);
    const auditReportIssueYear = reportIssueDate ? reportIssueDate.getFullYear() : undefined;
    
    // Infer audit_type from reference_number if not already set
    const referenceNumber = nullableString(finalData.reference_number);
    const inferredAuditType = inferAuditTypeFromReference(referenceNumber);
    const auditType = (finalData.audit_type as AuditType | null) ?? inferredAuditType ?? "IT";
    
    const audit = await prisma.audits.create({
      data: {
        name: nullableString(finalData.audit_name ?? finalData.name) ?? extraction.filename,
        reference_number: referenceNumber,
        audit_type: auditType,
        opinion_rating: finalData.opinion_rating as AuditOpinionRating | null | undefined,
        report_issue_date: reportIssueDate,
        executive_summary: nullableString(finalData.executive_summary),
        report_pdf_path: extraction.file_path,
        report_pdf_filename: extraction.filename,
        created_by_id: currentUser.id,
      },
    });

    for (const entityId of auditEntityIds) {
      await prisma.audit_entities
        .create({
          data: {
            audit_id: audit.id,
            entity_id: entityId,
          },
        })
        .catch((error: Error) => errors.push(`Audit entity ${entityId}: ${error.message}`));
    }

    for (const [index, area] of (finalData.control_areas ?? []).entries()) {
      await prisma.control_areas
        .create({
          data: {
            audit_id: audit.id,
            title: nullableString(area.title) ?? `Control area ${index + 1}`,
            control_rating: (area.control_rating ?? area.rating) as ControlRating | null | undefined,
            finding_ref: nullableString(area.finding_reference),
            display_order: index,
          },
        })
        .catch((error: Error) => errors.push(`Control area ${index + 1}: ${error.message}`));
    }

    for (const [findingIndex, findingData] of (finalData.findings ?? []).entries()) {
      try {
        const finding = await prisma.findings.create({
          data: {
            audit_id: audit.id,
            is_standalone: false,
            external_ref: nullableString(findingData.external_ref),
            title: nullableString(findingData.title) ?? `Finding ${findingIndex + 1}`,
            description: nullableString(findingData.description),
            root_cause: nullableString(findingData.root_cause),
            potential_impact: nullableString(findingData.potential_impact),
            recommendation: nullableString(findingData.recommendation),
            priority: findingData.priority as Priority | null | undefined,
            control_rating: findingData.control_rating as ControlRating | null | undefined,
            finding_type: findingData.finding_type ?? "Finding",
            display_order: findingIndex + 1,
            created_by_id: currentUser.id,
            created_via: "AIIngestion",
          },
        });

        for (const [actionPlanIndex, actionPlanData] of actionPlansForFinding(finalData, findingData).entries()) {
          try {
            const extractedStatus = actionPlanData.status;
            const validStatuses = ["NotStarted", "InProgress", "PendingValidation", "Closed", "RiskAccepted", "Dropped"];
            const status = typeof extractedStatus === "string" && validStatuses.includes(extractedStatus)
              ? extractedStatus
              : "NotStarted";
            
            const actionPlan = await prisma.action_plans.create({
              data: {
                display_id: await getUniqueDisplayId(auditReportIssueYear),
                finding_id: finding.id,
                title: nullableString(actionPlanData.title),
                description:
                  nullableString(actionPlanData.description) ??
                  `Action plan ${actionPlanIndex + 1} for ${finding.title}`,
                priority: actionPlanData.priority as Priority | null | undefined,
                status: status as "NotStarted" | "InProgress" | "PendingValidation" | "Closed" | "RiskAccepted" | "Dropped",
                original_target_date: parseNullableDate(actionPlanData.target_date),
                current_target_date: parseNullableDate(actionPlanData.target_date),
                required_evidence: nullableString(actionPlanData.required_evidence),
                created_via: "AIIngestion",
                created_by_id: currentUser.id,
              },
            });
            const actionPlanEntityIds =
              actionPlanData.entity_ids && actionPlanData.entity_ids.length > 0
                ? actionPlanData.entity_ids
                : auditEntityIds;

            for (const entityId of actionPlanEntityIds) {
              await prisma.action_plan_entities
                .create({
                  data: {
                    action_plan_id: actionPlan.id,
                    entity_id: entityId,
                  },
                })
                .catch((error: Error) =>
                  errors.push(`Action plan ${actionPlan.display_id} entity ${entityId}: ${error.message}`),
                );
            }

            const ownerId = await resolveOwnerId(actionPlanData);
            if (ownerId) {
              await prisma.action_plan_owners
                .create({
                  data: {
                    action_plan_id: actionPlan.id,
                    user_id: ownerId,
                    is_primary: true,
                    assigned_by_id: currentUser.id,
                  },
                })
                .catch((error: Error) =>
                  errors.push(`Action plan ${actionPlan.display_id} owner: ${error.message}`),
                );
            }

            if (actionPlanData.follow_up_auditor_user_id) {
              await prisma.action_plan_follow_up_auditors
                .create({
                  data: {
                    action_plan_id: actionPlan.id,
                    user_id: actionPlanData.follow_up_auditor_user_id,
                  },
                })
                .catch((error: Error) =>
                  errors.push(`Action plan ${actionPlan.display_id} follow-up auditor: ${error.message}`),
                );
            }
          } catch (error) {
            errors.push(
              `Finding ${finding.external_ref ?? finding.title} action plan ${actionPlanIndex + 1}: ${
                error instanceof Error ? error.message : "Unable to create action plan"
              }`,
            );
          }
        }
      } catch (error) {
        errors.push(
          `Finding ${findingData.external_ref ?? findingIndex + 1}: ${
            error instanceof Error ? error.message : "Unable to create finding"
          }`,
        );
      }
    }

    const updatedExtraction = await prisma.ai_extractions.update({
      where: {
        id,
      },
      data: {
        status: "Approved",
        approved_by_id: currentUser.id,
        created_audit_id: audit.id,
        human_edits_json: toPrismaJson(finalData),
      },
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: "AIExtract",
      entityType: "ai_extractions",
      entityId: id,
      beforeJson: toPrismaJson(extraction),
      afterJson: toPrismaJson({
        extraction: updatedExtraction,
        audit_id: audit.id,
        creation_errors: errors,
      }),
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({ audit_id: audit.id, errors });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
