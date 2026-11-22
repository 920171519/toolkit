"use client";

import { useId, useState } from "react";

export function SettingsSelect({ name, label, options, defaultValue = "", required = true }: {
  name: string;
  label: string;
  options: Array<{ id: number; label: string; keywords?: string }>;
  defaultValue?: number | "";
  required?: boolean;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(String(defaultValue));
  const search = query.trim().toLowerCase();
  const matching = options.filter((option) => `${option.label} ${option.keywords ?? ""}`.toLowerCase().includes(search));
  const selection = options.find((option) => String(option.id) === selected);
  const available = selection && !matching.includes(selection) ? [selection, ...matching] : matching;

  return (
    <div className="field settings-select">
      <label className="label" htmlFor={inputId}>{label}{required && <span className="required-mark" aria-hidden="true"> *</span>}</label>
      {options.length > 8 && <input
        className="input"
        type="search"
        aria-label={`搜索${label}`}
        placeholder={`搜索${label}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }}
      />}
      <select id={inputId} className="select" name={name} required={required} value={selected} onChange={(event) => setSelected(event.target.value)}>
        <option value="" disabled={required}>请选择{label}</option>
        {available.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      {search && matching.length === 0 && <small className="muted" role="status">没有匹配项</small>}
    </div>
  );
}
