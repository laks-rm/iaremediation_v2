"use client";

import { useEffect, useRef, useState } from "react";

export type EntityMultiSelectOption = {
  id: string;
  code: string;
  full_name: string;
};

export type EntityMultiSelectProps = {
  entities: EntityMultiSelectOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

export default function EntityMultiSelect({
  entities,
  selectedIds,
  onChange,
}: EntityMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedEntities = entities.filter((entity) => selectedIds.includes(entity.id));
  const filteredEntities = entities.filter((entity) =>
    [entity.code, entity.full_name].join(" ").toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  function toggleEntity(entityId: string, checked: boolean) {
    if (checked) {
      onChange(selectedIds.includes(entityId) ? selectedIds : [...selectedIds, entityId]);
      return;
    }

    onChange(selectedIds.filter((id) => id !== entityId));
  }

  return (
    <div className="entity-multiselect" ref={containerRef}>
      <button
        className={isOpen ? "entity-multiselect__trigger entity-multiselect__trigger--open" : "entity-multiselect__trigger"}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        {selectedEntities.length > 0 ? (
          selectedEntities.map((entity) => (
            <span className="entity-multiselect__badge" key={entity.id}>
              {entity.code}
            </span>
          ))
        ) : (
          <span className="entity-multiselect__placeholder">Select entities...</span>
        )}
      </button>
      {isOpen ? (
        <div className="entity-multiselect__panel">
          <div className="entity-multiselect__search">
            <input
              autoFocus
              placeholder="Search entities..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {filteredEntities.map((entity) => (
            <label className="entity-multiselect__option" key={entity.id}>
              <input
                checked={selectedIds.includes(entity.id)}
                onChange={(event) => toggleEntity(entity.id, event.target.checked)}
                type="checkbox"
              />
              <span className="entity-multiselect__option-text">
                <strong>{entity.code}</strong>
                <em>{entity.full_name}</em>
              </span>
            </label>
          ))}
          <div className="entity-multiselect__footer">
            <span>{selectedIds.length} selected</span>
            <button
              className="entity-multiselect__clear"
              onClick={() => onChange([])}
              type="button"
            >
              Clear all
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
