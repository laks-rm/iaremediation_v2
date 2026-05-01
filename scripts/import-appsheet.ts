import {
  ActionPlanStatus,
  AuditType,
  PrismaClient,
  Priority,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { generateDisplayId } from "../src/lib/ids/generateDisplayId";

const loadEnv = process as typeof process & {
  loadEnvFile?: (path?: string) => void;
};

for (const envPath of [".env", "../ia_remediation/scripts/data/.env"]) {
  if (process.env.DATABASE_URL) {
    break;
  }

  try {
    loadEnv.loadEnvFile?.(envPath);
  } catch {
    // Keep trying known env locations; the shell may also provide DATABASE_URL.
  }
}

const adapter = new PrismaPg(
  process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/ia_remediation",
);
const prisma = new PrismaClient({ adapter });

type CsvRow = Record<string, string>;

const STATUS_MAP: Record<string, ActionPlanStatus> = {
  "In Progress": "InProgress",
  Closed: "Closed",
  "Not Started": "NotStarted",
  "Pending Validation": "PendingValidation",
  "Risk Accepted": "RiskAccepted",
  Dropped: "Dropped",
};

const PRIORITY_MAP: Record<string, Priority> = {
  High: "High",
  Moderate: "Moderate",
  Medium: "Moderate",
  Low: "Low",
};

const AUDIT_TYPE_MAP: Record<string, AuditType> = {
  IT: "IT",
  "Regulatory - IT": "RegulatoryIT",
  "Regulatory IT": "RegulatoryIT",
  "Regulatory – IT": "RegulatoryIT",
  RegulatoryIT: "RegulatoryIT",
  Operations: "Operations",
  "Regulatory - Operations": "RegulatoryOperations",
  "Regulatory Operations": "RegulatoryOperations",
  "Regulatory – Operations": "RegulatoryOperations",
  RegulatoryOperations: "RegulatoryOperations",
  External: "External",
};

function clean(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeKey(value: string | undefined) {
  return clean(value)?.toLowerCase() ?? "";
}

function parseCsv(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      row.push(field);
      field = "";

      if (row.some((value) => value.trim().length > 0)) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    field += character;
  }

  row.push(field);

  if (row.some((value) => value.trim().length > 0)) {
    rows.push(row);
  }

  const headers = rows[0]?.map((header) => header.trim()) ?? [];

  return rows.slice(1).map((values) =>
    headers.reduce<CsvRow>((record, header, index) => {
      record[header] = values[index]?.trim() ?? "";
      return record;
    }, {}),
  );
}

function getDataPath() {
  const candidates = [
    path.join(process.cwd(), "scripts", "data", "AppSheet_ViewData_2026-04-17.csv"),
    path.join(process.cwd(), "scripts", "data", "AppSheet.ViewData.2026-04-17.csv"),
    path.resolve(
      process.cwd(),
      "..",
      "ia_remediation",
      "scripts",
      "data",
      "AppSheet_ViewData_2026-04-17.csv",
    ),
    path.resolve(
      process.cwd(),
      "..",
      "ia_remediation",
      "scripts",
      "data",
      "AppSheet.ViewData.2026-04-17.csv",
    ),
  ];
  const foundPath = candidates.find((candidate) => existsSync(candidate));

  if (!foundPath) {
    throw new Error("Could not find AppSheet CSV data file");
  }

  return foundPath;
}

function parseAuditType(value: string | undefined) {
  const raw = clean(value)?.replace(/[–—]/g, "-");

  if (!raw || !AUDIT_TYPE_MAP[raw]) {
    throw new Error(`Unsupported audit type: ${raw ?? "(blank)"}`);
  }

  return AUDIT_TYPE_MAP[raw];
}

function parseStatus(value: string | undefined) {
  const raw = clean(value);

  if (!raw || !STATUS_MAP[raw]) {
    return "NotStarted";
  }

  return STATUS_MAP[raw];
}

function parsePriority(value: string | undefined) {
  const raw = clean(value);

  if (!raw || !PRIORITY_MAP[raw]) {
    return null;
  }

  return PRIORITY_MAP[raw];
}

function parseDate(value: string | undefined) {
  const raw = clean(value);

  if (!raw) {
    return null;
  }

  const [datePart] = raw.split(" ");
  const separator = datePart.includes("/") ? "/" : datePart.includes("-") ? "-" : null;

  if (!separator) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parts = datePart.split(separator).map((part) => Number(part));

  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  const [first, second, year] = parts;
  const day = separator === "-" || first > 12 ? first : second;
  const month = separator === "-" || first > 12 ? second : first;
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function generateUniqueDisplayId() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const displayId = generateDisplayId();
    const existing = await prisma.action_plans.findUnique({
      where: { display_id: displayId },
      select: { id: true },
    });

    if (!existing) {
      return displayId;
    }
  }

  throw new Error("Unable to generate unique action plan display ID");
}

async function findEntity(row: CsvRow) {
  const entityValue = clean(row.Entity) ?? clean(row.Entity_Names_Search);

  if (!entityValue) {
    return null;
  }

  return prisma.entities.findFirst({
    where: {
      OR: [
        { code: { equals: entityValue, mode: "insensitive" } },
        { full_name: { equals: entityValue, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
}

async function findOwner(ownerName: string | null) {
  if (!ownerName) {
    return null;
  }

  return prisma.users.findFirst({
    where: {
      name: {
        equals: ownerName,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });
}

async function findOrCreateAudit(
  auditName: string,
  auditType: AuditType,
  createdById: string,
  rows: CsvRow[],
) {
  const existingAudit = await prisma.audits.findFirst({
    where: {
      name: auditName,
      audit_type: auditType,
      is_deleted: false,
    },
    select: { id: true },
  });

  const reportIssueDate = parseDate(rows[0]?.["Audit Report Issue Date"]);
  const reportPdfPath = clean(rows[0]?.Link_to_Audit_Report);

  const audit =
    existingAudit ??
    (await prisma.audits.create({
      data: {
        name: auditName,
        audit_type: auditType,
        report_issue_date: reportIssueDate,
        report_pdf_path: reportPdfPath,
        report_pdf_filename: reportPdfPath ? `${auditName}.pdf` : null,
        created_by_id: createdById,
      },
      select: { id: true },
    }));

  for (const row of rows) {
    const entity = await findEntity(row);

    if (!entity) {
      continue;
    }

    await prisma.audit_entities.upsert({
      where: {
        audit_id_entity_id: {
          audit_id: audit.id,
          entity_id: entity.id,
        },
      },
      update: {},
      create: {
        audit_id: audit.id,
        entity_id: entity.id,
      },
    });
  }

  return audit;
}

async function findOrCreateFinding(
  auditId: string,
  title: string,
  createdById: string,
  row: CsvRow,
  displayOrder: number,
) {
  const existingFinding = await prisma.findings.findFirst({
    where: {
      audit_id: auditId,
      title,
      created_via: "Migration",
      is_deleted: false,
    },
    select: { id: true },
  });

  if (existingFinding) {
    return existingFinding;
  }

  return prisma.findings.create({
    data: {
      audit_id: auditId,
      title,
      description: clean(row["Finding Description"]),
      priority: parsePriority(row["Action Plan Priority"]),
      display_order: displayOrder,
      is_standalone: false,
      created_by_id: createdById,
      created_via: "Migration",
    },
    select: { id: true },
  });
}

async function findOrCreateActionPlan(
  findingId: string,
  createdById: string,
  row: CsvRow,
) {
  const description = clean(row["Action Plan Description"]) ?? "Migrated action plan";
  const existingActionPlan = await prisma.action_plans.findFirst({
    where: {
      finding_id: findingId,
      description,
      created_via: "Migration",
      is_deleted: false,
    },
    select: { id: true },
  });

  if (existingActionPlan) {
    return existingActionPlan;
  }

  const displayId = await generateUniqueDisplayId();

  return prisma.action_plans.create({
    data: {
      display_id: displayId,
      finding_id: findingId,
      description,
      priority: parsePriority(row["Action Plan Priority"]),
      status: parseStatus(row["Action Plan Status"]),
      original_target_date: parseDate(row["Target Date"]),
      current_target_date: parseDate(row.FinalDueDate) ?? parseDate(row["Final Due Date"]) ?? parseDate(row["Final Due Date"]),
      required_evidence: clean(row["Required Evidence"]),
      department: clean(row.Owner_Dept_l2) ?? clean(row.Owner_Dept_L3),
      closure_remarks: clean(row.Closure_Remarks),
      reschedule_count: Number(clean(row["Reschedule Count"]) ?? "0") || 0,
      created_by_id: createdById,
      created_via: "Migration",
    },
    select: { id: true },
  });
}

async function main() {
  const systemUser = await prisma.users.findUnique({
    where: { email: "lakshmi.bichu@regentmarkets.com" },
    select: { id: true },
  });

  if (!systemUser) {
    throw new Error("Lakshmi Bichu user record was not found. Run prisma db seed first.");
  }

  const rows = parseCsv(readFileSync(getDataPath(), "utf8").replace(/^\uFEFF/, ""));
  const auditGroups = new Map<string, CsvRow[]>();

  for (const row of rows) {
    const auditName = clean(row.Audit_Name);

    if (!auditName) {
      continue;
    }

    const auditType = parseAuditType(row.Audit_Type);
    const key = `${normalizeKey(auditName)}::${auditType}`;
    const group = auditGroups.get(key) ?? [];
    group.push(row);
    auditGroups.set(key, group);
  }

  let auditCount = 0;
  let findingCount = 0;
  let actionPlanCount = 0;
  let ownerCount = 0;

  for (const rowsForAudit of auditGroups.values()) {
    const auditName = clean(rowsForAudit[0]?.Audit_Name);

    if (!auditName) {
      continue;
    }

    const auditType = parseAuditType(rowsForAudit[0]?.Audit_Type);
    const audit = await findOrCreateAudit(
      auditName,
      auditType,
      systemUser.id,
      rowsForAudit,
    );
    auditCount += 1;

    const findingGroups = new Map<string, CsvRow[]>();

    for (const row of rowsForAudit) {
      const findingTitle = clean(row["Audit Finding Title"]);

      if (!findingTitle) {
        continue;
      }

      const group = findingGroups.get(findingTitle) ?? [];
      group.push(row);
      findingGroups.set(findingTitle, group);
    }

    let displayOrder = 1;

    for (const [findingTitle, rowsForFinding] of findingGroups.entries()) {
      const finding = await findOrCreateFinding(
        audit.id,
        findingTitle,
        systemUser.id,
        rowsForFinding[0],
        displayOrder,
      );
      findingCount += 1;
      displayOrder += 1;

      for (const row of rowsForFinding) {
        const actionPlan = await findOrCreateActionPlan(
          finding.id,
          systemUser.id,
          row,
        );
        actionPlanCount += 1;

        const owner = await findOwner(clean(row["Action Owner"]));

        if (!owner) {
          continue;
        }

        const existingOwner = await prisma.action_plan_owners.findFirst({
          where: {
            action_plan_id: actionPlan.id,
            user_id: owner.id,
          },
          select: { id: true },
        });

        if (!existingOwner) {
          await prisma.action_plan_owners.create({
            data: {
              action_plan_id: actionPlan.id,
              user_id: owner.id,
              assigned_by_id: systemUser.id,
              is_primary: true,
            },
          });
          ownerCount += 1;
        }
      }
    }
  }

  console.log(
    `AppSheet import completed: ${auditCount} audit groups, ${findingCount} finding groups, ${actionPlanCount} action plan rows, ${ownerCount} new owner links.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
