import styles from "./package-name-toggle.module.css";

export function PackageNameToggle({ controls }: { controls: string }) {
  return (
    <label className={styles.toggle}>
      <input type="checkbox" role="switch" aria-controls={controls} autoComplete="off" />
      显示软件包名称
    </label>
  );
}
