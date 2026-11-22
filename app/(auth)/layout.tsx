import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import styles from "./auth.module.css";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className={styles.header}>
        <div className={`container-wide ${styles.navigation}`}>
          <Brand href="/" />
          <Link href="/" prefetch={false} className="button button-ghost button-sm">
            <ArrowLeft size={15} aria-hidden="true" /> 项目联系人
          </Link>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </>
  );
}
