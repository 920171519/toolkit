import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FormDialog } from "./form-dialog";
import styles from "./guidance-dialog.module.css";

export type GuidanceItem = {
  title: string;
  detail?: string;
  href?: string;
  actionLabel?: string;
};

export function GuidanceDialog({
  label,
  title,
  description,
  items,
  triggerClassName = "button button-secondary",
  fallbackHref,
}: {
  label: ReactNode;
  title: string;
  description?: string;
  items: readonly GuidanceItem[];
  triggerClassName?: string;
  fallbackHref?: string;
}) {
  return (
    <FormDialog label={label} title={title} description={description} triggerClassName={triggerClassName}
      fallbackHref={fallbackHref} cancelLabel="关闭" closeOnLinkClick>
      <ul className={styles.items}>
        {items.map((item) => (
          <li key={JSON.stringify(item)} className={styles.item}>
            <div className={styles.copy}>
              <strong>{item.title}</strong>
              {item.detail && <p>{item.detail}</p>}
            </div>
            {item.href && (
              <Link href={item.href} prefetch={false} className={styles.link}>
                {item.actionLabel ?? "查看记录"} <ArrowRight size={14} aria-hidden="true" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </FormDialog>
  );
}
