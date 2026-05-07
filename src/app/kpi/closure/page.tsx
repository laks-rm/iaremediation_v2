"use client";

import { Suspense } from "react";

import AppLayout from "../../../components/AppLayout";
import ClosureKpiPage from "../../../components/kpi/ClosureKpiPage";

function ClosureKpiFallback() {
  return (
    <div className="insights-page">
      <p className="closure-empty" style={{ marginTop: 24 }}>
        Loading closure KPIs…
      </p>
    </div>
  );
}

export default function KpiClosurePage() {
  return (
    <AppLayout>
      <Suspense fallback={<ClosureKpiFallback />}>
        <ClosureKpiPage />
      </Suspense>
    </AppLayout>
  );
}
