import type { ComponentPropsWithoutRef } from "react";
import { LIST_PAGE_SIZES } from "@/lib/list-pagination";
import styles from "./page-size-select.module.css";

export function PageSizeSelect({ label = "每页条数", ...select }: {
  label?: string;
} & Pick<ComponentPropsWithoutRef<"select">, "name" | "value" | "defaultValue" | "onChange">) {
  return (
    <label className={styles.control}>
      <span>{label}</span>
      <select {...select} className="select select-sm">
        {LIST_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
      </select>
    </label>
  );
}
