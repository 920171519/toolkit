"use client";

import { Search } from "lucide-react";
import { useId, useState } from "react";

type ContactOption = { id: number; name: string; employeeId: string };

export function ProjectContactPicker({
  label,
  name,
  options,
  defaultSelectedIds = [],
  className = "",
}: {
  label: string;
  name: "pmUserIds" | "softwareManagerIds";
  options: ContactOption[];
  defaultSelectedIds?: number[];
  className?: string;
}) {
  const labelId = useId();
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set(
    options.map(({ id }) => id).filter((id) => defaultSelectedIds.includes(id)),
  ));
  const keyword = search.trim().toLowerCase();
  const matchingIds = new Set(
    options
      .filter(({ name, employeeId }) => `${name} ${employeeId}`.toLowerCase().includes(keyword))
      .map(({ id }) => id),
  );

  return (
    <div className={`field ${className}`} role="group" aria-labelledby={labelId}>
      <span id={labelId} className="label">
        {label} <span className="required-mark" aria-hidden="true">*</span>
        <span className="sr-only">（必填）</span>
      </span>
      <label className="input package-search-input">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          autoComplete="off"
          aria-label={`搜索${label}`}
          placeholder="姓名或工号"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault();
          }}
        />
      </label>
      {matchingIds.size === 0 && <span className="small muted" role="status">没有匹配的人员</span>}
      <div className="person-check-grid">
        {options.map((person) => {
          const checked = selectedIds.has(person.id);
          return (
            <label className="person-check" key={person.id} hidden={!checked && !matchingIds.has(person.id)}>
              <input
                type="checkbox"
                name={name}
                value={person.id}
                checked={checked}
                onChange={(event) => {
                  const selecting = event.target.checked;
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    if (selecting) next.add(person.id);
                    else next.delete(person.id);
                    return next;
                  });
                }}
              />
              <span>{person.name} · {person.employeeId}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
