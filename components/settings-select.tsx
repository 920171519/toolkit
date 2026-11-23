"use client";

import { Search } from "lucide-react";
import { useId, useRef, useState } from "react";
import { DialogSurface } from "./form-dialog";
import styles from "./settings-select.module.css";

export function SettingsSelect({ name, label, options, defaultValue = "", required = true, dialogSearchPlaceholder }: {
  name: string;
  label: string;
  options: Array<{ id: number; label: string; keywords?: string }>;
  defaultValue?: number | "";
  required?: boolean;
  dialogSearchPlaceholder?: string;
}) {
  const inputId = useId();
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(String(defaultValue));
  const search = query.normalize("NFKC").trim().toLowerCase();
  const matching = options.filter((option) => `${option.label} ${option.keywords ?? ""}`.normalize("NFKC").toLowerCase().includes(search));
  const selection = options.find((option) => String(option.id) === selected);
  const available = dialogSearchPlaceholder ? options :
    selection && !matching.includes(selection) ? [selection, ...matching] : matching;
  const searchLabel = `搜索${label}`;

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
  }

  const searchInput = (
    <input
      className="input"
      type="search"
      aria-label={searchLabel}
      placeholder={dialogSearchPlaceholder ?? searchLabel}
      value={query}
      data-dialog-autofocus={dialogSearchPlaceholder ? true : undefined}
      onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }}
    />
  );
  return (
    <div className={`field ${styles.field}`}>
      <label className="label" htmlFor={inputId}>{label}{required && <span className="required-mark" aria-hidden="true"> *</span>}</label>
      {!dialogSearchPlaceholder && options.length > 8 && searchInput}
      <div className={styles.controls}>
        <select id={inputId} className="select" name={name} required={required} value={selected} title={selection?.label} onChange={(event) => setSelected(event.target.value)}>
          <option value="" disabled={required}>请选择{label}</option>
          {available.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        {dialogSearchPlaceholder && options.length > 0 && (
          <button ref={searchTrigger} type="button" className={`button button-secondary ${styles.searchTrigger}`}
            aria-label={searchLabel} aria-haspopup="dialog" onClick={() => setSearchOpen(true)}>
            <Search size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {!dialogSearchPlaceholder && search && matching.length === 0 && <small className="muted" role="status">没有匹配项</small>}
      {searchOpen && (
        <DialogSurface title={searchLabel} onClose={closeSearch} returnFocus={searchTrigger}>
          {searchInput}
          {matching.length > 0 ? <ul className={styles.results}>
            {matching.map((option) => (
              <li key={option.id}>
                <button type="button" className={styles.option} aria-current={selection?.id === option.id || undefined}
                  onClick={() => { setSelected(String(option.id)); closeSearch(); }}>
                  {option.label}
                </button>
              </li>
            ))}
          </ul> : <p className={`small muted ${styles.empty}`} role="status">没有匹配项</p>}
        </DialogSurface>
      )}
    </div>
  );
}
