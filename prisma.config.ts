declare const process: {
  env: {
    DATABASE_URL?: string;
  };
  loadEnvFile?: (path?: string) => void;
};

for (const envPath of [".env", "../ia_remediation/scripts/data/.env"]) {
  if (process.env.DATABASE_URL) {
    break;
  }

  try {
    process.loadEnvFile?.(envPath);
  } catch {
    // Try the next known env location, or allow the shell environment to provide DATABASE_URL.
  }
}

export default {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed:
      'ts-node --compiler-options {"module":"CommonJS"} prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
};
