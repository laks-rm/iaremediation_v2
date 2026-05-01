"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AppLayout from "../../../components/AppLayout";
import ConfirmDialog from "../../../components/ConfirmDialog";
import EmptyState from "../../../components/EmptyState";
import { useToast } from "../../../components/Toast";

type ExtractionListItem = {
  id: string;
  filename: string;
  status: "Pending" | "Approved" | "Rejected";
  created_at: string;
  created_by: {
    name: string;
  };
  finding_count: number;
  action_plan_count: number;
  created_audit_id: string | null;
};

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function responseError(body: unknown, fallback: string) {
  return typeof body === "object" && body && "error" in body ? String(body.error) : fallback;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusClass(status: string) {
  return `ai-status ai-status--${status.toLowerCase()}`;
}

export default function ExtractionsPage() {
  const toast = useToast();
  const [extractions, setExtractions] = useState<ExtractionListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [rejectId, setRejectId] = useState("");

  async function loadExtractions() {
    setIsLoading(true);
    const response = await fetch("/api/v1/ai/extractions");
    const body = await readResponseBody(response);
    if (!response.ok) {
      setError(responseError(body, "Unable to load extractions."));
      setIsLoading(false);
      return;
    }
    setExtractions((body as { extractions: ExtractionListItem[] }).extractions);
    setIsLoading(false);
  }

  useEffect(() => {
    loadExtractions().catch(() => {
      setError("Unable to load extractions.");
      setIsLoading(false);
    });
  }, []);

  async function approve(id: string) {
    const response = await fetch(`/api/v1/ai/extractions/${id}/approve`, { method: "POST" });
    const body = await readResponseBody(response);
    if (!response.ok) {
      setError(responseError(body, "Unable to approve extraction."));
      return;
    }
    toast.success("Extraction approved.");
    await loadExtractions();
  }

  async function reject() {
    if (!rejectId) return;
    const reason = "Rejected from extraction list";
    const response = await fetch(`/api/v1/ai/extractions/${rejectId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      setError(responseError(body, "Unable to reject extraction."));
      return;
    }
    toast.success("Extraction rejected.");
    setRejectId("");
    await loadExtractions();
  }

  return (
    <AppLayout>
      <div className="ai-page">
        <header className="ai-header">
          <div>
            <p>AI extractions</p>
            <h1>Extraction Review Queue</h1>
            <span>Review, approve, or reject extracted audit reports.</span>
          </div>
          <Link className="button button--primary" href="/ai/ingest">
            Upload Report
          </Link>
        </header>

        {error ? (
          <div className="auth-error inline-error-banner">
            <span>{error}</span>
            <button className="button" onClick={loadExtractions} type="button">Retry</button>
          </div>
        ) : null}

        <section className="ai-table-card">
          <div className="ai-table ai-table--wide">
            <div className="ai-table__head">
              <span>Filename</span>
              <span>Status</span>
              <span>Created By</span>
              <span>Created At</span>
              <span>Counts</span>
              <span>Actions</span>
            </div>
            {isLoading
              ? Array.from({ length: 5 }, (_, index) => (
                  <div className="ai-table__row audits-row--skeleton" key={index}>
                    {Array.from({ length: 6 }, (_item, cellIndex) => <span key={cellIndex} />)}
                  </div>
                ))
              : null}
            {!isLoading && extractions.length === 0 ? (
              <EmptyState
                actionHref="/ai/ingest"
                actionLabel="Upload Report"
                subtitle="Upload an audit report PDF to begin AI extraction."
                title="No extractions yet"
              />
            ) : null}
            {extractions.map((extraction) => (
              <div className="ai-table__row" key={extraction.id}>
                <span>{extraction.filename}</span>
                <span className={statusClass(extraction.status)}>{extraction.status}</span>
                <span>{extraction.created_by.name}</span>
                <span>{formatDate(extraction.created_at)}</span>
                <span>
                  {extraction.finding_count} findings / {extraction.action_plan_count} action plans
                </span>
                <span className="ai-actions">
                  <Link href={`/ai/extractions/${extraction.id}`}>View</Link>
                  {extraction.status === "Pending" ? (
                    <>
                      <button onClick={() => approve(extraction.id)} type="button">
                        Approve
                      </button>
                      <button onClick={() => setRejectId(extraction.id)} type="button">
                        Reject
                      </button>
                    </>
                  ) : null}
                  {extraction.created_audit_id ? (
                    <Link href={`/audits/${extraction.created_audit_id}`}>Audit</Link>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </section>
        <ConfirmDialog
          cancelLabel="Cancel"
          confirmLabel="Reject"
          isDangerous
          isOpen={Boolean(rejectId)}
          message="This will mark the extraction as rejected."
          title="Reject extraction?"
          onCancel={() => setRejectId("")}
          onConfirm={reject}
        />
      </div>
    </AppLayout>
  );
}
