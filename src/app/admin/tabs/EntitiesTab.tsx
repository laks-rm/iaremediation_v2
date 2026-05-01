"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

import EmptyState from "../../../components/EmptyState";
import { useToast } from "../../../components/Toast";
import { EntityRecord, ErrorBanner, LoadingRows, SlideOver, parseCsv, readResponseBody, responseError } from "./admin-tab-utils";

const emptyEntity: Partial<EntityRecord> = { code: "", entity_id: "", full_name: "", country: "", group_category: "", display_order: 0, is_active: true };

export default function EntitiesTab() {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [entities, setEntities] = useState<EntityRecord[]>([]);
  const [editingEntity, setEditingEntity] = useState<Partial<EntityRecord> | null>(null);
  const [preview, setPreview] = useState<Record<string, string>[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => { loadEntities(); }, []);

  async function loadEntities() {
    setIsLoading(true);
    const response = await fetch("/api/v1/admin/entities");
    const body = await readResponseBody(response);
    if (!response.ok) setError(responseError(body, "Unable to load entities."));
    else setEntities((body as { entities: EntityRecord[] }).entities);
    setIsLoading(false);
  }

  async function onCsvSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPreview(parseCsv(await file.text()));
    event.target.value = "";
  }

  async function importEntities() {
    if (!preview) return;
    const response = await fetch("/api/v1/admin/entities/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preview),
    });
    const body = await readResponseBody(response);
    if (!response.ok) setError(responseError(body, "Unable to import entities."));
    else {
      setPreview(null);
      toast.success("Entities imported.");
      await loadEntities();
    }
  }

  async function saveEntity() {
    if (!editingEntity) return;
    const nextErrors: Record<string, string> = {};
    if (!editingEntity.code?.trim()) nextErrors.code = "Code is required.";
    if (!editingEntity.full_name?.trim()) nextErrors.full_name = "Full name is required.";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const isEdit = Boolean(editingEntity.id);
    const response = await fetch(isEdit ? `/api/v1/admin/entities/${editingEntity.id}` : "/api/v1/admin/entities", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingEntity),
    });
    const body = await readResponseBody(response);
    if (!response.ok) setError(responseError(body, "Unable to save entity."));
    else {
      setEditingEntity(null);
      toast.success("Entity saved.");
      await loadEntities();
    }
  }

  async function toggleEntity(entity: EntityRecord) {
    setEntities((current) => current.map((item) => item.id === entity.id ? { ...item, is_active: !item.is_active } : item));
    await fetch(`/api/v1/admin/entities/${entity.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !entity.is_active }),
    });
  }

  return (
    <section className="admin-tab">
      <ErrorBanner message={error} onRetry={loadEntities} />
      <div className="admin-tab-toolbar">
        <strong>{entities.length} entities · {entities.filter((entity) => entity.is_active).length} active</strong>
        <div>
          <input hidden ref={inputRef} type="file" accept=".csv,text/csv" onChange={onCsvSelected} />
          <button className="button" onClick={() => inputRef.current?.click()} type="button">Import CSV</button>
          <button className="button button--primary" onClick={() => { setFieldErrors({}); setEditingEntity(emptyEntity); }} type="button">Add Entity</button>
        </div>
      </div>
      {preview ? <div className="admin-import-preview"><span>Previewing {preview.length} entities</span><button className="button button--primary" onClick={importEntities} type="button">Confirm</button><button className="button" onClick={() => setPreview(null)} type="button">Cancel</button></div> : null}
      <div className="admin-entities-table">
        <div className="admin-entities-head"><span>Code</span><span>Entity ID</span><span>Full Name</span><span>Country</span><span>Category</span><span>Active</span><span>Edit</span></div>
        {isLoading ? <LoadingRows /> : entities.map((entity) => (
          <div className="admin-entities-row" key={entity.id}>
            <span className="entity-code-badge">{entity.code}</span>
            <span className="audits-mono">{entity.entity_id ?? "—"}</span>
            <span>{entity.full_name}</span>
            <span>{entity.country ?? "—"}</span>
            <span className="entity-category-badge">{entity.group_category ?? "—"}</span>
            <button className="admin-switch" data-on={entity.is_active} onClick={() => toggleEntity(entity)} type="button" />
            <button className="admin-icon-button" onClick={() => { setFieldErrors({}); setEditingEntity(entity); }} type="button">✎</button>
          </div>
        ))}
        {!isLoading && entities.length === 0 ? (
          <EmptyState title="No entities found" subtitle="Add or import entities to make them available in audit records." />
        ) : null}
      </div>
      {editingEntity ? <EntityEditor errors={fieldErrors} entity={editingEntity} setEntity={(nextEntity) => { setEditingEntity(nextEntity); setFieldErrors((current) => ({ ...current, code: nextEntity.code?.trim() ? "" : current.code, full_name: nextEntity.full_name?.trim() ? "" : current.full_name })); }} onClose={() => setEditingEntity(null)} onSave={saveEntity} /> : null}
    </section>
  );
}

function EntityEditor({ entity, setEntity, onClose, onSave, errors }: { entity: Partial<EntityRecord>; setEntity: (entity: Partial<EntityRecord>) => void; onClose: () => void; onSave: () => void; errors: Record<string, string> }) {
  return <SlideOver title={entity.id ? "Edit Entity" : "Add Entity"} onClose={onClose}>
    <div className="admin-form">
      <input className={errors.code ? "input-error" : undefined} disabled={Boolean(entity.id)} placeholder="Code" value={entity.code ?? ""} onChange={(e) => setEntity({ ...entity, code: e.target.value })} />
      {errors.code ? <span className="field-error">{errors.code}</span> : null}
      <input placeholder="Entity ID" value={entity.entity_id ?? ""} onChange={(e) => setEntity({ ...entity, entity_id: e.target.value })} />
      <input className={errors.full_name ? "input-error" : undefined} placeholder="Full name" value={entity.full_name ?? ""} onChange={(e) => setEntity({ ...entity, full_name: e.target.value })} />
      {errors.full_name ? <span className="field-error">{errors.full_name}</span> : null}
      <input placeholder="Country" value={entity.country ?? ""} onChange={(e) => setEntity({ ...entity, country: e.target.value })} />
      <input placeholder="Group category" value={entity.group_category ?? ""} onChange={(e) => setEntity({ ...entity, group_category: e.target.value })} />
      <input type="number" placeholder="Display order" value={entity.display_order ?? 0} onChange={(e) => setEntity({ ...entity, display_order: Number(e.target.value) })} />
      <label><input checked={entity.is_active !== false} type="checkbox" onChange={(e) => setEntity({ ...entity, is_active: e.target.checked })} /> Active</label>
      <button className="button button--primary" onClick={onSave} type="button">Save</button>
    </div>
  </SlideOver>;
}
