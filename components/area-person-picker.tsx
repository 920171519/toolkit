"use client";

import { useEffect, useId, useRef, useState } from "react";
import { matchesDirectorySearch } from "@/lib/settings-directory";
import styles from "./area-person-picker.module.css";

export type AreaPersonOption = { id: number; name: string; employeeId: string };

const pageSize = 25;

export function AreaPersonPicker({ label, people }: { label: string; people: AreaPersonOption[] }) {
  const id = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number>();
  const [limit, setLimit] = useState(pageSize);
  const matches = people.filter((person) => matchesDirectorySearch(query, person.name, person.employeeId));
  const visible = matches.slice(0, limit);
  const selected = people.find((person) => person.id === selectedId);
  if (selected && !visible.includes(selected)) visible.unshift(selected);

  useEffect(() => {
    const trigger = document.activeElement;
    searchRef.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  return (
    <div className={styles.picker}>
      <label className="field" htmlFor={id}>
        <span className="label">搜索{label}</span>
        <input
          ref={searchRef}
          id={id}
          className="input"
          type="search"
          placeholder="姓名或工号"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setLimit(pageSize); }}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }}
        />
      </label>
      <fieldset className={styles.choices}>
        <legend className="label">{label}</legend>
        <div className={styles.results}>
          {visible.map((person) => (
            <label className={styles.option} key={person.id}>
              <input type="radio" name="userId" value={person.id} required checked={person.id === selectedId} onChange={() => setSelectedId(person.id)} />
              <span>{person.name} <small className="muted">{person.employeeId}</small></span>
            </label>
          ))}
          {matches.length === 0 && <p className="small muted" role="status">没有匹配的人员。</p>}
        </div>
        {matches.length > limit && <button className="button button-ghost button-sm" type="button" onClick={() => setLimit(limit + pageSize)}>
          显示更多（还有 {matches.length - limit} 人）
        </button>}
      </fieldset>
    </div>
  );
}
