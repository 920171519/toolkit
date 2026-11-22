import Link from "next/link";
import styles from "./workflow-queue.module.css";

type QueueView = {
  href: string;
  label: string;
  count: number;
  current: boolean;
  nativeNavigation?: boolean;
};

export function WorkflowQueueNav({ label, views }: { label: string; views: QueueView[] }) {
  return (
    <nav className={styles.queueNav} aria-label={label}>
      {views.map((view) => {
        const current = view.current ? "page" : undefined;
        const content = <><span>{view.label}</span><span className={styles.queueCount}>{view.count}</span></>;
        return view.nativeNavigation
          ? <a href={view.href} key={view.href} aria-current={current}>{content}</a>
          : <Link href={view.href} key={view.href} aria-current={current} prefetch={false}>{content}</Link>;
      })}
    </nav>
  );
}
