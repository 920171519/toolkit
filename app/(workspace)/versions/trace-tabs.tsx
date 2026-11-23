import Link from "next/link";
import { X } from "lucide-react";
import { packageIdentity } from "@/lib/package-identity";
import type { TraceVersionRow } from "@/lib/workflow-queries";
import { traceHref, type TraceListState } from "@/lib/version-trace-list";
import styles from "./versions.module.css";

export function VersionTraceTabs({ state, tabs, projectId, activeId }: {
  state: TraceListState;
  tabs: TraceVersionRow[];
  projectId?: number;
  activeId?: number;
}) {
  return (
    <nav className={styles.tabs} aria-label="版本全链路标签页">
      <Link
        className={styles.tabLink}
        href={traceHref(state, projectId)}
        prefetch={false}
        aria-current={activeId === undefined ? "page" : undefined}
        aria-label={activeId === undefined ? "版本列表" : "返回版本列表"}
      >
        版本列表
      </Link>
      {tabs.map((tab) => {
        const identity = packageIdentity({ name: tab.packageName, code: tab.packageCode });
        const name = `${identity.code} ${tab.version}`;
        const remaining = { ...state, tabs: state.tabs.filter((id) => id !== tab.id) };
        return (
          <div key={tab.id} className={styles.tabWithClose}>
            <Link
              className={styles.tabLink}
              href={traceHref(state, projectId, tab.id)}
              prefetch={false}
              aria-current={tab.id === activeId ? "page" : undefined}
              title={identity.name !== identity.code ? `${name} · ${identity.name}` : name}
            >
              {name}
            </Link>
            <Link
              className={styles.tabClose}
              href={traceHref(remaining, projectId, activeId === tab.id ? undefined : activeId)}
              prefetch={false}
              aria-label={`关闭 ${name} 标签页`}
              scroll={false}
            >
              <X size={13} aria-hidden="true" />
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
