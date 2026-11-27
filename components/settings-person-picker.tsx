"use client";

import { useId, useState } from "react";
import { wordSearchMatcher } from "@/lib/search-text";
import styles from "./settings-person-picker.module.css";

export type SettingsPerson = { id: number; label: string };

const initialLimit = 25;

export function SettingsPersonPicker({ name, label, options, defaultValue = "", required = true }: {
  name: string;
  label: string;
  options: SettingsPerson[];
  defaultValue?: number | "";
  required?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [selectedValue, setSelectedValue] = useState(String(defaultValue));
  const [limit, setLimit] = useState(initialLimit);
  const matchesSearch = wordSearchMatcher(query);
  const matching = options.filter((person) => matchesSearch(person.label));
  const selected = options.find((person) => String(person.id) === selectedValue);
  const visible = matching.slice(0, limit);
  if (selected && !visible.includes(selected)) visible.unshift(selected);

  return (
    <div className={styles.picker}>
      <label className="field" htmlFor={`${id}-search`}>
        <span className="sr-only">搜索{label}</span>
        <input id={`${id}-search`} className="input" type="search" placeholder="搜索姓名或工号" value={query} data-dialog-autofocus
          onChange={(event) => { setQuery(event.target.value); setLimit(initialLimit); }}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }} />
      </label>
      <fieldset className={styles.choices}>
        <legend className="label">{label}{required && <span className="required-mark" aria-hidden="true"> *</span>}</legend>
        <div className={styles.results}>
          {!required && <label className={styles.option}>
            <input type="radio" name={name} value="" checked={selectedValue === ""} onChange={() => setSelectedValue("")} />
            <span>不指定</span>
          </label>}
          {visible.map((person) => (
            <label className={styles.option} key={person.id}>
              <input type="radio" name={name} value={person.id} required={required}
                checked={selectedValue === String(person.id)} onChange={() => setSelectedValue(String(person.id))} />
              <span>{person.label}</span>
            </label>
          ))}
        </div>
        {matching.length === 0 && <p className="small muted" role="status">没有匹配的人员。</p>}
        {matching.length > limit && <button className="button button-ghost button-sm" type="button" onClick={() => setLimit(limit + initialLimit)}>
          显示更多（还有 {matching.length - limit} 人）
        </button>}
      </fieldset>
    </div>
  );
}
