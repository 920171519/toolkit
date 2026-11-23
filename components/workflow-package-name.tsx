import styles from "./workflow-queue.module.css";

export function WorkflowPackageName({ name, code }: { name: string; code: string }) {
  if (name === code) return null;
  const className = `small muted ${styles.packageNameNote}`;
  if (name.length <= 40) return <p className={className}>{name}</p>;
  return <details className={className}><summary>查看完整软件包名称</summary><p>{name}</p></details>;
}
