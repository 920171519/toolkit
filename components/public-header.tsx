import Link from "next/link";
import { ArrowRight, LogIn } from "lucide-react";
import { Brand } from "./brand";
import type { SessionUser } from "@/lib/types";

export function PublicHeader({ user }: { user: SessionUser | null }) {
  return (
    <header className="public-header">
      <div className="container-wide public-nav">
        <Brand />
        <nav className="public-nav-links" aria-label="公开页面导航">
          <Link className="public-nav-link" href="/#project-contacts">
            项目联系人
          </Link>
        </nav>
        <div className="toolbar" style={{ gap: 8 }}>
          {user ? (
            <Link href="/dashboard" className="button button-primary button-sm">
              进入工作台 <ArrowRight size={13} />
            </Link>
          ) : (
            <>
              <Link href="/login" className="button button-ghost button-sm">
                <LogIn size={13} /> 内部登录
              </Link>
              <Link href="/register" className="button button-primary button-sm">
                注册账号
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
