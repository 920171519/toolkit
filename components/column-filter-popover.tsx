"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListFilter, X } from "lucide-react";
import { columnFilterKeys, readColumnFilters, type ColumnFilterField } from "@/lib/column-filters";
import { normalizeSearchText } from "@/lib/search-text";
import { directoryHref } from "@/lib/settings-directory";
import styles from "./column-filter-header.module.css";

type Params = Record<string, string | undefined>;

function ChoiceInputs({ field, selectedValue }: { field: ColumnFilterField; selectedValue?: string }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Set(selectedValue?.split(",") ?? []));
  const options = field.options ?? [];
  const query = normalizeSearchText(search.trim());
  const visible = options.filter(({ label }) => normalizeSearchText(label).includes(query));
  const allSelected = visible.length > 0 && visible.every(({ value }) => selected.has(value));

  function toggle(values: string[], checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const value of values) {
        if (checked) next.add(value);
        else next.delete(value);
      }
      return next;
    });
  }

  return (
    <>
      <div className={styles.optionToolbar}>
        <input
          className="input"
          type="search"
          aria-label={`查找${field.label}选项`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
          placeholder="查找选项"
        />
        <button className="button button-ghost button-sm" type="button" disabled={!visible.length} onClick={() => toggle(visible.map(({ value }) => value), !allSelected)}>
          {allSelected ? "取消全选" : "全选"}
        </button>
      </div>
      <ul className={styles.options}>
        {visible.map(({ value, label }) => (
          <li key={value}>
            <label>
              <input type="checkbox" checked={selected.has(value)} onChange={(event) => toggle([value], event.target.checked)} />
              <span>{label}</span>
            </label>
          </li>
        ))}
        {!visible.length && <li className="small muted">没有匹配的选项</li>}
      </ul>
      {[...selected].map((value) => <input key={value} type="hidden" name={`f_${field.key}`} value={value} />)}
    </>
  );
}

function RangeInputs({ field, params }: { field: ColumnFilterField; params: Params }) {
  const [name, second] = columnFilterKeys(field);
  const [lower, setLower] = useState(params[name] ?? "");
  const [upper, setUpper] = useState(params[second] ?? "");
  const isDate = field.kind === "date";
  const lowerLabel = isDate ? "起始日期" : "最小值";
  const upperLabel = isDate ? "截止日期" : "最大值";
  const type = isDate ? "date" : "number";
  const minimum = isDate ? undefined : 0;
  const maximum = isDate ? undefined : Number.MAX_SAFE_INTEGER;

  return (
    <div className={styles.range}>
      <label className="field">
        <span className="label">{lowerLabel}</span>
        <input className="input" name={name} type={type} min={minimum} max={upper || maximum} aria-label={field.label + lowerLabel} value={lower} onChange={(event) => setLower(event.target.value)} />
      </label>
      <label className="field">
        <span className="label">{upperLabel}</span>
        <input className="input" name={second} type={type} min={lower || minimum} max={maximum} aria-label={field.label + upperLabel} value={upper} onChange={(event) => setUpper(event.target.value)} />
      </label>
    </div>
  );
}

function FilterInputs({ field, params }: { field: ColumnFilterField; params: Params }) {
  const [name, second] = columnFilterKeys(field);
  if (field.kind === "choices") return <ChoiceInputs field={field} selectedValue={params[name]} />;
  if (field.kind === "number" || field.kind === "date") return <RangeInputs field={field} params={params} />;

  return (
    <div className={styles.textFields}>
      <select className="select" name={second} aria-label={`${field.label}匹配方式`} defaultValue={params[second] ?? ""}>
        <option value="">包含</option>
        <option value="exact">精确匹配</option>
      </select>
      <input className="input" name={name} type="text" aria-label={field.label} maxLength={120} defaultValue={params[name]} />
    </div>
  );
}

export function ColumnFilterPopover({ label, path, params, otherParams, fields, active, hash, onFilterChange }: {
  label: string;
  path: string;
  params: Params;
  otherParams: Params;
  fields: ColumnFilterField[];
  active: boolean;
  hash: string;
  onFilterChange?: (filters: Record<string, string>) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const accessibleName = `筛选${label}`;

  useEffect(() => {
    const button = trigger.current;
    const panel = menu.current;
    if (!open || !button || !panel) return;
    const anchor = button;
    const popover = panel;
    const viewport = window.visualViewport;

    function reposition(event?: Event) {
      if (event?.target instanceof Node && popover.contains(event.target)) return;
      const rect = anchor.getBoundingClientRect();
      const edge = 8;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? document.documentElement.clientWidth;
      const viewportBottom = viewportTop + (viewport?.height ?? document.documentElement.clientHeight);
      if (rect.right <= viewportLeft || rect.left >= viewportLeft + viewportWidth || rect.bottom <= viewportTop || rect.top >= viewportBottom) {
        popover.hidePopover();
        return;
      }

      const left = Math.min(rect.left, viewportLeft + viewportWidth - popover.offsetWidth - edge);
      const below = viewportBottom - rect.bottom - edge * 2;
      const above = rect.top - viewportTop - edge * 2;
      const opensBelow = below >= Math.min(popover.scrollHeight, 280) || below >= above;
      popover.style.left = `${Math.max(viewportLeft + edge, left)}px`;
      popover.style.maxHeight = `${Math.min(440, Math.max(0, opensBelow ? below : above))}px`;
      popover.style.top = opensBelow ? `${rect.bottom + edge}px` : "auto";
      popover.style.bottom = opensBelow ? "auto" : `${document.documentElement.clientHeight - rect.top + edge}px`;
    }

    reposition();
    heading.current?.focus({ preventScroll: true });
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    viewport?.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      viewport?.removeEventListener("resize", reposition);
    };
  }, [open]);

  function closeAndFocus() {
    menu.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const rawFilters = Object.fromEntries(fields.flatMap((field) => columnFilterKeys(field).map((key) => {
      const values = data.getAll(key).map(String);
      return [key, field.kind === "choices" ? values : values[0]];
    })));
    const next = readColumnFilters(rawFilters, fields);
    closeAndFocus();
    if (onFilterChange) onFilterChange(next);
    else router.push(directoryHref(path, { ...otherParams, ...next }) + hash, { scroll: false });
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={accessibleName}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-filtered={active || undefined}
        popoverTarget={id}
        title={active ? `${accessibleName}（已筛选）` : accessibleName}
      >
        <ListFilter size={16} aria-hidden="true" />
      </button>
      <form
        ref={menu}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={accessibleName}
        className={styles.menu}
        action={path}
        method="get"
        onSubmit={apply}
        onToggle={(event) => setOpen(event.newState === "open")}
      >
        <header className={styles.menuHeader}>
          <h2 ref={heading} tabIndex={-1}>{accessibleName}</h2>
          <button className="button button-ghost button-icon" aria-label="关闭筛选" type="button" onClick={closeAndFocus}><X size={16} /></button>
        </header>
        <div className={styles.menuBody}>
          {Object.entries(otherParams).map(([name, value]) => value ? <input key={name} type="hidden" name={name} value={value} /> : null)}
          {open && fields.map((field) => (
            <fieldset key={field.key} className={styles.fieldset}>
              <legend>{field.label}</legend>
              <FilterInputs field={field} params={params} />
            </fieldset>
          ))}
        </div>
        <footer className={styles.menuFooter}>
          {onFilterChange ? (
            <button type="button" className="button button-ghost" onClick={() => {
              closeAndFocus();
              onFilterChange({});
            }}>清除本列</button>
          ) : (
            <Link className="button button-ghost" href={directoryHref(path, otherParams) + hash} prefetch={false} scroll={false} onClick={closeAndFocus}>清除本列</Link>
          )}
          <button type="submit" className="button button-primary">应用</button>
        </footer>
      </form>
    </>
  );
}
