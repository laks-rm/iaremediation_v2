import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../../lib/auth/getCurrentUser";
import { prisma } from "../../../../../../lib/db/prisma";
import {
  ALL_DIMENSIONS,
  ClosureDimension,
  getClosureKpiDrillDown,
} from "../../../../../../lib/kpi/closure";

import { parsePeriod } from "../route";

const DIMENSION_ERROR = `dimension must be one of: ${ALL_DIMENSIONS.join(", ")}`;

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const period = parsePeriod(searchParams);

  if ("error" in period) {
    return NextResponse.json({ error: period.error }, { status: 400 });
  }

  const dimensionParam = searchParams.get("dimension");
  const dimensionValue = searchParams.get("dimension_value");

  if (!dimensionParam || !ALL_DIMENSIONS.includes(dimensionParam as ClosureDimension)) {
    return NextResponse.json({ error: DIMENSION_ERROR }, { status: 400 });
  }

  const dimension = dimensionParam as ClosureDimension;

  if (dimensionValue === null || dimensionValue.trim() === "") {
    return NextResponse.json({ error: "dimension_value is required" }, { status: 400 });
  }

  const includeOfi = searchParams.get("include_ofi") === "true";

  try {
    const result = await getClosureKpiDrillDown(dimension, dimensionValue.trim(), period, prisma, includeOfi);

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Failed to compute drill-down" }, { status: 500 });
  }
}
