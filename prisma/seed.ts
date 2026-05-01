import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const BCRYPT_COST = 12;
const INTERNAL_AUDIT_TEAM_L1 = "Internal Audit";
const INTERNAL_AUDIT_TEAM_L3 = "AI - Internal Audit";

const adapter = new PrismaPg(
  process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/ia_remediation",
);
const prisma = new PrismaClient({ adapter });

type CsvRow = Record<string, string>;

function clean(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: string | undefined) {
  return clean(value)?.toLowerCase() ?? null;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function parseCsv(filePath: string) {
  const content = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = parseCsvLine(lines[0] ?? "").map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);

    return headers.reduce<CsvRow>((row, header, index) => {
      row[header] = values[index]?.trim() ?? "";
      return row;
    }, {});
  });
}

function getDataPath(fileName: string) {
  const candidates = [
    path.join(process.cwd(), "scripts", "data", fileName),
    path.resolve(process.cwd(), "..", "ia_remediation", "scripts", "data", fileName),
  ];
  const foundPath = candidates.find((candidate) => existsSync(candidate));

  if (!foundPath) {
    throw new Error(`Could not find data file: ${fileName}`);
  }

  return foundPath;
}

function parseDate(value: string | undefined) {
  const raw = clean(value);

  if (!raw) {
    return null;
  }

  const separator = raw.includes("/") ? "/" : raw.includes("-") ? "-" : null;

  if (!separator) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parts = raw.split(separator).map((part) => Number(part));

  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  const [first, second, year] = parts;
  const day = separator === "-" || first > 12 ? first : second;
  const month = separator === "-" || first > 12 ? second : first;
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isInternalAudit(row: CsvRow) {
  return (
    clean(row["Team Level 1"]) === INTERNAL_AUDIT_TEAM_L1 ||
    clean(row["Team Level 3"]) === INTERNAL_AUDIT_TEAM_L3
  );
}

async function hashRandomPassword() {
  return bcrypt.hash(randomBytes(32).toString("hex"), BCRYPT_COST);
}

async function seedNamedUsers() {
  const demoPassword = process.env.DEMO_PASSWORD;

  if (!demoPassword) {
    throw new Error("DEMO_PASSWORD is required to seed the demo auditee");
  }

  const lakshmiPasswordHash = await hashRandomPassword();
  const garyPasswordHash = await hashRandomPassword();
  const demoPasswordHash = await bcrypt.hash(demoPassword, BCRYPT_COST);

  await prisma.users.upsert({
    where: { email: "lakshmi.bichu@regentmarkets.com" },
    update: {
      name: "Lakshmi Bichu",
      role: "AuditTeam",
      is_admin: true,
      is_internal_auditor: true,
      team_l1: INTERNAL_AUDIT_TEAM_L1,
      password_must_change: true,
      is_active: true,
    },
    create: {
      email: "lakshmi.bichu@regentmarkets.com",
      name: "Lakshmi Bichu",
      role: "AuditTeam",
      is_admin: true,
      is_internal_auditor: true,
      team_l1: INTERNAL_AUDIT_TEAM_L1,
      password_must_change: true,
      password_hash: lakshmiPasswordHash,
      is_active: true,
    },
  });

  await prisma.users.upsert({
    where: { email: "gary@regentmarkets.com" },
    update: {
      name: "Gary Ross",
      role: "AuditTeam",
      is_admin: false,
      is_internal_auditor: true,
      team_l1: INTERNAL_AUDIT_TEAM_L1,
      password_must_change: true,
      is_active: true,
    },
    create: {
      email: "gary@regentmarkets.com",
      name: "Gary Ross",
      role: "AuditTeam",
      is_admin: false,
      is_internal_auditor: true,
      team_l1: INTERNAL_AUDIT_TEAM_L1,
      password_must_change: true,
      password_hash: garyPasswordHash,
      is_active: true,
    },
  });

  await prisma.users.upsert({
    where: { email: "auditee@deriv.com" },
    update: {
      name: "Demo Auditee",
      role: "Auditee",
      is_admin: false,
      is_internal_auditor: false,
      password_must_change: true,
      password_hash: demoPasswordHash,
      is_active: true,
    },
    create: {
      email: "auditee@deriv.com",
      name: "Demo Auditee",
      role: "Auditee",
      is_admin: false,
      is_internal_auditor: false,
      password_must_change: true,
      password_hash: demoPasswordHash,
      is_active: true,
    },
  });
}

async function seedEntities() {
  const rows = parseCsv(getDataPath("Deriv_Entities.csv"));

  for (const [index, row] of rows.entries()) {
    const code = clean(row.Entity);
    const fullName = clean(row.Entity_Name);

    if (!code || !fullName) {
      continue;
    }

    await prisma.entities.upsert({
      where: { code },
      update: {
        full_name: fullName,
        entity_id: clean(row.Entity_ID),
        country: clean(row.Country),
        group_category: clean(row.Remarks),
        display_order: index,
        is_active: true,
      },
      create: {
        code,
        full_name: fullName,
        entity_id: clean(row.Entity_ID),
        country: clean(row.Country),
        group_category: clean(row.Remarks),
        display_order: index,
        is_active: true,
      },
    });
  }
}

async function seedActiveUsers() {
  const rows = parseCsv(getDataPath("ActiveTMList04-27.csv"));

  for (const row of rows) {
    const email = normalizeEmail(row.Email);
    const employeeId = clean(row["Unique ID"]);

    if (!email) {
      continue;
    }

    if (
      email === "lakshmi.bichu@regentmarkets.com" ||
      email === "gary@regentmarkets.com"
    ) {
      continue;
    }

    const profileData = {
      employee_id: employeeId,
      email,
      name: clean(row.Name) ?? email,
      job_title: clean(row["Job Title"]),
      department: clean(row.Department),
      team_l1: clean(row["Team Level 1"]),
      team_l2: clean(row["Team Level 2"]),
      team_l3: clean(row["Team Level 3"]),
      company: clean(row.Company),
      location: clean(row.Location),
      manager_name: clean(row.Manager),
      employment_status: clean(row["Employment Status"]),
      is_active: true,
      last_working_date: null,
    };

    const existingUser = await prisma.users.findFirst({
      where: {
        OR: [
          ...(employeeId ? [{ employee_id: employeeId }] : []),
          { email },
        ],
      },
      select: { id: true },
    });

    if (existingUser) {
      await prisma.users.update({
        where: { id: existingUser.id },
        data: profileData,
      });
      continue;
    }

    const internalAuditUser = isInternalAudit(row);

    await prisma.users.create({
      data: {
        ...profileData,
        role: internalAuditUser ? "AuditTeam" : "Auditee",
        is_admin: false,
        is_internal_auditor: internalAuditUser,
        password_must_change: true,
        password_hash: await hashRandomPassword(),
      },
    });
  }
}

async function seedLeftUsers() {
  const rows = parseCsv(getDataPath("LeftTMList04-27.csv"));

  for (const row of rows) {
    const email = normalizeEmail(row.Email);
    const employeeId = clean(row["Unique ID"]);

    if (!email && !employeeId) {
      continue;
    }

    const user = await prisma.users.findFirst({
      where: {
        OR: [
          ...(employeeId ? [{ employee_id: employeeId }] : []),
          ...(email ? [{ email }] : []),
        ],
      },
      select: { id: true },
    });

    if (!user) {
      continue;
    }

    await prisma.users.update({
      where: { id: user.id },
      data: {
        is_active: false,
        employment_status: "Left",
        last_working_date: parseDate(row["Last Working Date"]),
      },
    });
  }
}

async function main() {
  await seedNamedUsers();
  await seedEntities();
  await seedActiveUsers();
  await seedLeftUsers();

  const [userCount, entityCount] = await Promise.all([
    prisma.users.count(),
    prisma.entities.count(),
  ]);

  console.log(`Seed completed: ${userCount} users, ${entityCount} entities.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
