"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, DragEvent, useEffect, useState } from "react";

import AppLayout from "../../../components/AppLayout";

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

function formatFileSize(size: number) {
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function statusClass(status: string) {
  return `ai-status ai-status--${status.toLowerCase()}`;
}

export default function AiIngestPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [recentExtractions, setRecentExtractions] = useState<ExtractionListItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/v1/ai/extractions")
      .then(async (response) => {
        const body = await readResponseBody(response);
        if (!response.ok) return [];
        return (body as { extractions: ExtractionListItem[] }).extractions;
      })
      .then((items) => setRecentExtractions(items.slice(0, 6)))
      .catch(() => setRecentExtractions([]));
  }, []);

  function selectFile(nextFile: File | null) {
    if (!nextFile) {
      setFile(null);
      return;
    }

    if (nextFile.type !== "application/pdf" || !nextFile.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are accepted.");
      return;
    }

    if (nextFile.size > 50 * 1024 * 1024) {
      setError("PDF must be under 50MB.");
      return;
    }

    setError("");
    setFile(nextFile);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    selectFile(event.dataTransfer.files[0] ?? null);
  }

  async function upload() {
    if (!file) {
      setError("Select a PDF report first.");
      return;
    }

    setIsUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/v1/ai/ingest", {
        method: "POST",
        body: formData,
      });
      const body = await readResponseBody(response);
      if (!response.ok) {
        throw new Error(responseError(body, "Unable to extract report."));
      }

      const extractionId =
        body && typeof body === "object" && "extraction_id" in body
          ? String(body.extraction_id)
          : "";
      router.push(`/ai/extractions/${extractionId}`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to extract report.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <AppLayout>
      <div className="ai-page">
        <header className="ai-header">
          <div>
            <p>AI ingestion</p>
            <h1>Extract an Audit Report</h1>
            <span>Upload a PDF and review structured audit data before creating records.</span>
          </div>
          <Link className="button" href="/ai/extractions">
            View All Extractions
          </Link>
        </header>

        {error ? <div className="auth-error">{error}</div> : null}

        <section className="ai-upload-card">
          <div className="records-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            <strong>Drag and drop an audit report PDF</strong>
            <span>PDF only, maximum 50MB. Extraction can take 15-30 seconds.</span>
            <input
              accept="application/pdf,.pdf"
              onChange={(event: ChangeEvent<HTMLInputElement>) => selectFile(event.target.files?.[0] ?? null)}
              type="file"
            />
            {file ? (
              <p>
                Selected: <strong>{file.name}</strong> ({formatFileSize(file.size)})
              </p>
            ) : null}
          </div>
          <button className="button button--primary" disabled={isUploading || !file} onClick={upload} type="button">
            {isUploading ? "Extracting from report..." : "Upload and Extract"}
          </button>
          {isUploading ? (
            <div className="ai-progress">
              <span />
              Extracting from report…
            </div>
          ) : null}
        </section>

        <section className="ai-table-card">
          <header className="ai-section-header">
            <h2>Recent Extractions</h2>
          </header>
          <div className="ai-table">
            <div className="ai-table__head">
              <span>Filename</span>
              <span>Status</span>
              <span>Date</span>
              <span>View</span>
            </div>
            {recentExtractions.map((extraction) => (
              <div className="ai-table__row" key={extraction.id}>
                <span>{extraction.filename}</span>
                <span className={statusClass(extraction.status)}>{extraction.status}</span>
                <span>{formatDate(extraction.created_at)}</span>
                <Link href={`/ai/extractions/${extraction.id}`}>View →</Link>
              </div>
            ))}
            {recentExtractions.length === 0 ? <div className="audits-empty">No extractions yet.</div> : null}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
