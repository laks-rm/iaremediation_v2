async function main() {
  process.loadEnvFile?.(".env");

  const { prisma } = await import("../src/lib/db/prisma");
  const {
    AI_INSIGHT_ANALYSERS,
    analyseApproachingVelocityWall,
    analyseClosedWithWeakRemarks,
    analyseClosedWithoutEvidence,
    analyseDomainRescheduleOutliers,
    analyseHighPriorityEntityConcentration,
    analyseHighPriorityOverdueDepartmentConcentration,
    analyseLikelyToSlip,
    analyseNextQuarterCalendarConcentration,
    analyseOwnerLoadImbalance,
    analyseOwnersWithoutRecentActivity,
    analyseRepeatedReschedules,
    analyseStaleInProgressItems,
    analyseThematicOpenFindingClusters,
    analyseThemesMitigatedLast90Days,
    analyseUnusualClosureSpeed,
    analyseVelocityTrend,
    runAiInsightsAnalysers,
  } = await import("../src/lib/ai/insights/analyzers");

  const namedAnalysers = [
    ["analyseThematicOpenFindingClusters", analyseThematicOpenFindingClusters],
    ["analyseHighPriorityEntityConcentration", analyseHighPriorityEntityConcentration],
    ["analyseHighPriorityOverdueDepartmentConcentration", analyseHighPriorityOverdueDepartmentConcentration],
    ["analyseOwnerLoadImbalance", analyseOwnerLoadImbalance],
    ["analyseStaleInProgressItems", analyseStaleInProgressItems],
    ["analyseClosedWithoutEvidence", analyseClosedWithoutEvidence],
    ["analyseClosedWithWeakRemarks", analyseClosedWithWeakRemarks],
    ["analyseRepeatedReschedules", analyseRepeatedReschedules],
    ["analyseLikelyToSlip", analyseLikelyToSlip],
    ["analyseApproachingVelocityWall", analyseApproachingVelocityWall],
    ["analyseNextQuarterCalendarConcentration", analyseNextQuarterCalendarConcentration],
    ["analyseDomainRescheduleOutliers", analyseDomainRescheduleOutliers],
    ["analyseOwnersWithoutRecentActivity", analyseOwnersWithoutRecentActivity],
    ["analyseUnusualClosureSpeed", analyseUnusualClosureSpeed],
    ["analyseThemesMitigatedLast90Days", analyseThemesMitigatedLast90Days],
    ["analyseVelocityTrend", analyseVelocityTrend],
  ] as const;

  const mode = process.argv[2] ?? "summary";

  if (mode === "by-analyser") {
    const output = [];
    for (const [name, analyser] of namedAnalysers) {
      const results = await analyser(prisma);
      output.push({
        analyser: name,
        count: results.length,
        sample: results[0] ?? null,
      });
    }
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const cards = await runAiInsightsAnalysers(prisma);
  const samplesByCategory = cards.reduce<Record<string, unknown>>((samples, card) => {
    if (!samples[card.insightType]) samples[card.insightType] = card;
    return samples;
  }, {});

  console.log(
    JSON.stringify(
      {
        analyser_count: AI_INSIGHT_ANALYSERS.length,
        total_cards: cards.length,
        counts_by_category: cards.reduce<Record<string, number>>((counts, card) => {
          counts[card.insightType] = (counts[card.insightType] ?? 0) + 1;
          return counts;
        }, {}),
        samples_by_category: samplesByCategory,
      },
      null,
      2,
    ),
  );
    await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export {};
