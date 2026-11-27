import Link from "next/link";
import { ArrowRight, LogIn } from "lucide-react";
import { Brand } from "./brand";
import { getAccountAreaLabel } from "@/lib/organization-queries";
import type { SessionUser } from "@/lib/types";
import styles from "@/app/public-contacts.module.css";

export function PublicHeader({ user }: { user: SessionUser | null }) {
  return (
    <header className="public-header">
      <div className={`container-wide public-nav ${styles.navigation}`} data-signed-in={Boolean(user)}>
        <Brand subtitle={user ? getAccountAreaLabel(user.id) : undefined} />
        <nav className={styles.accountLinks} aria-label="工作台账号">
          {user ? (
            <Link href="/dashboard" className="button button-primary button-sm" prefetch={false}>
              进入工作台 <ArrowRight size={13} aria-hidden="true" />
            </Link>
          ) : (
            <>
              <Link href="/login" className="button button-primary button-sm" prefetch={false}>
                <LogIn size={13} aria-hidden="true" /> 内部登录
              </Link>
              <Link href="/register" className="button button-ghost button-sm" prefetch={false}>
                注册账号
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
