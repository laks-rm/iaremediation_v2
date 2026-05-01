async function main() {
  process.loadEnvFile?.(".env");

  const { prisma } = await import("../src/lib/db/prisma");
  const { generateAiInsightsSnapshot } = await import("../src/lib/ai/insights/snapshot");

  try {
    const snapshot = await generateAiInsightsSnapshot({
      trigger: "manual",
      prismaClient: prisma,
    });
    console.log(JSON.stringify(snapshot, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export {};
